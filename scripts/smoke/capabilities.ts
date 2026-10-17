import { config } from "../../src/config.ts";
import { runLuauFile } from "../../src/luau/run-luau-file.ts";
import { selectStudio, type StudioConnection } from "../../src/studio/studio-connection.ts";
import { type Capability, capabilitiesSchema, probeTool } from "./shared.ts";

/** Characters the probe asks `execute_luau` for: well past its limit, so the cut must show. */
export const oversizedResultLength = config.executeLuauMaxResultChars * 10;

export async function probeLargeResult(
  connection: StudioConnection,
  studioId: string,
): Promise<string> {
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

export async function probeScreenCapture(
  connection: StudioConnection,
  studioId: string,
): Promise<string> {
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

export async function probeCapabilities(connection: StudioConnection): Promise<Capability[]> {
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
