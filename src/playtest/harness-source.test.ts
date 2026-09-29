import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { clientHarnessSource, serverHarnessSource } from "./harness-source.ts";

const checkBody = 'check("spawn exists", workspace:FindFirstChild("Spawn") ~= nil, "$& $1")';
const marker = "-- roblox-kit:check-body";
const harnesses = [
  { peer: "server", build: serverHarnessSource, file: "playtest-server-harness.luau" },
  { peer: "client", build: clientHarnessSource, file: "playtest-client-harness.luau" },
];

for (const { peer, build, file } of harnesses) {
  await test(`${peer} harness holds the check body once, literally, in place of the marker`, async () => {
    const source = await build(checkBody);
    assert.equal(source.split(checkBody).length - 1, 1);
    assert.ok(!source.includes(marker));
    assert.ok(source.startsWith("--!strict\n"));
  });

  await test(`${peer} harness file carries the marker on exactly one line`, async () => {
    const template = await readFile(new URL(`../../luau/${file}`, import.meta.url), "utf8");
    assert.equal(template.split(marker).length - 1, 1);
  });
}

await test("both harnesses use the same report event name", async () => {
  const eventNames = await Promise.all(
    harnesses.map(async ({ file }) => {
      const template = await readFile(new URL(`../../luau/${file}`, import.meta.url), "utf8");
      return /REPORT_EVENT_NAME = "([^"]+)"/.exec(template)?.[1];
    }),
  );
  assert.ok(eventNames[0]);
  assert.equal(eventNames[0], eventNames[1]);
});
