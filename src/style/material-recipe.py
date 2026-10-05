"""Bakes one material recipe to four tileable PNG maps, run headless by scripts/materials.ts.

blender -b --factory-startup --python-exit-code 1 -P material-recipe.py -- <recipe.json> <outdir>

The recipe is {"pattern", "seed", "roughness", "metalness"}. The maps are color.png (a near-neutral
luminance map, since the part's Color tints it), normal.png (OpenGL, green up), roughness.png and
metalness.png, each SIZE x SIZE 8-bit RGB. Every pattern is built from functions periodic over the
image, so the maps tile without a seam. Pixels are written straight to PNG bytes, so no color
management touches them. Only Blender's bundled Python and numpy are used.
"""

import json
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

SIZE = 512
NORMAL_STRENGTH = 6.0


def periodic_noise(rng, cells_x, cells_y):
    """Smooth value noise in [0, 1] with cells_x by cells_y lattice cells, periodic over the image."""
    lattice = rng.random((cells_y, cells_x))
    xs = np.arange(SIZE) * cells_x / SIZE
    ys = np.arange(SIZE) * cells_y / SIZE
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    fx = xs - x0
    fy = ys - y0
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    x1 = (x0 + 1) % cells_x
    y1 = (y0 + 1) % cells_y
    top = lattice[y0][:, x0] * (1 - fx) + lattice[y0][:, x1] * fx
    bottom = lattice[y1][:, x0] * (1 - fx) + lattice[y1][:, x1] * fx
    return top * (1 - fy)[:, None] + bottom * fy[:, None]


