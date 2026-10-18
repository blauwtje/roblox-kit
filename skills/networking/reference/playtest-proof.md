# Playtest proof (step 12)

Run both in one multiplayer or play-mode playtest with the server checks body `require(game.ServerScriptService.NetworkChecks)(check, expectedClients)` and the client checks body `require(game.ReplicatedStorage.NetworkClientChecks)(check, player)`; the playtest skill covers the call.

The client sends bad data and the server checks prove each rejection left server state unchanged:

- Out-of-range values, NaN, wrong Instance classes and floods go through Blink's generated client, which does not validate on write because `WriteValidations` defaults to `false`.
- Wrong primitive types and truncated payloads go raw to `ReplicatedStorage.BLINK_RELIABLE_REMOTE`, which the generated server reads as `(buffer, {Instance})`. These raw checks tie to the 0.18.9 wire format: rerun them before bumping Blink.
- Game-code rejections are also asserted through `Rejections.count`. Run `selene` and `stylua --check` when the project has them.
