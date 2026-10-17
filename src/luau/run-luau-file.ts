import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "../config.ts";
import type { StudioConnection } from "../studio/studio-connection.ts";
import { inlineRequires } from "./inline-requires.ts";

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
  const fileBody = await bundledFileBody(request.fileName);
  const argumentsJson = JSON.stringify(request.arguments) as string | undefined;
  const code = wrapFileBody(fileBody, argumentsJson ?? "null");
  const text = await executeLuau(request, request.fileName, code);
  return parseResult(request.fileName, parseJson(request.fileName, text), request.resultSchema);
}

export interface LuauBatchEntry<Schema extends z.ZodType> {
  fileName: string;
  arguments: unknown;
  resultSchema: Schema;
}

type BatchResults<Entries extends readonly LuauBatchEntry<z.ZodType>[]> = {
  -readonly [Index in keyof Entries]: z.output<Entries[Index]["resultSchema"]>;
};

export interface RunLuauBatchRequest<Entries extends readonly LuauBatchEntry<z.ZodType>[]> {
  connection: StudioConnection;
  studioId: string;
  datamodelType: "Edit" | "Client" | "Server";
  entries: Entries;
  timeoutMs?: number;
}

/**
 * Runs several bundled Luau files in one `execute_luau` call. Each file runs in order with its own
 * arguments; the call returns one JSON array of their JSON results, parsed per entry into a tuple.
 */
export async function runLuauBatch<const Entries extends readonly LuauBatchEntry<z.ZodType>[]>(
  request: RunLuauBatchRequest<Entries>,
): Promise<BatchResults<Entries>> {
  const names = request.entries.map((entry) => entry.fileName).join(", ");
  const calls: string[] = [];
  for (const [index, entry] of request.entries.entries()) {
    const fileBody = await bundledFileBody(entry.fileName);
    const argumentsJson = (JSON.stringify(entry.arguments) as string | undefined) ?? "null";
    const call = wrapFileBody(fileBody, argumentsJson).slice("return ".length);
    calls.push(`results[${String(index + 1)}] = ${call}`);
  }
  const code = `local results = {}\n${calls.join("\n")}\nreturn "[" .. table.concat(results, ",") .. "]"`;
  const text = await executeLuau(request, names, code);
  const array = parseJson(names, text);
  if (!Array.isArray(array) || array.length !== request.entries.length) {
    throw new Error(`${names} did not return one result per file. Studio returned: ${text}`);
  }
  const parsed = request.entries.map((entry, index) =>
    parseResult(entry.fileName, array[index], entry.resultSchema),
  );
  return parsed as BatchResults<Entries>;
}

const bundledTexts = new Map<string, string>();

async function bundledFileBody(fileName: string): Promise<string> {
  const memoized = bundledTexts.get(fileName);
  if (memoized !== undefined) {
    return memoized;
  }
  const fileUrl = new URL(fileName, bundledLuauDirectory);
  const bundled = inlineRequires(await readFile(fileUrl, "utf8"), fileUrl);
  bundledTexts.set(fileName, bundled);
  return bundled;
}

async function executeLuau(
  request: {
    connection: StudioConnection;
    studioId: string;
    datamodelType: string;
    timeoutMs?: number;
  },
  label: string,
  code: string,
): Promise<string> {
  const toolResult = await request.connection.callTool({
    name: "execute_luau",
    studioId: request.studioId,
    arguments: { code, datamodel_type: request.datamodelType },
    timeoutMs: request.timeoutMs,
  });
  const text = resultText(toolResult);
  if (toolResult.isError === true) {
    throw new Error(`${label} failed in Studio: ${text}`);
  }
  if (text.endsWith(config.executeLuauTruncationMarker)) {
    throw new Error(
      `${label} returned more than ${String(config.executeLuauMaxResultChars)} characters and Studio truncated it. Narrow the request (fewer zones or parts, or a smaller page) and retry.`,
    );
  }
  return text;
}

function parseJson(label: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} did not return a JSON string. Studio returned: ${text}`);
  }
}

function parseResult<Schema extends z.ZodType>(
  label: string,
  json: unknown,
  schema: Schema,
): z.output<Schema> {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${label} returned JSON of the wrong shape:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
