import { fileURLToPath } from "node:url";
import { config } from "../src/config.ts";
import { awaitEditMode } from "../src/studio/await-edit-mode.ts";
import { acquireStudioLock } from "../src/studio/studio-lock.ts";
import { StudioMcpClient } from "../src/studio/studio-mcp-client.ts";
import { textOf } from "./studio-insert.ts";

/**
 * `node scripts/probe-create-asset.ts` answers X3: can `AssetService:CreateAssetAsync` upload an
 * EditableImage made inside `execute_luau`, without an Open Cloud key? It makes a 4x4 gradient
 * EditableImage, uploads it and prints Studio's reply, then `RESULT: yes <asset id>` or
 * `RESULT: no <reason>`. A Studio error or permission refusal is a valid answer and prints `RESULT: no`.
 * It exits 1 only when Studio is unreachable. The one upload stays on the account.
 */

const luau = `
local AssetService = game:GetService("AssetService")
local HttpService = game:GetService("HttpService")
local made, image = pcall(function()
  return AssetService:CreateEditableImage({ Size = Vector2.new(4, 4) })
end)
if not made then
  return HttpService:JSONEncode({ stage = "CreateEditableImage", ok = false, message = tostring(image) })
end
local pixels = buffer.create(4 * 4 * 4)
for index = 0, 15 do
  buffer.writeu8(pixels, index * 4, index * 16)
  buffer.writeu8(pixels, index * 4 + 1, 128)
  buffer.writeu8(pixels, index * 4 + 2, 255 - index * 16)
  buffer.writeu8(pixels, index * 4 + 3, 255)
end
image:WritePixelsBuffer(Vector2.zero, Vector2.new(4, 4), pixels)
local uploaded, result, assetId = pcall(function()
  return AssetService:CreateAssetAsync(image, Enum.AssetType.Image, {
    Name = "roblox-kit probe X3",
    Description = "EditableImage upload probe",
  })
end)
if not uploaded then
  return HttpService:JSONEncode({ stage = "CreateAssetAsync", ok = false, message = tostring(result) })
end
return HttpService:JSONEncode({ stage = "CreateAssetAsync", ok = true, result = tostring(result), assetId = assetId })
`;

const releaseStudioLock = await acquireStudioLock({
  lockFile: fileURLToPath(new URL(`../${config.studioLockFile}`, import.meta.url)),
});
const connection = new StudioMcpClient({
  clientInfo: { name: `${config.serverName}-probe-create-asset`, version: config.serverVersion },
  timeoutMs: config.upstreamTimeoutMs,
});
try {
  const studioId = await awaitEditMode(connection);
  const result = await connection.callTool({
    name: "execute_luau",
    studioId,
    arguments: { code: luau, datamodel_type: "Edit" },
  });
  const text = textOf(result);
  console.log(text);
  if (result.isError === true) {
    console.log(`RESULT: no execute_luau error`);
  } else {
    const reply = /"assetId":\s*(\d+)/.exec(text);
    console.log(
      reply === null
        ? "RESULT: no no asset id in reply"
        : `RESULT: yes rbxassetid://${reply[1] ?? ""}`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.close();
  await releaseStudioLock();
}
