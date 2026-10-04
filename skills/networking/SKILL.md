---
name: networking
description: Use when writing or reviewing client-server communication (RemoteEvents, RemoteFunctions, UnreliableRemoteEvents, or Blink) in a Rojo + Rokit Roblox game, including validation, rate limiting and server authority. Not for DataStore saving, receipts or game passes, this plugin's own code, maps or playtests.
---

# Networking

A remote that works with the game's own client can still be abused by any exploiter who sends other data: a NaN position, a wrong-class Instance, a flood, a request for someone else's item. The enemy is hand-written `RemoteEvent` handlers that trust the payload or the client's claim about the outcome. The overcorrection is rewriting working network code the user did not ask you to touch, or building anti-cheat (detection, bans, kicks) when the job is rejecting bad input and leaving state unchanged.

## When to use

- Adding or changing a client-to-server or server-to-client event or function in the user's game, or reviewing code that calls `RemoteEvent`, `RemoteFunction` or `UnreliableRemoteEvent` directly.
- Validating what a client sends, rate limiting it, or deciding what the client may decide.
- Not for saving data or purchases (the data skill), this plugin's own code, maps, playtests or generic Luau: their own skills own those.
- Out of scope, so say so and list them as follow-ups: Roblox's server authority model with client prediction (`Workspace.AuthorityMode`), anti-cheat detection and bans, and ECS replication. This skill only counts rejections so a later spec has data.

## Process

1. **Pin Blink 0.18.9 through Rokit.** Run `rokit add 1Axen/blink@0.18.9` (or add the line by hand) so `rokit.toml` holds the pin and the comment under it:
   ```toml
   # The networking raw-buffer checks depend on the 0.18.9 wire format: before bumping Blink, rerun the playtest checks that send raw buffers.
   blink = "1Axen/blink@0.18.9"
   ```
   Never use a `1.0.0-pre` release or anything older: 0.18.9 fixes NaN bypassing range validation. Keep the comment; bumping Blink means rerunning the raw-buffer checks (step 12) first.
2. **Define every remote in `network/game.blink`.** Set `option ServerOutput = "generated/Server.luau"` and `option ClientOutput = "generated/Client.luau"`, and leave `RemoteScope` at its default. Never write a bare `RemoteEvent` for new game code. Start from `${CLAUDE_SKILL_DIR}/templates/network/game.blink` and replace its events.
3. **Type every field as tightly as the game allows.** Blink rejects data outside its type before any game code runs, so the type is the first check.
   - Numbers: give every integer a range (`u8(1..8)`, not bare `u8`) and every `f32`/`f64` a range. NaN fails a range check only from 0.18.9 on, which is why step 1 pins it.
   - Strings: give a length range (`string(1..32)`); an unbounded string is unbounded memory.
   - Arrays and maps: give a size range (`Item[0..16]`) and bound a map's key and value types too. Never leave a collection open-ended.
   - Instances: name the class (`Instance(Model)`). That checks the class only, so a client can still name any Model in the place; step 6 covers the rest.
   - `vector` has no range, so a client can send NaN or infinity in a position; step 6 covers that too.
   - Prefer a struct of intent fields over one generic payload.
4. **Choose the call mode and event type.**
   - Default to `SingleAsync` or `ManyAsync`. Use `SingleSync` or `ManySync` only with a stated performance reason: Blink's events documentation says that yielding or erroring in a sync event "can cause undefined and sometimes game-breaking behaviour". With `SyncValidation`, a Sync listener that yields also gets its handler thread closed by whichever player's packet arrives next.
   - Use `Type: Reliable` by default. Use `Unreliable` only for frequent, loss-tolerant data (an effect, a position update) that stays under 1000 bytes, the limit both Blink's events documentation and Roblox's `UnreliableRemoteEvent` reference state. An event a player must not miss is `Reliable`.
   - Use a `function` with `Yield: Coroutine` only when the client needs a reply; the client waits on it, so a server handler for it must return quickly and may return `nil`.
5. **Let the client send intent only.** The payload says what the player wants (which item, which slot, where to drop), never the outcome (an amount to grant, a damage number, a new state, a price). The server decides every outcome from its own state: whose item it is, how far the character is, what the slot holds. Never read a stat, cooldown or permission from the payload. A value the server needs, such as the character's position, comes from the server's own `player.Character`.
6. **Check what Blink cannot, in every `From: Client` listener, before any state changes.** Every client-to-server event gets all of these that apply, in this order, and a failed check records a reason and returns:
   - Rate limit with `RateLimit.consume(player, "<Event>")`, so a flood stops at the first line.
   - Finite numbers: `Validate.isFiniteNumber` for an unranged number and `Validate.isFiniteVector3` for a `vector`, then the game's own bounds on the value.
   - Instances: `Validate.isInstanceWithin(item, container)` ties an Instance to the folder of things a client may name, because Blink checks only the class.
   - Context and ownership: the item is not owned by another player, the player has a living character, the character is within range, the slot holds an item.
   - Then, and only then, the side effect.
   - Run the checks and the side effect without yielding between them; if a handler must yield, rerun the checks after the yield.
     Keep one `RateLimit.configure` entry per `From: Client` event; `consume` throws for an event with no limit, which fails at the first call rather than passing silently.
