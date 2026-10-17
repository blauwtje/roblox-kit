import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../src/config.ts";
import { runBlender } from "../src/hero-props/blender-path.ts";
import { generateHeroProp, type GeneratedHeroProp } from "../src/hero-props/generate-hero-prop.ts";
import {
  generateScriptedMesh,
  scriptedMeshHash,
} from "../src/hero-props/generate-scripted-mesh.ts";
import { readGlbStructure, type GlbStructure } from "../src/hero-props/glb-structure.ts";
import { heroPropAsset, heroRecipeHash } from "../src/hero-props/hero-prop-asset.ts";
import {
  materialRecipeScript,
  pruneHeroAssets,
  reachableHeroHashes,
  recordedMaterialMaps,
  recordHeroAsset,
} from "../src/hero-props/hero-asset-store.ts";
import {
  baseMeshSources,
  currentMeshFiles,
  meshDifferences,
  meshFilesHash,
  parityResultSchema,
  rekeyMesh,
  sameMeshFiles,
  type ParityResult,
} from "../src/hero-props/mesh-parity.ts";
import { lookUpOpenCloudCredentials } from "../src/hero-props/open-cloud-credentials.ts";
import {
  uploadImage,
  uploadMaterialMaps,
  writeHeroPropChecks,
} from "../src/hero-props/open-cloud-upload.ts";
import { renderHeroProp } from "../src/hero-props/render-hero-prop.ts";
import { propRecipeKindsOf, trimRecipes } from "../src/hero-props/prop-recipes.ts";
import {
  drawSprite,
  recordedSprites,
  spriteHashes,
  spriteKind,
} from "../src/lighting/ambient-sprites.ts";
import { loadPresets } from "../src/style/load-preset.ts";
import {
  materialMapNames,
  spriteNames,
  type MaterialRecipe,
  type Preset,
} from "../src/style/preset-schema.ts";
import { runScript } from "./lib/run-script.ts";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);
const generatedFolder = new URL(`${config.heroPropsFolder}/`, repositoryRoot);
const materialsFolder = new URL(".roblox-kit/materials/", repositoryRoot);
const spritesFolder = new URL(".roblox-kit/sprites/", repositoryRoot);
const defaultBase = "HEAD~1";

type Values = Record<string, string | boolean | undefined | (string | boolean)[]>;

