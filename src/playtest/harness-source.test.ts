import assert from "node:assert/strict";
import { test } from "node:test";
import { clientHarnessSource, playtestProbeSource, serverHarnessSource } from "./harness-source.ts";

const checkBody = 'check("spawn exists", workspace:FindFirstChild("Spawn") ~= nil, "$& $1")';
const marker = "-- roblox-kit:check-body";
const harnesses = [
  { peer: "server", build: serverHarnessSource },
  { peer: "client", build: clientHarnessSource },
  { peer: "probe", build: playtestProbeSource },
];

for (const { peer, build } of harnesses) {
  await test(`${peer} harness holds the check body once, literally, in place of the marker`, async () => {
    const source = await build(checkBody);
    assert.equal(source.split(checkBody).length - 1, 1);
    assert.ok(!source.includes(marker));
    assert.ok(source.startsWith("--!strict\n"));
  });
}

await test("the server and client harnesses agree on the report event name", async () => {
  const [server, client] = await Promise.all([serverHarnessSource(""), clientHarnessSource("")]);
  const eventName = /REPORT_EVENT_NAME = "([^"]+)"/;
  assert.ok(eventName.exec(server)?.[1]);
  assert.equal(eventName.exec(server)?.[1], eventName.exec(client)?.[1]);
});
