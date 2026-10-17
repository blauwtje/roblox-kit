import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FakeStudioConnection } from "../../src/studio/fake-studio-connection.ts";
import { runSmoke, smokeStepNames, smokeUsage } from "./steps.ts";

await test("the help text names every smoke step", () => {
  for (const name of smokeStepNames) {
    assert.ok(smokeUsage.includes(`  ${name}`), name);
  }
});

await test("an unknown --only term throws before any Studio connection is opened", async () => {
  const lockFile = join(await mkdtemp(join(tmpdir(), "smoke-steps-")), "studio.lock");
  const connections: FakeStudioConnection[] = [];
  await assert.rejects(
    runSmoke(
      { only: "check_map,no_such_step" },
      {
        lockFile,
        connect: () => {
          const connection = new FakeStudioConnection([{ id: "s1", name: "Place" }], {});
          connections.push(connection);
          return connection;
        },
      },
    ),
    /--only matches no smoke step: no_such_step/,
  );
  assert.equal(connections.length, 0);
});