function text(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

function requiredText(values: Values, name: string): string {
  const value = text(values, name);
  if (value === undefined) throw new Error(`Missing --${name} <value>`);
  return value;
}

async function presetOf(name: string): Promise<Preset> {
  const preset = (await loadPresets()).get(name);
  if (preset === undefined) throw new Error(`No preset named "${name}"`);
  return preset;
}

async function currentHash(preset: Preset, kind: string): Promise<string | undefined> {
  const declared = preset.meshes?.[kind] ?? preset.heroProps?.[kind];
  return declared === undefined ? undefined : heroRecipeHash(preset, kind);
}

async function reusable(
  presetName: string,
  preset: Preset,
  kind: string,
): Promise<GeneratedHeroProp | undefined> {
  const hash = await currentHash(preset, kind);
  if (hash === undefined) return undefined;
  const directory = new URL(`${presetName}-${kind}-${hash}/`, generatedFolder);
  const glb = new URL("model.glb", directory);
  try {
    return { hash, directory, glb, structure: readGlbStructure(await readFile(glb)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function generate(values: Values): Promise<number> {
  const presetName = requiredText(values, "preset");
  const kind = requiredText(values, "kind");
  const preset = await presetOf(presetName);
  const declared = preset.meshes?.[kind] !== undefined;
  const generated =
    (values.force === true ? undefined : await reusable(presetName, preset, kind)) ??
    (await (declared ? generateScriptedMesh : generateHeroProp)(presetName, kind));
  const [width, height, depth] = generated.structure.size;
  console.log(
    `${presetName}/${kind}: ${String(generated.structure.triangles)} triangles, ` +
      `${width.toFixed(2)} x ${height.toFixed(2)} x ${depth.toFixed(2)} studs, ${fileURLToPath(generated.glb)}`,
  );
  for (const render of await renderHeroProp(generated.glb)) console.log(fileURLToPath(render));
  const checks = await writeHeroPropChecks(generated.directory, generated.hash);
  console.log(`${String(checks.parts)} parts`);
  if (checks.passed) return 0;
  console.error(
    `Checks of ${presetName}/${kind} (${checks.hash}) did not pass: ` +
      `floating ${checks.floatingParts.join(", ") || "none"}; ` +
      `inverted ${checks.invertedParts.join(", ") || "none"}.`,
  );
  return 1;
}

async function bakedStructure(script: string): Promise<GlbStructure> {
  const folder = await mkdtemp(join(tmpdir(), "mesh-parity-"));
  try {
    const maps = join(folder, "maps");
    await mkdir(maps);
    await runBlender(script, [join(folder, "out"), maps]);
    const glbs = (await readdir(maps)).filter((name) => name.endsWith(".glb"));
    const [glb, ...others] = glbs;
    if (others.length > 0) {
      throw new Error(`${script} exported ${String(glbs.length)} GLBs into its maps folder`);
    }
    return readGlbStructure(
      await readFile(glb === undefined ? join(folder, "out.glb") : join(maps, glb)),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

interface KindRequest {
  presetName: string;
  kind: string;
  script: string;
  base: string;
}

async function compareKind(
  request: KindRequest,
): Promise<{ result: ParityResult; directory: URL }> {
  const { presetName, kind, script, base } = request;
  const current = await currentMeshFiles(script);
  const before = await baseMeshSources(base, script);
  try {
    const baseHash = meshFilesHash(kind, script, before.files);
    const hash = meshFilesHash(kind, script, current);
    if (sameMeshFiles(before.files, current)) {
      const directory = new URL(`${presetName}-${kind}-${hash}/`, generatedFolder);
      await mkdir(directory, { recursive: true });
      return { result: { hash, baseHash, passed: true, differences: [] }, directory };
    }
    const baseStructure = await bakedStructure(before.script);
    const generated = await generateScriptedMesh(presetName, kind);
    const differences = meshDifferences(baseStructure, generated.structure);
    return {
      result: { hash: generated.hash, baseHash, passed: differences.length === 0, differences },
      directory: generated.directory,
    };
  } finally {
    await rm(before.directory, { recursive: true, force: true });
  }
}

async function reportKind(request: KindRequest): Promise<string[]> {
  const { result, directory } = await compareKind(request);
  await writeFile(new URL("parity.json", directory), `${JSON.stringify(result, null, 2)}\n`);
  const verdict = result.passed ? "parity" : `differs (${result.differences.join("; ")})`;
  console.log(`${request.presetName}/${request.kind}: ${verdict}, ${fileURLToPath(directory)}`);
  return result.passed ? [] : [request.kind];
}

function scriptOf(
  meshes: Record<string, { script: string }>,
  presetName: string,
  kind: string,
): string {
  const script = meshes[kind]?.script;
  if (script === undefined) throw new Error(`Preset "${presetName}" declares no mesh "${kind}"`);
  return script;
}

async function parity(values: Values): Promise<number> {
  const presetName = requiredText(values, "preset");
  const base = text(values, "base") ?? defaultBase;
  const meshes = (await presetOf(presetName)).meshes ?? {};
  const named = text(values, "kinds")
    ?.split(",")
    .map((kind) => kind.trim());
  const selected = named ?? Object.keys(meshes);
  if (selected.length === 0) throw new Error(`Preset "${presetName}" declares no meshes`);
  const differing: string[] = [];
  for (const kind of selected) {
    const script = scriptOf(meshes, presetName, kind);
    differing.push(...(await reportKind({ presetName, kind, script, base })));
  }
  if (differing.length === 0) return 0;
  console.error(`Differing kinds: ${differing.join(", ")}`);
  return 1;
}

async function readParity(label: string, hash: string): Promise<ParityResult> {
  const file = new URL(`${label}-${hash}/parity.json`, generatedFolder);
  try {
    return parityResultSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`${label} (${hash}) has no parity.json; run hero-props parity first`, {
      cause: error,
    });
  }
}

async function record(values: Values): Promise<number> {
  const presetName = requiredText(values, "preset");
  const kind = requiredText(values, "kind");
  const assetId = text(values, "asset-id");
  if (assetId !== undefined && !/^\d+$/.test(assetId)) {
    throw new Error("--asset-id must be digits");
  }
  const declaration = (await presetOf(presetName)).meshes?.[kind];
  if (declaration === undefined) {
    throw new Error(`Preset "${presetName}" declares no mesh "${kind}"`);
  }
  const hash = await scriptedMeshHash(kind, declaration);
  const result = await readParity(`${presetName}-${kind}`, hash);
  if (result.hash !== hash || !result.passed) {
    throw new Error(
      `${presetName}/${kind} (${hash}) did not pass parity: ${result.differences.join("; ") || `result is for ${result.hash}`}`,
    );
  }
  if (assetId === undefined) {
    console.log(`${presetName}/${kind}: ${await rekeyMesh(result)} ${result.baseHash} -> ${hash}`);
  } else {
    await recordHeroAsset(hash, { kind, assetId });
    console.log(`${presetName}/${kind}: recorded ${assetId} for ${hash}`);
  }
  return 0;
}

function reportAsset(
  kind: string,
  asset: Awaited<ReturnType<typeof heroPropAsset>>,
  dryRun: boolean,
): number {
  switch (asset.status) {
    case "recorded":
      console.log(`${kind} -> ${asset.assetId} (already recorded)`);
      return 0;
    case "uploaded":
      console.log(`${kind} -> ${asset.assetId}`);
      return 0;
    case "unreviewed":
      console.log(`${kind}: recipe ${asset.hash} has no passed checks; not uploaded`);
      return 0;
    case "no-credentials":
      if (dryRun) {
        console.log(`${kind}: would upload recipe ${asset.hash}`);
        return 0;
      }
      console.error(`${kind}: not uploaded: ${asset.missing}`);
      return 1;
    case "upload-failed":
      console.error(`${kind}: upload of recipe ${asset.hash} failed: ${asset.error}`);
      return 1;
  }
}

async function upload(values: Values): Promise<number> {
  const presetName = requiredText(values, "preset");
  const dryRun = values["dry-run"] === true;
  const preset = await presetOf(presetName);
  const available = new Set([
    ...Object.keys(preset.heroProps ?? {}),
    ...Object.keys(preset.meshes ?? {}),
    ...propRecipeKindsOf(preset),
    ...Object.keys(trimRecipes),
  ]);
  const wanted = text(values, "kinds")
    ?.split(",")
    .map((kind) => kind.trim());
  const unknown = wanted?.filter((kind) => !available.has(kind)) ?? [];
  if (unknown.length > 0) {
    throw new Error(`Preset "${presetName}" has no kind ${unknown.join(", ")}`);
  }
  let status = 0;
  for (const kind of wanted ?? available) {
    const asset = await heroPropAsset(
      presetName,
      preset,
      kind,
      dryRun ? { credentials: () => Promise.resolve({ missing: "dry run" }) } : {},
    );
    status = Math.max(status, reportAsset(kind, asset, dryRun));
  }
  return status;
}

async function sprites(values: Values): Promise<number> {
  const uploading = values.upload === true;
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
    if (!uploading) continue;
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
  return 0;
}

async function bake(recipe: MaterialRecipe, directory: URL): Promise<void> {
  await mkdir(directory, { recursive: true });
  const recipeFile = new URL("recipe.json", directory);
  await writeFile(recipeFile, JSON.stringify(recipe, null, 2));
  await runBlender(fileURLToPath(materialRecipeScript), [
    fileURLToPath(recipeFile),
    fileURLToPath(directory),
  ]);
}

function withVariant(source: string, role: string, variant: unknown): string {
  const lines = source.split("\n");
  const surfaces = lines.indexOf('  "surfaces": {');
  const start = surfaces < 0 ? -1 : lines.indexOf(`    "${role}": {`, surfaces);
  if (start < 0) throw new Error(`No "${role}" surface block in the preset file.`);
  let end = start + 1;
  while (end < lines.length && !(lines[end] ?? "").startsWith("    }")) end++;
  const fields: string[][] = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^ {6}"/.test(line)) fields.push([line]);
    else fields.at(-1)?.push(line);
  }
  const kept = fields.filter(([first]) => !first?.startsWith('      "variant":')).flat();
  const [head = "", ...rest] = JSON.stringify(variant, null, 2).split("\n");
  const body = [
    ...kept.map((line, index) => (index === kept.length - 1 ? line.replace(/,?$/, ",") : line)),
    `      "variant": ${head}`,
    ...rest.map((line) => `      ${line}`),
  ];
  return [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join("\n");
}

function variantOf(
  material: string,
  recipe: MaterialRecipe,
  assetIds: Record<(typeof materialMapNames)[number], string>,
): unknown {
  const maps = Object.fromEntries(
    materialMapNames.map((map) => [map, `rbxassetid://${assetIds[map]}`]),
  );
  return { baseMaterial: material, studsPerTile: recipe.studsPerTile, maps };
}

type MapIds = Record<(typeof materialMapNames)[number], string>;

async function materialAssetIds(
  presetName: string,
  role: string,
  options: { recipe: MaterialRecipe; bakeOnly: boolean },
): Promise<MapIds | undefined> {
  const { recipe, bakeOnly } = options;
  const { hashes, recorded } = await recordedMaterialMaps(recipe);
  const missing = materialMapNames.filter((map) => recorded[map] === undefined);
  if (missing.length === 0 && !bakeOnly) {
    console.log(`${role}: all four maps already recorded`);
    return recorded as MapIds;
  }
  const directory = new URL(`${presetName}-${role}/`, materialsFolder);
  await bake(recipe, directory);
  console.log(`${role}: baked ${recipe.pattern} to ${fileURLToPath(directory)}`);
  if (bakeOnly) return undefined;
  const lookup = await lookUpOpenCloudCredentials();
  if ("missing" in lookup) throw new Error(`Not uploaded: ${lookup.missing}`);
  const assetIds = await uploadMaterialMaps(
    `${presetName}-${role}`,
    hashes,
    directory,
    lookup.credentials,
  );
  console.log(`${role}: uploaded ${missing.join(", ")}`);
  return assetIds;
}

async function materials(values: Values): Promise<number> {
  const presetName = requiredText(values, "preset");
  const bakeOnly = values["bake-only"] === true;
  const preset = await presetOf(presetName);
  const presetFile = new URL(`presets/${presetName}.json`, repositoryRoot);
  const original = await readFile(presetFile, "utf8");
  let source = original;
  for (const [role, surface] of Object.entries(preset.surfaces)) {
    const recipe = surface.texture;
    if (recipe === undefined) continue;
    const assetIds = await materialAssetIds(presetName, role, { recipe, bakeOnly });
    if (assetIds === undefined) continue;
    const variant = variantOf(surface.material, recipe, assetIds);
    if (JSON.stringify(surface.variant) !== JSON.stringify(variant)) {
      source = withVariant(source, role, variant);
    }
    console.log(
      `${role} -> ${materialMapNames.map((map) => `${map} ${assetIds[map]}`).join(", ")}`,
    );
  }
  if (source !== original) {
    await writeFile(presetFile, source);
    await execFileAsync("npx", ["prettier", "--write", fileURLToPath(presetFile)], {
      cwd: fileURLToPath(repositoryRoot),
    });
    console.log(`Wrote the variants into ${fileURLToPath(presetFile)}`);
  }
  return 0;
}

async function staleFolders(
  presetName: string,
  preset: Preset,
  folders: string[],
): Promise<string[]> {
  const stale: string[] = [];
  const kinds = new Set([
    ...Object.keys(preset.heroProps ?? {}),
    ...Object.keys(preset.meshes ?? {}),
  ]);
  for (const kind of kinds) {
    const current = `${presetName}-${kind}-${(await currentHash(preset, kind)) ?? ""}`;
    const prefix = `${presetName}-${kind}-`;
    stale.push(
      ...folders.filter(
        (name) =>
          name.startsWith(prefix) &&
          /^[0-9a-f]+$/.test(name.slice(prefix.length)) &&
          name !== current,
      ),
    );
  }
  return stale;
}

async function prune(values: Values): Promise<number> {
  const dryRun = values["dry-run"] === true;
  const only = text(values, "preset");
  const presets = await loadPresets();
  const names = only === undefined ? [...presets.keys()] : [only];
  const folders = await readdir(generatedFolder).catch(() => [] as string[]);
  const stale: string[] = [];
  for (const presetName of names) {
    stale.push(...(await staleFolders(presetName, await presetOf(presetName), folders)));
  }
  for (const name of stale) {
    if (!dryRun) await rm(new URL(`${name}/`, generatedFolder), { recursive: true, force: true });
    console.log(`${dryRun ? "would remove" : "removed"} ${name}`);
  }
  if (only === undefined) {
    const stale = await pruneHeroAssets(await reachableHeroHashes(presets), dryRun);
    for (const hash of stale) {
      console.log(`${dryRun ? "would drop" : "dropped"} record ${hash}`);
    }
  }
  return 0;
}

const commands = {
  generate: {
    usage:
      "generate --preset <name> --kind <kind> [--force]  generate, render and check a hero prop; reuse model.glb unless --force",
    options: { preset: { type: "string" }, kind: { type: "string" }, force: { type: "boolean" } },
    run: generate,
  },
  parity: {
    usage:
      "parity --preset <name> [--base <git ref>] [--kinds <a,b>]  compare declared meshes with a git base",
    options: { preset: { type: "string" }, base: { type: "string" }, kinds: { type: "string" } },
    run: parity,
  },
  record: {
    usage:
      "record --preset <name> --kind <kind> [--asset-id <digits>]  rekey a passed mesh, or record its asset id",
    options: {
      preset: { type: "string" },
      kind: { type: "string" },
      "asset-id": { type: "string" },
    },
    run: record,
  },
  upload: {
    usage:
      "upload --preset <name> [--kinds <a,b>] [--dry-run]  upload reviewed hero props without a recorded asset",
    options: {
      preset: { type: "string" },
      kinds: { type: "string" },
      "dry-run": { type: "boolean" },
    },
    run: upload,
  },
  sprites: {
    usage: "sprites [--upload]  draw the ambient sprites and optionally upload them",
    options: { upload: { type: "boolean" } },
    run: sprites,
  },
  materials: {
    usage:
      "materials --preset <name> [--bake-only]  bake, upload and record the preset's PBR materials",
    options: { preset: { type: "string" }, "bake-only": { type: "boolean" } },
    run: materials,
  },
  prune: {
    usage:
      "prune [--preset <name>] [--dry-run]  delete generated folders and (without --preset) records of stale hashes",
    options: { preset: { type: "string" }, "dry-run": { type: "boolean" } },
    run: prune,
  },
} as const;

const overview = [
  "Usage: node scripts/hero-props.ts <command> [options]",
  ...Object.values(commands).map((command) => `  ${command.usage}`),
  "Flags are parsed strictly with util.parseArgs.",
].join("\n");

const name = process.argv[2];
if (name === undefined || name === "--help" || name === "-h") {
  console.log(overview);
} else if (!Object.hasOwn(commands, name)) {
  console.error(`Unknown command "${name}"\n${overview}`);
  process.exitCode = 2;
} else {
  const command = commands[name as keyof typeof commands];
  process.argv.splice(2, 1);
  await runScript({
    name: `hero-props ${name}`,
    usage: `Usage: node scripts/hero-props.ts ${command.usage}`,
    options: command.options,
    run: (values) => command.run(values),
  });
}
