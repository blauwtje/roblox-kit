import { readFile } from "node:fs/promises";

const bundledLuauDirectory = new URL("../../luau/", import.meta.url);

/** The one line of each harness file that the check body replaces. */
const checkBodyMarker = "-- roblox-kit:check-body";

async function harnessSource(fileName: string, checkBody: string): Promise<string> {
  const template = await readFile(new URL(fileName, bundledLuauDirectory), "utf8");
  if (!template.includes(checkBodyMarker)) {
    throw new Error(`${fileName} has no "${checkBodyMarker}" line to splice the check body into.`);
  }
  // A replacer function keeps `$` sequences in the body literal.
  return template.replace(checkBodyMarker, () => checkBody);
}

/**
 * Source of the server harness Script with `checkBody` as the body of
 * `runChecks(check, expectedClients)`, where `check(name, passed, detail)` records one result.
 */
export function serverHarnessSource(checkBody: string): Promise<string> {
  return harnessSource("playtest-server-harness.luau", checkBody);
}

/**
 * Source of the client harness LocalScript with `checkBody` as the body of
 * `runChecks(check, player)`, where `check(name, passed, detail)` records one result.
 */
export function clientHarnessSource(checkBody: string): Promise<string> {
  return harnessSource("playtest-client-harness.luau", checkBody);
}

/**
 * Source of the `run_in_playtest` probe Script with `code` as the body of `probe()`, which returns
 * one JSON-encodable value.
 */
export function playtestProbeSource(code: string): Promise<string> {
  return harnessSource("playtest-probe.luau", code);
}
