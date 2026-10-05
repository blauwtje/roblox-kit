import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  drawSprite,
  recordedSprites,
  spriteHashes,
  spriteKind,
} from "../src/lighting/ambient-sprites.ts";
import { recordHeroAsset } from "../src/hero-props/hero-asset-store.ts";
import { lookUpOpenCloudCredentials } from "../src/hero-props/open-cloud-credentials.ts";
import { uploadImage } from "../src/hero-props/open-cloud-upload.ts";
import { spriteNames } from "../src/style/preset-schema.ts";

/**
 * `node scripts/sprites.ts [--upload]` draws every ambient-effect sprite from our own code to
 * `.roblox-kit/sprites/<sprite>-<hash>.png`. `--upload` then uploads each sprite whose hash is not yet recorded
 * in `hero-assets.json` as an Image through Open Cloud and records it by hash, so build_map textures its
 * emitters. It exits 1 on a missing key or creator or a failed upload.
 */
const repositoryRoot = new URL("../", import.meta.url);
const spritesFolder = new URL(".roblox-kit/sprites/", repositoryRoot);

const flags = process.argv.slice(2);
const upload = flags.includes("--upload");
if (flags.some((flag) => flag !== "--upload")) {
  console.error("Usage: node scripts/sprites.ts [--upload]");
  process.exit(1);
}

try {
  await mkdir(spritesFolder, { recursive: true });
  const hashes = await spriteHashes();
  const recorded = await recordedSprites();
  for (const sprite of spriteNames) {
    const png = drawSprite(sprite);
    const file = new URL(`${sprite}-${hashes[sprite]}.png`, spritesFolder);
    await writeFile(file, png);
    console.log(`${sprite}: drew ${fileURLToPath(file)}`);
    if (recorded[sprite] !== undefined) {
      console.log(`${sprite}: already recorded as ${recorded[sprite]}`);
      continue;
    }
    if (!upload) continue;
    const lookup = await lookUpOpenCloudCredentials();
    if ("missing" in lookup) throw new Error(`Not uploaded: ${lookup.missing}`);
    const bytes = new Uint8Array(png.byteLength);
    bytes.set(png);
    const assetId = await uploadImage(
      bytes,
      `sprite-${sprite}-${hashes[sprite]}`,
      lookup.credentials,
    );
    await recordHeroAsset(hashes[sprite], { kind: spriteKind(sprite), assetId });
    console.log(`${sprite}: uploaded as ${assetId}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
