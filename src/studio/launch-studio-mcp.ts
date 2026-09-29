import { spawn } from "node:child_process";
import { studioMcpCommand } from "./studio-mcp-command.ts";

/** Runs Studio's built-in MCP server with this process's stdio, so the client talks to it directly. */
function launchStudioMcp(): void {
  let target;
  try {
    target = studioMcpCommand(process.platform, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const child = spawn(target.command, target.args, { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(`Could not start ${target.command}: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
}

launchStudioMcp();
