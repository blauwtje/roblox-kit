import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
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
