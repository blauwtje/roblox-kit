import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const meshes = fileURLToPath(new URL("./", import.meta.url));

const redefinitions = `
import ast, json, sys
def defined(tree):
    return {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
def is_lib_name(value):
    return isinstance(value, str) and value.split(".")[0] == "lib"
def uses_lib(tree):
    return any(isinstance(n, ast.Constant) and is_lib_name(n.value) for n in ast.walk(tree))
library, scripts = sys.argv[1].split(","), sys.argv[2:]
exported = set()
for path in library:
    exported |= {name for name in defined(ast.parse(open(path).read())) if not name.startswith("_")}
found = {}
for path in scripts:
    tree = ast.parse(open(path).read())
    if uses_lib(tree):
        found[path] = sorted(defined(tree) & exported)
print(json.dumps(found))
`;

await test("no mesh script that imports lib redefines a name lib exports", async () => {
  const library = (await readdir(`${meshes}lib`)).filter((name) => name.endsWith(".py"));
  const scripts = (await readdir(meshes, { recursive: true }))
    .filter((name) => name.endsWith(".py") && !name.startsWith("lib/"))
    .map((name) => `${meshes}${name}`);
  const { stdout } = await execFileAsync("python3", [
    "-I",
    "-c",
    redefinitions,
    library.map((name) => `${meshes}lib/${name}`).join(","),
    ...scripts,
  ]);
  const found = JSON.parse(stdout) as Record<string, string[]>;
  assert.ok(
    Object.keys(found).some((path) => path.endsWith("pillar.py")),
    "pillar imports lib",
  );
  const clashes = Object.entries(found).filter(([, names]) => names.length > 0);
  assert.deepEqual(clashes, []);
});

const maxMeshLines = 4100;

async function meshScripts(): Promise<string[]> {
  return (await readdir(meshes, { recursive: true }))
    .filter((name) => name.endsWith(".py"))
    .map((name) => `${meshes}${name}`);
}

await test("no mesh script imports shared", async () => {
  const importers: string[] = [];
  for (const path of await meshScripts()) {
    if (/(from|import)\s+shared\b|import_module\(["']shared/.test(await readFile(path, "utf8")))
      importers.push(path);
  }
  assert.deepEqual(importers, []);
});

await test(`the mesh library and scripts hold at most ${String(maxMeshLines)} lines`, async () => {
  let lines = 0;
  for (const path of await meshScripts()) {
    lines += (await readFile(path, "utf8")).split("\n").length - 1;
  }
  assert.ok(lines <= maxMeshLines, `${String(lines)} lines`);
});

const printedKinds: Record<string, string> = {
  clock: "train-station/clock.py",
  "departure-board": "train-station/departure-board.py",
  sign: "train-station/sign.py",
  "ticket-counter": "train-station/ticket-counter.py",
  "ticket-machine": "train-station/ticket-machine.py",
};

for (const [kind, script] of Object.entries(printedKinds)) {
  await test(`printed ${kind}`, async () => {
    const source = await readFile(`${meshes}${script}`, "utf8");
    assert.ok(!source.includes("fonts.load"), "the script loads no font");
    assert.ok(!source.includes("/System/Library/Fonts"), "the script names no system font");
    const svg = await readFile(`${meshes}${script.replace(/\.py$/, ".print.svg")}`, "utf8").catch(
      () => undefined,
    );
    assert.notEqual(svg, undefined, "the script has a sibling .print.svg");
  });
}
