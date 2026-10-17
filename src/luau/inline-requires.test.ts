import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { inlineRequires } from "./inline-requires.ts";

function fixture(files: Record<string, string>): URL {
  const directory = mkdtempSync(join(tmpdir(), "inline-requires-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name, ".."), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return pathToFileURL(join(directory, "main.luau"));
}

await test("replaces a relative require line with an immediately called function of the module body", () => {
  const url = fixture({ "util.luau": "return { one = 1 }" });
  const output = inlineRequires('local Util = require("./util")\nreturn Util.one', url);
  assert.equal(output, "local Util = (function()\nreturn { one = 1 }\nend)()\nreturn Util.one");
});

await test("inlines nested requires relative to the requiring module", () => {
  const url = fixture({
    "lib/a.luau": 'local B = require("./b")\nreturn B',
    "lib/b.luau": "return 2",
  });
  const output = inlineRequires('local A = require("./lib/a")', url);
  assert.ok(output.includes("local B = (function()\nreturn 2\nend)()"));
  assert.ok(!output.includes("require("));
});

await test("inlines a module required twice once", () => {
  const url = fixture({ "util.luau": "return 1" });
  const output = inlineRequires('local A = require("./util")\nlocal B = require("./util")', url);
  assert.equal(output.split("return 1").length - 1, 1);
  assert.ok(output.endsWith("local B = A"));
});

await test("throws on a missing module file", () => {
  const url = fixture({});
  assert.throws(
    () => inlineRequires('local X = require("./nope")', url),
    /Cannot inline require\("\.\/nope"\)/,
  );
});

await test("leaves non-relative requires alone", () => {
  const url = fixture({});
  const source = "local X = require(script.Parent.X)";
  assert.equal(inlineRequires(source, url), source);
});
