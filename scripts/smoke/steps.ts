import { withStudio, type WithStudioOptions } from "../lib/run-script.ts";
import { probeCapabilities } from "./capabilities.ts";
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
  probeSetPieceSeeds,
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
import { probeMeasureCapture } from "../smoke-vision.ts";

/** Every smoke step name in run order; `--help` prints them and `--only` checks its terms against them. */
export const stepName = {
  build: "build_map",
  painted: "build_map palette colors and MaterialVariant",
  decor: "build_map ceilings, generators and generated props",
  hero: "build_map hero props",
  seeds: "set pieces of same-type rooms get different seeds",
  trim: "build_map profile trim",
  facade: "build_map facade",
  lighting: "build_map lights and lighting recipe",
  terrain: "build_map terrain heightmap",
  ambient: "build_map ambient effects",
  idle: "build_map idle animation",
  check: "check_map",
  blocking: "check_map names a model blocking a walk",
  capture: "capture_zones",
  play: "run_playtest play with a server and a client check",
  multi: "run_playtest multiplayer with 2 players",
  remove: "remove_map keeps lighting until the last styled map goes",
  vision: "measure_capture raycast grid",
} as const;

export const smokeStepNames: string[] = Object.values(stepName);

/** Name of the step that builds the smoke map every later step uses; `--only` always keeps it. */
export const buildStepName = stepName.build;

/** Throws when an `--only` term is contained in no step name, so a typo fails before Studio is touched. */
export function checkOnlyTerms(onlyTerms: string[], names: string[] = smokeStepNames): void {
  const unmatched = onlyTerms.filter((term) => !names.some((name) => name.includes(term)));
  if (unmatched.length > 0) {
    throw new Error(`--only matches no smoke step: ${unmatched.join(", ")}`);
  }
}

/** The steps `--only` names plus the build step, or every step without `--only`; a term naming no step fails. */
export function selectSteps(
  steps: [string, () => Promise<string>][],
  onlyTerms: string[] | undefined,
): [string, () => Promise<string>][] {
  if (onlyTerms === undefined) {
    return steps;
  }
  checkOnlyTerms(
    onlyTerms,
    steps.map(([name]) => name),
  );
  return steps.filter(
    ([name]) => name === buildStepName || onlyTerms.some((term) => name.includes(term)),
  );
}

/** One real tool call of a smoke step and how long Studio took. */
export interface CallTiming {
  step: string;
  tool: string;
  ms: number;
}

function timeCalls(
  connection: StudioConnection,
  timings: CallTiming[],
  currentStep: () => string,
): StudioConnection {
  return {
    listStudios: () => connection.listStudios(),
    close: () => connection.close(),
    callTool: async (request) => {
      const start = performance.now();
      try {
        return await connection.callTool(request);
      } finally {
        timings.push({
          step: currentStep(),
          tool: request.name,
          ms: Math.round(performance.now() - start),
        });
      }
    },
  };
}

export const smokeUsage = `Usage: node scripts/smoke-studio.ts [--multiplayer] [--only <terms>]

--only takes comma-separated terms; a step runs when its name contains one of them. Steps:
${smokeStepNames.map((name) => `  ${name}`).join("\n")}`;

/** Parses `--only` and rejects a term naming no step; runs before any Studio connection is opened. */
export function parseOnlyTerms(only: unknown): string[] | undefined {
  if (typeof only !== "string") {
    return undefined;
  }
  const terms = only
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term !== "");
  checkOnlyTerms(terms);
  return terms;
}

/** The whole smoke: validates `--only`, then takes Studio, probes and prints the results and a per-call duration table. */
export async function runSmoke(
  values: { multiplayer?: unknown; only?: unknown },
  studioOptions: Partial<WithStudioOptions> = {},
): Promise<number> {
  const onlyTerms = parseOnlyTerms(values.only);
  const timings: CallTiming[] = [];
  const findings = await withStudio({ name: "smoke", ...studioOptions }, async (connection) => [
    ...(onlyTerms === undefined ? await probeCapabilities(connection) : []),
    ...(await probeMapTools(connection, {
      multiplayer: values.multiplayer === true,
      onlyTerms,
      timings,
    })),
  ]);
  console.log(JSON.stringify(findings, null, 2));
  console.table(timings);
  return findings.every((entry) => entry.ok) ? 0 : 1;
}

/** Builds the smoke map, drives the tools against it and always removes what it inserted. */
export async function probeMapTools(
  connection: StudioConnection,
  options: { multiplayer: boolean; onlyTerms: string[] | undefined; timings?: CallTiming[] },
): Promise<Capability[]> {
  let currentStep = "setup";
  const rawConnection = connection;
  connection = timeCalls(rawConnection, options.timings ?? [], () => currentStep);
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
      [stepName.painted, () => probePaintedMap(connection)],
      [stepName.decor, () => probeMapDecor(connection)],
      [stepName.hero, () => probeHeroProps(connection)],
      [stepName.seeds, () => Promise.resolve(probeSetPieceSeeds())],
      [stepName.trim, () => probeProfileTrim(connection)],
      [stepName.facade, () => probeFacade(connection)],
      [stepName.lighting, () => probeLighting(connection)],
      [stepName.terrain, () => probeTerrainHeightmap(connection)],
      [stepName.ambient, () => probeAmbientEffects(connection)],
      [stepName.idle, () => probeIdleAnimation(connection)],
      [stepName.check, () => probeCheckMap(connection)],
      [stepName.blocking, () => probeBlockingModel(connection)],
      [stepName.capture, () => probeCaptureZones(connection)],
      [
        stepName.play,
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
        stepName.multi,
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
      stepName.remove,
      () => probeRemoveMapLighting(connection, lightingBefore, stateBefore),
    ]);
    steps.push([stepName.vision, () => probeMeasureCapture(connection)]);
    for (const [capability, attempt] of selectSteps(steps, options.onlyTerms)) {
      currentStep = capability;
      findings.push(await probeTool(capability, attempt));
    }
  } finally {
    await executeLuau(connection, studioId, cleanupLuau);
  }
  currentStep = "teardown";
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
