import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.ts";
import { drawSprite } from "../src/lighting/ambient-sprites.ts";
import { awaitEditMode } from "../src/studio/await-edit-mode.ts";
import { acquireStudioLock } from "../src/studio/studio-lock.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { textOf } from "./studio-insert.ts";

/**
 * `node scripts/probe-upload-image.ts` answers X1: does Studio MCP `upload_image` turn a baked PNG, served by a
 * local http server, into an rbxassetid without an Open Cloud key? It serves one sprite drawn by our own code,
 * calls `upload_image` on the open place and prints the tool's reply, then `RESULT: yes <rbxassetid>` or
 * `RESULT: no`. It exits 1 when Studio is unreachable or the tool errors. The one upload stays on the account.
 */

const png = drawSprite("glow");
const server = createServer((request, response) => {
  console.log(`served ${request.url ?? ""} (${String(png.length)} bytes)`);
  response.writeHead(200, { "content-type": "image/png", "content-length": png.length });
  response.end(png);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const imageUrl = `http://127.0.0.1:${String(port)}/probe-glow.png`;

const releaseStudioLock = await acquireStudioLock({
  lockFile: fileURLToPath(new URL(`../${config.studioLockFile}`, import.meta.url)),
});
const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-probe-upload-image`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const studioId = await awaitEditMode(connection);
  const result = await connection.callTool({
    name: "upload_image",
    studioId,
    arguments: { imagePaths: [imageUrl] },
  });
  const text = textOf(result);
  console.log(text);
  if (result.isError === true) throw new Error(`upload_image failed: ${text}`);
  const assetId = /rbxassetid:\/\/\d+/.exec(text)?.[0];
  console.log(assetId === undefined ? "RESULT: no" : `RESULT: yes ${assetId}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
  await releaseStudioLock();
  server.close();
}
