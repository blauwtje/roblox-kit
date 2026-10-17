import { recordedHeroAsset, type HeroPropSources } from "../hero-props/hero-prop-asset.ts";
import type { MeshDeclaration, Preset } from "../style/preset-schema.ts";
import type { HeroPropRecord, PlacedProp } from "./hero-prop-placement.ts";
import type { Vector } from "./map-layout.ts";
import type { DetailPart } from "./room-details.ts";

type MeshTarget = MeshDeclaration["targets"][number];

/**
 * A declared mesh that replaces trim details: one doorway arch (its jambs and lintel as `fallbackParts`) stretched to
 * the frame's outer bounds, or one crown or baseboard run (its box as the one fallback part) stretched along the run.
 * `part` names the MeshPart of the Model to keep; the mesh's own baked look is kept, so it names no surfaces.
 */
export interface DeclaredTrimRecord {
  kind: "arch" | "crown" | "baseboard";
  assetId: string;
  pivot: Vector;
  yaw: number;
  size: Vector;
  surfaces: Record<string, never>;
  fit: "stretch" | "none";
  part: string;
  fallbackParts: DetailPart[];
}

const archPiece = /^(.*-arch-\d+)-(left|right|lintel)$/;
const bandRun = /-(crown|baseboard)-(?:north|south|east|west)-[^-]*$/;

export interface AssetLookup {
  cache: Map<string, string | undefined>;
  base: Preset;
  sources: HeroPropSources;
}

/** The recorded asset of `recipeKind`, looked up once per kind in the lookup's cache; undefined when none is recorded. */
export async function cachedAssetId(
  lookup: AssetLookup,
  recipeKind: string,
): Promise<string | undefined> {
  const { cache, base, sources } = lookup;
  if (!cache.has(recipeKind)) {
    cache.set(recipeKind, (await recordedHeroAsset(base, recipeKind, sources)).assetId);
  }
  return cache.get(recipeKind);
}

function declaredRecord(assetId: string, target: MeshTarget, piece: PlacedProp): HeroPropRecord {
  const anchor = target.anchor ?? "center";
  const { x, y, z } = piece.pivot;
  return {
    kind: piece.kind,
    assetId,
    pivot: anchor === "bottom" ? { x, y: y - piece.size.y / 2, z } : piece.pivot,
    yaw: ((piece.yaw ?? 0) + (target.yaw ?? 0)) % 360,
    size: piece.size,
    surfaces: {},
    bevels: {},
    fallback: piece,
    fit: "none",
    anchor,
    ...(target.part === undefined ? {} : { part: target.part }),
  };
}

interface MeshEntry {
  meshKind: string;
  target: MeshTarget;
}

function standingRecord(assetId: string, entry: MeshEntry, piece: PlacedProp): HeroPropRecord {
  const { meshKind, target } = entry;
  const { x, y, z } = piece.pivot;
  return {
    kind: meshKind,
    assetId,
    pivot: { x, y: y + piece.size.y / 2, z },
    yaw: ((piece.yaw ?? 0) + (target.yaw ?? 0)) % 360,
    size: piece.size,
    surfaces: {},
    bevels: {},
    fit: "none",
    anchor: "bottom",
    ...(target.part === undefined ? {} : { part: target.part }),
  };
}

async function standingRecords(
  lookup: AssetLookup,
  entries: MeshEntry[],
  piece: PlacedProp,
): Promise<HeroPropRecord[]> {
  const records: HeroPropRecord[] = [];
  for (const entry of entries) {
    const assetId = await cachedAssetId(lookup, entry.meshKind);
    if (assetId !== undefined) records.push(standingRecord(assetId, entry, piece));
  }
  return records;
}

/**
 * Each prop a declared mesh replaces (a `prop:<kind>` target, and its `label` when it has one) as that mesh at its
 * modelled size, ahead of any `heroProps` entry or `prop-<kind>` recipe for the piece. A prop an `onto:prop:<kind>`
 * target names stays and gets the mesh stood on its top, with no fallback. A mesh with no recorded asset leaves its
 * pieces in place, with no warning.
 */
