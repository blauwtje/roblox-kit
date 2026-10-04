---
name: data
description: Use when writing or reviewing player data saving (ProfileStore), schema migrations, developer product receipts (ProcessReceipt) or game pass checks in a Rojo + Wally Roblox game. Not for leaderboards, trading or subscriptions, this plugin's own code, maps or playtests.
---

# Data

A save that works for one player in Studio can still lose or duplicate data at high CCU: two servers holding one profile, a receipt granted twice, a purchase acknowledged before it was saved. The enemy is hand-rolled `DataStore` or `ProcessReceipt` code that passes a solo test and fails under load, shutdown or a rolling update. The overcorrection is rewriting a working save system the user did not ask you to touch, or adding layers (own session locks, own `BindToClose` loops, hand compression) that ProfileStore already handles.

## When to use

- Saving or loading player data in the user's game, changing its schema, or reviewing code that calls `DataStoreService` directly.
- Selling developer products (`MarketplaceService.ProcessReceipt`) or checking game pass ownership.
- Not for this plugin's own code, maps, playtests or generic Luau: their own skills own those.
- Out of scope, so say so and stop: leaderboards and global state (ProfileStore "is not designed (and never will be)" for them), trading and gifting via `ProfileStore:MessageAsync`, and subscriptions.

## Process

1. **Pin ProfileStore through Wally.** Add `ProfileStore = "lm-loleris/profilestore@1.0.3"` under `[server-dependencies]` in `wally.toml`, because its realm is `server` and it lands in `ServerPackages`. Map `ServerPackages` into `ServerScriptService` in the Rojo project. Never copy ProfileStore's source into the game.
2. **Copy the templates into `ServerScriptService`,** next to each other, and adapt only what they mark:
   - `${CLAUDE_SKILL_DIR}/templates/PlayerData.luau`: join flow, `DataVersion`, migrations, Reconcile, shutdown. Adapt the one `ADAPT` line, `require(ServerScriptService.ServerPackages.ProfileStore)`, to where Wally put it, and add the game's fields to `Data` and `template`.
   - `${CLAUDE_SKILL_DIR}/templates/Receipts.luau`: developer products. Add one handler per product to `Receipts.productHandlers`, keyed by `ProductId`.
   - `${CLAUDE_SKILL_DIR}/templates/GamePasses.luau`: game pass ownership.
   - `${CLAUDE_SKILL_DIR}/templates/Main.server.luau`: calls each `start()` once, from this one script.
   - `${CLAUDE_SKILL_DIR}/templates/DataChecks.luau`: a playtest check module, used in step 12.
3. **Follow the join flow.** `StartSessionAsync(tostring(player.UserId), { Cancel = function() return player.Parent ~= Players end })`; kick on `nil` with "Profile load fail - Please rejoin"; call `profile:AddUserId(player.UserId)` so erasure requests find the profile; let `OnSessionEnd` clear the entry and kick; after the session starts, end it if `player.Parent ~= Players`.
4. **End sessions on leave, and nowhere else.** Call `EndSession` on `PlayerRemoving` (and on an early leave during load). Never write an own `BindToClose` loop: ProfileStore's own `BindToClose` ends and saves every active profile.
5. **Respect shutdown.**
   - Once `ProfileStore.IsClosing` is true, "most methods will silently fail", so start no sessions and rely on no saves after it is set.
   - With `DataStoreState ~= "Access"` (the mock store, or Studio without API access) ProfileStore's `BindToClose` does not wait for saves. No playtest proves shutdown saving, so tell the user that and never claim it was tested.
6. **Change the schema with migrations.** Keep an own `DataVersion` field and an ordered array of migration functions, where entry n upgrades version n-1 to n. They run on `profile.Data` right after the session starts and before `profile:Reconcile()`. Reconcile only fills missing keys and is not migration. Append a new entry for each change; never edit or reorder a shipped one.
7. **Refuse data newer than the code.** During a rolling update an old server can load a profile saved by a newer one. The template ends the session and kicks with a rejoin message instead of loading it, so an old server never migrates, reconciles or writes over fields it does not know. Keep that gate.
8. **Handle developer products with the ProfileStore devproducts pattern.** Keep a `PurchaseIdCache` array in `Profile.Data`, capped at `PURCHASE_ID_CACHE_SIZE = 100` (oldest dropped). Record the `PurchaseId`, grant the reward, call `profile:Save()` and wait on `profile.OnAfterSave`, rechecking every 10 s while `profile:IsActive()`. Return `PurchaseGranted` only once the id is in `profile.LastSavedData.PurchaseIdCache`. Return `NotProcessedYet` when the player is not in the server, the profile is not loaded or the session ended. State these ProcessReceipt facts to the user and build for them:
   - Set it once, in one server script.
   - It also receives Store tab purchases made outside the experience.
   - It has no time-based retry: after `NotProcessedYet` it runs again only when the user starts another purchase or rejoins any server.
   - It has no timeout.
   - Unresolved purchases are not removed or refunded.
   - A missing callback auto-acknowledges receipts, so a game that sells products must set one.
   - It may run on two servers at once.
   - A returned `PurchaseGranted` may fail to record and run again, so the `PurchaseId` cache must make a rerun grant nothing twice.
9. **Check game passes without ProcessReceipt.** Use `MarketplaceService:UserOwnsGamePassAsync(player.UserId, passId)` in `pcall`, plus `PromptGamePassPurchaseFinished` for in-session purchases; never `ProcessReceipt`. Results are cached, and a pass bought outside the experience during a session can take minutes to show.
10. **Keep data small.** Never compress by hand. The limits are 4,194,304 per key and `500 MB + 1 MB × lifetime user count` per experience, measured compressed.
11. **Test in Studio on the mock store.** The template uses `store.Mock` whenever `RunService:IsStudio()`, so Studio never touches live keys. Only if the user wants persistent progress in Studio, use a separate store name there, never live keys.
12. **Prove it with `run_playtest`.** Put `DataChecks` in `ServerScriptService` and run it with the server checks body `require(game.ServerScriptService.DataChecks)(check, expectedClients)`; the playtest skill covers the call. It covers receipts, migration and the newer-version gate, not shutdown saving. Run `selene` and `stylua --check` when the project has them.
13. **Name the manual check.** A Studio run cannot prove a Store tab purchase. On a published test place, create a dedicated developer product at the lowest price, because test mode costs real Robux. Enable test mode (Creator Hub, External Purchase Settings), buy it from the Store tab outside the game, join, and confirm the grant and that the receipt status shows Closed. Passing this validation is what unlocks selling developer products outside the game.

## Judgment

- A saved purchase outranks a fast reply: `NotProcessedYet` is safe, an unsaved `PurchaseGranted` is not.
- ProfileStore's own session and shutdown handling outranks any hand-written lock or `BindToClose`.
- Data an old server does not understand outranks that server's convenience: end the session, never write over it.
- The user's existing save code outranks these templates: report what you would change in code you were not asked to touch.
