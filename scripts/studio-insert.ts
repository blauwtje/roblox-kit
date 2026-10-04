import type { StudioConnection } from "../src/studio/studio-connection.ts";

/**
 * Helpers for the smoke scripts that insert scripts into the open place and remove them afterwards.
 * A parent is a Luau expression for the instance to insert into, such as `game:GetService("ReplicatedStorage")`;
 * every inserted instance carries a marker attribute so cleanup finds it again.
 */

/** Characters of source per `execute_luau` call, well under any request limit. */
const sourceChunkLength = 40_000;

export function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

export async function executeLuau(
  connection: StudioConnection,
  studioId: string,
  code: string,
): Promise<string> {
  const result = await connection.callTool({
    name: "execute_luau",
    studioId,
    arguments: { code, datamodel_type: "Edit" },
  });
  if (result.isError === true) throw new Error(`execute_luau failed: ${textOf(result)}`);
  return textOf(result);
}

/** A Luau long string that holds `text` verbatim: more `=` than any closing bracket inside it. */
export function longString(text: string): string {
  let level = 0;
  while (text.includes(`]${"=".repeat(level)}]`)) level += 1;
  const equals = "=".repeat(level);
  // The first newline after the opening bracket is dropped by Luau, so this one is not part of the text.
  return `[${equals}[\n${text}]${equals}]`;
}

/** Luau that destroys every direct child of the service carrying the marker attribute and returns the count. */
export function cleanupLuau(serviceName: string, markerAttribute: string): string {
  return `
local service = game:GetService("${serviceName}")
local removed = 0
for _, child in service:GetChildren() do
	if child:GetAttribute("${markerAttribute}") == true then
		child:Destroy()
		removed += 1
	end
end
return tostring(removed)`;
}

/** Destroys the marked children of one service and returns how many were removed. */
export async function removeMarked(
  connection: StudioConnection,
  studioId: string,
  serviceName: string,
  markerAttribute: string,
): Promise<string> {
  return await executeLuau(connection, studioId, cleanupLuau(serviceName, markerAttribute));
}

export function createLuau(
  parentPath: string,
  name: string,
  className: string,
  markerAttribute: string,
): string {
  return `
local parent = ${parentPath}
local instance = Instance.new("${className}")
instance.Name = "${name}"
instance:SetAttribute("${markerAttribute}", true)
instance.Parent = parent
return "ok"`;
}

export async function createInstance(
  connection: StudioConnection,
  studioId: string,
  markerAttribute: string,
  parentPath: string,
  name: string,
  className: string,
): Promise<void> {
  await executeLuau(connection, studioId, createLuau(parentPath, name, className, markerAttribute));
}

/** Creates the marked script under the parent, then fills its source in chunks. */
export async function insertScript(
  connection: StudioConnection,
  studioId: string,
  markerAttribute: string,
  parentPath: string,
  name: string,
  className: string,
  source: string,
): Promise<void> {
  await createInstance(connection, studioId, markerAttribute, parentPath, name, className);
  for (let start = 0; start < source.length; start += sourceChunkLength) {
    const chunk = source.slice(start, start + sourceChunkLength);
    await executeLuau(
      connection,
      studioId,
      `
local target = ${parentPath}:FindFirstChild("${name}")
assert(target, "${name} was not inserted")
target.Source ..= ${longString(chunk)}
return "ok"`,
    );
  }
}
