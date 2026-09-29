import type { CallToolResult } from "@modelcontextprotocol/client";

/** One Roblox Studio instance connected to StudioMCP, as `list_roblox_studios` reports it. */
export interface StudioInfo {
  id: string;
  name: string;
}

export interface StudioToolRequest {
  /** StudioMCP tool name, such as `execute_luau`. */
  name: string;
  studioId: string;
  /** Tool arguments without `studio_id`, which the connection adds. */
  arguments: Record<string, unknown>;
}

/** The only way this server reaches Studio; the real one wraps StudioMCP, tests use a fake. */
export interface StudioConnection {
  listStudios(): Promise<StudioInfo[]>;
  /** Returns the tool's own result, including `isError` results; rejects when Studio is unreachable. */
  callTool(request: StudioToolRequest): Promise<CallToolResult>;
  close(): Promise<void>;
}

function describeStudios(studios: StudioInfo[]): string {
  return studios.map((studio) => `- ${studio.name} (studioId: ${studio.id})`).join("\n");
}

/**
 * Picks the Studio a tool call targets: the requested id, or the only connected Studio when none
 * is requested. Throws with the list of connected Studios when neither rule settles it.
 */
export async function selectStudio(
  connection: StudioConnection,
  requestedId: string | undefined,
): Promise<string> {
  const studios = await connection.listStudios();
  if (requestedId !== undefined) {
    if (studios.some((studio) => studio.id === requestedId)) {
      return requestedId;
    }
    throw new Error(
      `No connected Roblox Studio has studioId "${requestedId}". Pass one of:\n${describeStudios(studios)}`,
    );
  }
  const [onlyStudio, ...otherStudios] = studios;
  if (onlyStudio === undefined) {
    throw new Error(
      "No Roblox Studio is connected. Open a place in Studio and turn on Assistant > Manage MCP Servers > Enable Studio as MCP server.",
    );
  }
  if (otherStudios.length > 0) {
    throw new Error(
      `Several Roblox Studios are connected. Pass studioId as one of:\n${describeStudios(studios)}`,
    );
  }
  return onlyStudio.id;
}