def fbm(rng, base_cells, octaves, stretch=1):
    """Fractal sum of periodic noise octaves, normalized to [0, 1]; stretch > 1 elongates it along x."""
    total = np.zeros((SIZE, SIZE))
    amplitude = 1.0
    weight = 0.0
    cells = base_cells
    for _ in range(octaves):
        total += amplitude * periodic_noise(rng, max(1, cells // stretch), cells)
        weight += amplitude
        amplitude *= 0.5
        cells *= 2
    return total / weight


def grid_coordinates():
    """Pixel-center coordinates u (x, rightward) and v (y, downward) in [0, 1)."""
    axis = (np.arange(SIZE) + 0.5) / SIZE
    return np.meshgrid(axis, axis)


def cell_values(rng, ids, count):
    """A random value in [0, 1] per integer cell id, looked up for every pixel."""
    return rng.random(count)[ids % count]


def seam_mask(position, cells, width):
    """1 inside the seams between `cells` equal cells along a [0, 1) axis, 0 elsewhere, softened."""
    local = (position * cells) % 1.0
    distance = np.minimum(local, 1.0 - local) / cells
    return np.clip(1.0 - (distance - width) / (width * 0.6), 0.0, 1.0)


def brick(rng):
    u, v = grid_coordinates()
    rows, columns = 8, 4
    row = np.floor(v * rows).astype(int)
    shifted = (u + (row % 2) * 0.5 / columns) % 1.0
    column = np.floor(shifted * columns).astype(int)
    mortar = np.maximum(seam_mask(v, rows, 0.006), seam_mask(shifted, columns, 0.006))
    tint = cell_values(rng, row * columns + column, rows * columns)
    grain = fbm(rng, 16, 4)
    height = (1 - mortar) * (0.8 + 0.2 * grain) + mortar * 0.15 * grain
    albedo = (1 - mortar) * (0.72 + 0.18 * tint + 0.1 * grain) + mortar * 0.55
    rough_bias = mortar * 0.15
    return height, albedo, grain, rough_bias, mortar


def tile(rng):
    u, v = grid_coordinates()
    cells = 4
    grout = np.maximum(seam_mask(u, cells, 0.003), seam_mask(v, cells, 0.003))
    ids = np.floor(v * cells).astype(int) * cells + np.floor(u * cells).astype(int)
    tint = cell_values(rng, ids, cells * cells)
    veins = np.abs(fbm(rng, 4, 5) - 0.5) * 2
    vein = np.clip(1 - veins * 6, 0, 1) ** 2
    height = (1 - grout) * (0.9 + 0.02 * vein) + grout * 0.3
    albedo = (1 - grout) * (0.86 + 0.08 * tint - 0.18 * vein) + grout * 0.6
    detail = fbm(rng, 32, 3)
    return height, albedo, detail, grout * 0.25 - (1 - grout) * 0.05 * vein, grout


def concrete(rng):
    base = fbm(rng, 8, 6)
    pores = periodic_noise(rng, 128, 128)
    pits = np.clip((pores - 0.82) * 6, 0, 1)
    height = 0.6 * base - 0.3 * pits
    albedo = 0.78 + 0.16 * (base - 0.5) - 0.12 * pits
    return height, albedo, base, 0.1 * pits, np.zeros_like(base)


def metal(rng):
    brushed = fbm(rng, 64, 3, stretch=32)
    blotches = fbm(rng, 4, 4)
    scratches = np.clip((periodic_noise(rng, 2, 256) - 0.9) * 8, 0, 1)
    height = 0.15 * brushed - 0.1 * scratches
    albedo = 0.82 + 0.08 * (brushed - 0.5) + 0.06 * (blotches - 0.5)
    return height, albedo, 0.6 * brushed + 0.4 * blotches, 0.08 * scratches, np.zeros_like(brushed)


def plate(rng):
    u, v = grid_coordinates()
    cells = 8
    cu = (u * cells) % 1.0 - 0.5
    cv = (v * cells) % 1.0 - 0.5
    parity = (np.floor(u * cells) + np.floor(v * cells)) % 2
    # An elongated diamond per cell, turned a quarter between neighbours.
    along = np.where(parity == 0, (cu + cv), (cu - cv)) / np.sqrt(2)
    across = np.where(parity == 0, (cu - cv), (cu + cv)) / np.sqrt(2)
    diamond = np.clip(1 - (np.abs(along) / 0.32 + np.abs(across) / 0.07), 0, 1)
    ridge = np.clip(diamond * 3, 0, 1)
    wear = fbm(rng, 8, 4)
    height = 0.8 * ridge + 0.05 * wear
    albedo = 0.8 + 0.08 * (wear - 0.5) + 0.06 * ridge
    return height, albedo, wear, -0.12 * ridge, np.zeros_like(wear)


def panel(rng):
    u, v = grid_coordinates()
    seams = np.maximum(seam_mask(u, 2, 0.003), seam_mask(v, 2, 0.003))
    inset_u = np.abs((u * 2) % 1.0 - 0.5)
    inset_v = np.abs((v * 2) % 1.0 - 0.5)
    edge = np.maximum(inset_u, inset_v)
    inset = np.clip((0.3 - edge) * 80, 0, 1) * np.clip((edge - 0.27) * 80, 0, 1)
    smudge = fbm(rng, 4, 5)
    height = 0.7 - 0.6 * seams - 0.2 * inset + 0.03 * smudge
    albedo = 0.9 + 0.05 * (smudge - 0.5) - 0.25 * seams - 0.06 * inset
    return height, albedo, smudge, 0.2 * seams, seams


PATTERNS = {
    "brick": brick,
    "tile": tile,
    "concrete": concrete,
    "metal": metal,
    "plate": plate,
    "panel": panel,
}


def normal_map(height):
    """OpenGL tangent-space normals (green points up the image) from a periodic height field."""
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * NORMAL_STRENGTH
    # Rows run downward, so the upward slope is the negated row difference.
    dy = -(np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * NORMAL_STRENGTH
    normal = np.stack([-dx, -dy, np.ones_like(height)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    return normal * 0.5 + 0.5


def to_rgb(values):
    """A [0, 1] gray field or RGB field as 8-bit RGB rows."""
    values = np.clip(values, 0.0, 1.0)
    if values.ndim == 2:
        values = np.repeat(values[:, :, None], 3, axis=2)
    return np.round(values * 255).astype(np.uint8)


def write_png(path, rgb):
    """Writes an 8-bit RGB array as a PNG with no ancillary chunks, so equal pixels give equal bytes."""
    height, width, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[row].tobytes() for row in range(height))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def main():
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    recipe = json.loads(Path(arguments[0]).read_text())
    out = Path(arguments[1])
    out.mkdir(parents=True, exist_ok=True)
    pattern = PATTERNS[recipe["pattern"]]
    rng = np.random.default_rng(int(recipe["seed"]))
    height, albedo, variation, rough_bias, metal_mask = pattern(rng)
    roughness = recipe["roughness"] + 0.2 * (variation - 0.5) + rough_bias
    metalness = recipe["metalness"] * (1 - metal_mask) + 0.05 * (variation - 0.5) * recipe["metalness"]
    write_png(out / "color.png", to_rgb(albedo))
    write_png(out / "normal.png", to_rgb(normal_map(height)))
    write_png(out / "roughness.png", to_rgb(roughness))
    write_png(out / "metalness.png", to_rgb(metalness))


main()
