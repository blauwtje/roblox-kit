import { win32 } from "node:path";

export interface StudioMcpCommand {
  command: string;
  args: string[];
}

const macosStudioMcpPath = "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP";
const windowsShell = "cmd.exe";
const windowsLauncherRelativePath = win32.join("Roblox", "mcp.bat");

/** The command Roblox documents for Studio's built-in MCP server on the given platform. */
export function studioMcpCommand(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): StudioMcpCommand {
  if (platform === "darwin") {
    return { command: macosStudioMcpPath, args: [] };
  }
  if (platform === "win32") {
    const localAppData = environment["LOCALAPPDATA"];
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is not set, so Roblox's mcp.bat cannot be located.");
    }
    return {
      command: windowsShell,
      args: ["/c", win32.join(localAppData, windowsLauncherRelativePath)],
    };
  }
  throw new Error(
    `Roblox Studio's MCP server is only available on macOS and Windows, not ${platform}.`,
  );
}
