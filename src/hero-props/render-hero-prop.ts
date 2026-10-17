import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBlender } from "./blender-path.ts";

const renderScript = new URL("./render-hero-prop.py", import.meta.url);
export const renderFileNames = ["front.png", "side.png", "three-quarter.png"] as const;

/** Renders the GLB at `glb` from the front, the side and a three-quarter angle with headless Blender into `front.png`, `side.png` and `three-quarter.png` beside it, returning their URLs. */
export async function renderHeroProp(glb: URL): Promise<URL[]> {
  const directory = new URL("./", glb);
  await runBlender(fileURLToPath(renderScript), [fileURLToPath(glb), fileURLToPath(directory)]);
  const renders = renderFileNames.map((fileName) => new URL(fileName, directory));
  for (const render of renders) await access(render);
  return renders;
}
