import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";

const bundledLuauDirectory = new URL("../../luau/", import.meta.url);

export interface RunLuauFileRequest<Schema extends z.ZodType> {
  connection: StudioConnection;
  studioId: string;
  /** Name of a file in the bundled `luau/` folder, such as `ping.luau`. */
  fileName: string;
  /** Where `execute_luau` runs the file. */
  datamodelType: "Edit" | "Client" | "Server";
  /** Any JSON value; the file reads it as `local arguments = ...`. */
  arguments: unknown;
  /** Shape of the JSON string the file returns. */
  resultSchema: Schema;
  /** Upper bound of the `execute_luau` call; defaults to the connection's own timeout. */
  timeoutMs?: number;
}

/** The shortest long-bracket opener whose closer does not occur inside the text. */
function longBracketAround(text: string): string {
  let level = 0;
  while (text.includes(`]${"=".repeat(level)}]`)) {
    level += 1;
  }
  const equals = "=".repeat(level);
  return `[${equals}[${text}]${equals}]`;
}

/**
 * The file body becomes the body of a function called with the decoded arguments, so `...` holds
 * them and a top-level `return` hands the result back. The body starts on line 2 of the sent code.
 */
function wrapFileBody(fileBody: string, argumentsJson: string): string {
  const decodedArguments = `game:GetService("HttpService"):JSONDecode(${longBracketAround(argumentsJson)})`;
  return `return (function(...)\n${fileBody}\nend)(${decodedArguments})`;
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((item) => (item.type === "text" ? (item.text ?? "") : "")).join("");
}

/**
 * Runs a bundled Luau file in Studio through `execute_luau` with JSON arguments and parses the JSON
 * string it returns with `resultSchema`. Throws with Studio's message when the code fails, and
 * with the offending text when the result is not the JSON the schema describes.
 */
export async function runLuauFile<Schema extends z.ZodType>(
  request: RunLuauFileRequest<Schema>,
): Promise<z.output<Schema>> {
  const fileBody = await readFile(new URL(request.fileName, bundledLuauDirectory), "utf8");
  const argumentsJson = JSON.stringify(request.arguments) as string | undefined;
  const code = wrapFileBody(fileBody, argumentsJson ?? "null");
  const toolResult = await request.connection.callTool({
    name: "execute_luau",
    studioId: request.studioId,
    arguments: { code, datamodel_type: request.datamodelType },
    timeoutMs: request.timeoutMs,
  });
  const text = resultText(toolResult);
  if (toolResult.isError === true) {
    throw new Error(`${request.fileName} failed in Studio: ${text}`);
  }
  if (text.endsWith(config.executeLuauTruncationMarker)) {
    throw new Error(
      `${request.fileName} returned more than ${String(config.executeLuauMaxResultChars)} characters and Studio truncated it. Narrow the request (fewer zones or parts, or a smaller page) and retry.`,
    );
  }
  let resultJson: unknown;
  try {
    resultJson = JSON.parse(text);
  } catch {
    throw new Error(`${request.fileName} did not return a JSON string. Studio returned: ${text}`);
  }
  const parsed = request.resultSchema.safeParse(resultJson);
  if (!parsed.success) {
    throw new Error(
      `${request.fileName} returned JSON of the wrong shape:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
