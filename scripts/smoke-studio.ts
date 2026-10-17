import { runScript, withStudio } from "./lib/run-script.ts";
import { probeCapabilities } from "./smoke/capabilities.ts";
import { probeMapTools } from "./smoke/steps.ts";

/**
 * Server & Clients opens one Studio window per player, so it runs only on `--multiplayer`.
 * `--only a,b` runs only the map-tool steps whose name contains one of the comma-separated terms,
 * plus build_map, which the others use, and the place-restored check; it skips the capability probes.
 */
await runScript({
  name: "smoke-studio",
  usage: "Usage: node scripts/smoke-studio.ts [--multiplayer] [--only <terms>]",
  options: { multiplayer: { type: "boolean" }, only: { type: "string" } },
  run: (values) =>
    withStudio({ name: "smoke" }, async (connection) => {
      const onlyTerms =
        typeof values.only === "string"
          ? values.only
              .split(",")
              .map((term) => term.trim())
              .filter((term) => term !== "")
          : undefined;
      const capabilities = [
        ...(onlyTerms === undefined ? await probeCapabilities(connection) : []),
        ...(await probeMapTools(connection, {
          multiplayer: values.multiplayer === true,
          onlyTerms,
        })),
      ];
      console.log(JSON.stringify(capabilities, null, 2));
      return capabilities.every((entry) => entry.ok) ? 0 : 1;
    }),
});
