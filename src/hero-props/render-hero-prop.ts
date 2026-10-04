import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "../config.ts";
import { blenderPath } from "./blender-path.ts";

const execFileAsync = promisify(execFile);

const renderScript = new URL("./render-hero-prop.py", import.meta.url);
/** Blender prints its whole log on stdout; the buffer only has to hold it. */
const blenderOutputBytes = 10 * 1024 * 1024;
export const renderFileNames = ["front.png", "side.png", "three-quarter.png"] as const;

/** Renders the GLB at `glb` from the front, the side and a three-quarter angle with headless Blender into `front.png`, `side.png` and `three-quarter.png` beside it, returning their URLs. */
export async function renderHeroProp(glb: URL): Promise<URL[]> {
  const directory = new URL("./", glb);
  await execFileAsync(
    blenderPath(process.env),
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "-P",
      fileURLToPath(renderScript),
      "--",
      fileURLToPath(glb),
      fileURLToPath(directory),
    ],
    { timeout: config.blenderTimeoutMs, maxBuffer: blenderOutputBytes },
  );
  const renders = renderFileNames.map((fileName) => new URL(fileName, directory));
  for (const render of renders) await access(render);
  return renders;
}