export async function declaredMeshesOf<Prop extends PlacedProp>(
  lookup: AssetLookup,
  props: Prop[],
): Promise<{ props: Prop[]; heroProps: HeroPropRecord[] }> {
  const byTarget = new Map<string, MeshEntry[]>();
  for (const [meshKind, { targets }] of Object.entries(lookup.base.meshes ?? {})) {
    for (const target of targets) {
      const entries = byTarget.get(target.replaces) ?? [];
      byTarget.set(target.replaces, [...entries, { meshKind, target }]);
    }
  }
  const kept: Prop[] = [];
  const heroProps: HeroPropRecord[] = [];
  for (const prop of props) {
    const labelled = ({ target }: MeshEntry) =>
      target.label === undefined || prop.attributes?.Label === target.label;
    const match = byTarget.get(`prop:${prop.kind}`)?.find(labelled);
    const standing = (byTarget.get(`onto:prop:${prop.kind}`) ?? []).filter(labelled);
    heroProps.push(...(await standingRecords(lookup, standing, prop)));
    if (match === undefined) {
      kept.push(prop);
      continue;
    }
    const assetId = await cachedAssetId(lookup, match.meshKind);
    if (assetId === undefined) kept.push(prop);
    else heroProps.push(declaredRecord(assetId, match.target, prop));
  }
  return { props: kept, heroProps };
}

/** The doorway arches and the crown and baseboard runs the preset's declared meshes replace, as records; the other details stay. */
export async function declaredTrimOf(
  details: DetailPart[],
  preset: { base: Preset },
  sources: HeroPropSources = {},
): Promise<{ details: DetailPart[]; declaredTrim: DeclaredTrimRecord[] }> {
  const targets = Object.entries(preset.base.meshes ?? {}).flatMap(([meshKind, { targets }]) =>
    targets.map((target) => ({ meshKind, target })),
  );
  const lookup = { cache: new Map<string, string | undefined>(), base: preset.base, sources };
  const assetOf = async (replaces: string) => {
    const match = targets.find(({ target }) => target.replaces === replaces);
    if (match === undefined || match.target.part === undefined) return undefined;
    const assetId = await cachedAssetId(lookup, match.meshKind);
    return assetId === undefined ? undefined : { assetId, part: match.target.part };
  };
  const arches = new Map<string, DetailPart[]>();
  const kept: DetailPart[] = [];
  const declaredTrim: DeclaredTrimRecord[] = [];
  const archAsset = await assetOf("arch");
  for (const detail of details) {
    const piece = detail.kind === "arch" ? archPiece.exec(detail.name) : null;
    if (piece?.[1] !== undefined && archAsset !== undefined) {
      arches.set(piece[1], [...(arches.get(piece[1]) ?? []), detail]);
      continue;
    }
    const band = detail.profile === undefined ? null : bandRun.exec(detail.name);
    const bandKind = band?.[1] === "crown" || band?.[1] === "baseboard" ? band[1] : undefined;
    const asset = bandKind === undefined ? undefined : await assetOf(`band:${bandKind}`);
    if (bandKind === undefined || asset === undefined || detail.profile === undefined) {
      kept.push(detail);
      continue;
    }
    declaredTrim.push({
      kind: bandKind,
      assetId: asset.assetId,
      pivot: detail.position,
      yaw: (detail.profile.yaw + 270) % 360,
      size: { x: detail.profile.size.z, y: detail.profile.size.y, z: detail.profile.size.x },
      surfaces: {},
      fit: "stretch",
      part: asset.part,
      fallbackParts: [detail],
    });
  }
  for (const parts of arches.values()) {
    const [jamb, other] = parts.filter((part) => !part.name.endsWith("-lintel"));
    if (archAsset === undefined || jamb === undefined || other === undefined) {
      kept.push(...parts);
      continue;
    }
    const low = (axis: "x" | "y" | "z") =>
      Math.min(...parts.map((part) => part.position[axis] - part.size[axis] / 2));
    const high = (axis: "x" | "y" | "z") =>
      Math.max(...parts.map((part) => part.position[axis] + part.size[axis] / 2));
    const extent = { x: high("x") - low("x"), y: high("y") - low("y"), z: high("z") - low("z") };
    const alongZ = Math.abs(jamb.position.z - other.position.z) > 1e-9;
    declaredTrim.push({
      kind: "arch",
      assetId: archAsset.assetId,
      pivot: {
        x: (low("x") + high("x")) / 2,
        y: (low("y") + high("y")) / 2,
        z: (low("z") + high("z")) / 2,
      },
      yaw: alongZ ? 90 : 0,
      size: alongZ ? { x: extent.z, y: extent.y, z: extent.x } : extent,
      surfaces: {},
      fit: "stretch",
      part: archAsset.part,
      fallbackParts: parts,
    });
  }
  return { details: kept, declaredTrim };
}
