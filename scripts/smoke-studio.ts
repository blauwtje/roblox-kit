import { z } from "zod";
import { config } from "../src/config.ts";
import { runLuauFile } from "../src/luau/run-luau-file.ts";
import { selectStudio, type StudioConnection } from "../src/studio/studio-connection.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";

const capabilitiesSchema = z.array(
  z.object({ capability: z.string(), ok: z.boolean(), detail: z.string() }),
);
type Capability = z.output<typeof capabilitiesSchema>[number];

/** Characters the probe asks `execute_luau` for: well past its limit, so the cut must show. */
const oversizedResultLength = config.executeLuauMaxResultChars * 10;

/** Runs one tool call and turns its outcome into a capability entry. */
async function probeTool(capability: string, attempt: () => Promise<string>): Promise<Capability> {
  try {
    return { capability, ok: true, detail: await attempt() };
  } catch (error) {
    return {
      capability,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeLargeResult(connection: StudioConnection, studioId: string): Promise<string> {
  const result = await connection.callTool({
    name: "execute_luau",
    studioId,
    arguments: {
      code: `return string.rep("x", ${String(oversizedResultLength)})`,
      datamodel_type: "Edit",
    },
  });
  const returnedText = result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const expectedText =
    "x".repeat(config.executeLuauMaxResultChars) + config.executeLuauTruncationMarker;
  if (result.isError === true || returnedText !== expectedText) {
    throw new Error(
      `asked for ${String(oversizedResultLength)} characters, expected ${String(expectedText.length)} (${String(config.executeLuauMaxResultChars)} then the truncation marker), got ${String(returnedText.length)} ending in ${JSON.stringify(returnedText.slice(-config.executeLuauTruncationMarker.length))}`,
    );
  }
  return `${String(config.executeLuauMaxResultChars)} characters, then the truncation marker`;
}

async function probeScreenCapture(connection: StudioConnection, studioId: string): Promise<string> {
  const result = await connection.callTool({
    name: "screen_capture",
    studioId,
    arguments: {
      capture_id: "roblox-kit-probe",
      camera_position: [0, 40, 40],
      look_at_position: [0, 0, 0],
    },
  });
  const blockTypes = result.content.map((block) => block.type);
  if (result.isError === true || !blockTypes.includes("image")) {
    throw new Error(`no image content; blocks: ${JSON.stringify(result.content).slice(0, 300)}`);
  }
  return `content blocks: ${blockTypes.join(", ")}`;
}

async function probeCapabilities(connection: StudioConnection): Promise<Capability[]> {
  const studioId = await selectStudio(connection, undefined);
  const luauCapabilities = await runLuauFile({
    connection,
    studioId,
    fileName: "probe-capabilities.luau",
    datamodelType: "Edit",
    arguments: null,
    resultSchema: capabilitiesSchema,
  });
  return [
    ...luauCapabilities,
    await probeTool("execute_luau large result", () => probeLargeResult(connection, studioId)),
    await probeTool("screen_capture image content", () => probeScreenCapture(connection, studioId)),
  ];
}

const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-smoke`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const capabilities = await probeCapabilities(connection);
  console.log(JSON.stringify(capabilities, null, 2));
  process.exitCode = capabilities.every((entry) => entry.ok) ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
}
