import assert from "node:assert/strict";
import { test } from "node:test";
import { studioMcpCommand } from "./studio-mcp-command.ts";

await test("macOS runs the StudioMCP binary inside the app bundle", () => {
  assert.deepEqual(studioMcpCommand("darwin", {}), {
    command: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP",
    args: [],
  });
});

await test("Windows runs mcp.bat from LOCALAPPDATA through cmd.exe", () => {
  const environment = { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" };
  assert.deepEqual(studioMcpCommand("win32", environment), {
    command: "cmd.exe",
    args: ["/c", "C:\\Users\\dev\\AppData\\Local\\Roblox\\mcp.bat"],
  });
});

await test("Windows without LOCALAPPDATA fails with a clear message", () => {
  assert.throws(() => studioMcpCommand("win32", {}), /LOCALAPPDATA is not set/);
});

await test("other platforms are rejected by name", () => {
  assert.throws(
    () => studioMcpCommand("linux", {}),
    /only available on macOS and Windows, not linux/,
  );
});
