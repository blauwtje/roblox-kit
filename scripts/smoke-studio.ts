import { runScript } from "./lib/run-script.ts";
import { runSmoke, smokeUsage } from "./smoke/steps.ts";

/**
 * Server & Clients opens one Studio window per player, so it runs only on `--multiplayer`.
 * `--only a,b` runs only the map-tool steps whose name contains one of the comma-separated terms,
 * plus build_map, which the others use, and the place-restored check; it skips the capability probes.
 */
await runScript({
  name: "smoke-studio",
  usage: smokeUsage,
  options: { multiplayer: { type: "boolean" }, only: { type: "string" } },
  run: (values) => runSmoke(values),
});