7. **Reject silently and count.** A rejected call gets no reply, no kick and no `warn` per call. Call `Rejections.record(player, "<Event>.<check>")` with a short stable reason so a later anti-cheat spec has data per player per reason. Only game-code rejections are counted: Blink's own decode rejections `error()` inside its generated handler before game code runs, so game code has no hook to count them without editing generated files. A rejected packet drops only that player's own batch, never another player's events.
8. **Connect every `From: Client` listener at server start.** Do it once, in the bootstrap script, because Blink 0.18.9 queues events that have no listener without a limit (it only warns past 256). A second `On` for the same event replaces the first, so connect each event in exactly one place.
9. **Wire it into Rojo.** Map the generated server file to `ServerScriptService.Network`, so it never replicates, and the generated client file to `ReplicatedStorage.Network`:
   ```json
   "ServerScriptService": { "Network": { "$path": "network/generated/Server.luau" } },
   "ReplicatedStorage": { "Network": { "$path": "network/generated/Client.luau" } }
   ```
   Never map the server file into `ReplicatedStorage`, and never put a game-code module there that holds server secrets.
10. **Treat generated Blink output as generated.** Run `blink network/game.blink --yes` (Blink 0.18.9 waits on a terminal prompt without `--yes`) and then:
    - Commit `network/generated/Server.luau` and `network/generated/Client.luau`, and mark them in `.gitattributes`: `network/generated/** linguist-generated=true`.
    - Exclude them from linting and formatting: add `"network/generated/*"` to `exclude` in `selene.toml` and `network/generated/` to `.styluaignore`.
    - Never edit them by hand. Change `game.blink`, regenerate, and run `git diff network/generated` to confirm the diff is only what the change should cause, before calling work done.
11. **Copy the templates** from `${CLAUDE_SKILL_DIR}/templates/` into the game and adapt only what they mark:
    - `network/game.blink` and its `generated/` output: replace the sample events, regenerate (step 10), never copy the sample output over your own.
    - `Validate.luau`, `RateLimit.luau`, `Rejections.luau`: into `ServerScriptService`, next to each other and unchanged.
    - `Pickups.luau`: the sample server-authoritative handlers (pickup range, `Pickups` folder, slot count). Replace them with the game's handlers using the same check order, and keep `SLOT_COUNT` equal to the range in `game.blink`.
    - `Main.server.luau`: starts the modules, configures one rate limit per `From: Client` event and connects each listener once (step 8).
    - `NetworkChecks.luau` (server) and `NetworkClientChecks.luau` (client, into `ReplicatedStorage`): the playtest checks used in step 12. Adapt their fixtures and sends to the game's own events.
12. **Prove it with `run_playtest`.** Put `NetworkChecks` in `ServerScriptService` and `NetworkClientChecks` in `ReplicatedStorage`, and run both in one multiplayer or play-mode playtest with the server checks body `require(game.ServerScriptService.NetworkChecks)(check, expectedClients)` and the client checks body `require(game.ReplicatedStorage.NetworkClientChecks)(check, player)`; the playtest skill covers the call. The client sends bad data and the server checks prove each rejection left server state unchanged:
    - Out-of-range values, NaN, wrong Instance classes and floods go through Blink's generated client, which does not validate on write because `WriteValidations` defaults to `false`.
    - Wrong primitive types and truncated payloads go raw to `ReplicatedStorage.BLINK_RELIABLE_REMOTE`, which the generated server reads as `(buffer, {Instance})`. These raw checks tie to the 0.18.9 wire format: rerun them before bumping Blink.
    - Game-code rejections are also asserted through `Rejections.count`. Run `selene` and `stylua --check` when the project has them.
13. **Say what is not covered.** The playtest proves rejection and unchanged state for the sends it makes, not that every event is covered: each new `From: Client` event needs its own bad-data sends. It does not prove behaviour at real network latency, loss or packet reordering.

## Judgment

- Unchanged server state after a bad send outranks a helpful error: reject silently, count, return.
- The server's own state outranks anything in the payload: a client names an intent, never a result.
- A tight Blink type outranks a hand-written check where Blink can express it; a hand-written check outranks trust where it cannot.
- Async by default outranks a small speedup from a Sync event; use Sync only with the stated reason.
- The user's existing remotes outrank these templates: report what you would change in code you were not asked to touch, and move it to Blink only when asked.
