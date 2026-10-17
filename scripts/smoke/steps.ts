import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { type Capability, executeLuau, expectEqual, probeTool } from "./shared.ts";
import { cleanupLuau, placeStateLuau, placeStateSchema, probeRemoveMapLighting } from "./remove.ts";
import { lightingStateLuau, lightingStateSchema, probeLighting } from "./lighting.ts";
import {
  probeAmbientEffects,
  probeBuildMap,
  probeFacade,
  probeHeroProps,
  probeMapDecor,
  probePaintedMap,
  probeProfileTrim,
  probeTerrainHeightmap,
} from "./build.ts";
import {
  playClientChecks,
  playServerChecks,
  probeIdleAnimation,
  probePlaytest,
} from "./playtest.ts";
import { probeBlockingModel, probeCheckMap } from "./check.ts";
import { probeCaptureZones } from "./capture.ts";

/** Name of the step that builds the smoke map every later step uses; `--only` always keeps it. */
export const buildStepName = "build_map";

/** The steps `--only` names plus the build step, or every step without `--only`; a term naming no step fails. */
export function selectSteps(
  steps: [string, () => Promise<string>][],
  onlyTerms: string[] | undefined,
): [string, () => Promise<string>][] {
  if (onlyTerms === undefined) {
    return steps;
  }
  const unmatched = onlyTerms.filter((term) => !steps.some(([name]) => name.includes(term)));
  if (unmatched.length > 0) {
    throw new Error(`--only matches no smoke step: ${unmatched.join(", ")}`);
  }
  return steps.filter(
    ([name]) => name === buildStepName || onlyTerms.some((term) => name.includes(term)),
  );
}

/** Builds the smoke map, drives the tools against it and always removes what it inserted. */
export async function probeMapTools(
  connection: StudioConnection,
  options: { multiplayer: boolean; onlyTerms: string[] | undefined },
): Promise<Capability[]> {
  const studioId = await selectStudio(connection, undefined);
  const findings: Capability[] = [];
  await executeLuau(connection, studioId, cleanupLuau);
  const lightingBefore = lightingStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
  );
  const stateBefore = placeStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, placeStateLuau)),
  );
  try {
    const steps: [string, () => Promise<string>][] = [
      [buildStepName, () => probeBuildMap(connection)],
      ["build_map palette colors and MaterialVariant", () => probePaintedMap(connection)],
      ["build_map ceilings, generators and generated props", () => probeMapDecor(connection)],
      ["build_map hero props", () => probeHeroProps(connection)],
      ["build_map profile trim", () => probeProfileTrim(connection)],
      ["build_map facade", () => probeFacade(connection)],
      ["build_map lights and lighting recipe", () => probeLighting(connection)],
      ["build_map terrain heightmap", () => probeTerrainHeightmap(connection)],
      ["build_map ambient effects", () => probeAmbientEffects(connection)],
      ["build_map idle animation", () => probeIdleAnimation(connection)],
      ["check_map", () => probeCheckMap(connection)],
      ["check_map names a model blocking a walk", () => probeBlockingModel(connection)],
      ["capture_zones", () => probeCaptureZones(connection)],
      [
        "run_playtest play with a server and a client check",
        () =>
          probePlaytest(
            connection,
            {
              mode: "play",
              serverChecks: playServerChecks,
              clientChecks: playClientChecks,
              timeoutSeconds: 30,
            },
            2,
          ),
      ],
    ];
    if (options.multiplayer) {
      steps.push([
        "run_playtest multiplayer with 2 players",
        () =>
          probePlaytest(
            connection,
            {
              mode: "multiplayer",
              players: 2,
              serverChecks: `check("two clients expected", expectedClients == 2, tostring(expectedClients))\ncheck("GetTestArgs is a table", typeof(game:GetService("StudioTestService"):GetTestArgs()) == "table", "")`,
              clientChecks: playClientChecks,
              timeoutSeconds: 40,
            },
            3,
          ),
      ]);
    }
    // Last: it removes the smoke map, which the steps above use.
    steps.push([
      "remove_map keeps lighting until the last styled map goes",
      () => probeRemoveMapLighting(connection, lightingBefore, stateBefore),
    ]);
    for (const [capability, attempt] of selectSteps(steps, options.onlyTerms)) {
      findings.push(await probeTool(capability, attempt));
    }
  } finally {
    await executeLuau(connection, studioId, cleanupLuau);
  }
  const state = placeStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, placeStateLuau)),
  );
  const lightingAfter = lightingStateSchema.parse(
    JSON.parse(await executeLuau(connection, studioId, lightingStateLuau)),
  );
  findings.push(
    await probeTool("place restored after the smoke", () => {
      expectEqual("Lighting", lightingAfter, lightingBefore);
      expectEqual("Workspace children", state.workspace, stateBefore.workspace);
      expectEqual("ServerStorage children", state.serverStorage, 0);
      expectEqual("terrain voxels over the map region", state.solidTerrainVoxels, 0);
      expectEqual("harness scripts left", state.harnesses, 0);
      expectEqual("smoke MaterialVariants left", state.smokeVariants, 0);
      return Promise.resolve(JSON.stringify(state));
    }),
  );
  return findings;
}
