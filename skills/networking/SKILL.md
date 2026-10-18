---
name: networking
description: Safe client-server communication (RemoteEvents, RemoteFunctions, UnreliableRemoteEvents, Blink) with validation, rate limiting and server authority in a Rojo + Rokit game. Use for "remote event", "send to server", "stop exploiters", "anti cheat", "client server". Not for DataStore saving, receipts, game passes, maps or playtests.
---

# Networking

A remote that works with the game's own client can still be abused by any exploiter who sends other data: a NaN position, a wrong-class Instance, a flood, a request for someone else's item. The enemy is hand-written `RemoteEvent` handlers that trust the payload or the client's claim about the outcome. The overcorrection is rewriting working network code the user did not ask you to touch, or building anti-cheat (detection, bans, kicks) when the job is rejecting bad input and leaving state unchanged.

## Rough requests

Keep every ask, name and limit stated. Fill only what the work needs from code defaults; add nothing unasked. Ask only when two readings give materially different results: the fewest questions, each short and plain. Do not wait for plan approval; act at once. Ask only if the event's direction is unclear.

## When to use

- Adding or changing a client-to-server or server-to-client event or function in the user's game, or reviewing code that calls `RemoteEvent`, `RemoteFunction` or `UnreliableRemoteEvent` directly.
- Validating what a client sends, rate limiting it, or deciding what the client may decide.
- Not for saving data or purchases (the data skill), this plugin's own code, maps, playtests or generic Luau: their own skills own those.
- Out of scope, so say so and list them as follow-ups: Roblox's server authority model with client prediction (`Workspace.AuthorityMode`), anti-cheat detection and bans, and ECS replication. This skill only counts rejections so a later spec has data.

## Process

1. **Pin Blink 0.18.9 through Rokit.** Run `rokit add 1Axen/blink@0.18.9` (or add the line by hand) so `rokit.toml` holds the pin and its comment (lines in `${CLAUDE_SKILL_DIR}/reference/blink-types.md`).
   Never use `1.0.0-pre` or older: 0.18.9 fixes NaN bypassing range validation. Keep the comment.
2. **Define every remote in `network/game.blink`.** Set `option ServerOutput = "generated/Server.luau"` and `option ClientOutput = "generated/Client.luau"`, and leave `RemoteScope` at its default. Never write a bare `RemoteEvent` for new game code. Start from `${CLAUDE_SKILL_DIR}/templates/network/game.blink` and replace its events.
3. **Type every field as tightly as the game allows.** Blink rejects data outside its type before any game code runs, so the type is the first check. Give every number a range (NaN fails a range check only from 0.18.9 on), every string a length range and every array a size range; name the class of every Instance (a class check only; step 6 covers the rest); `vector` has no range (step 6). Read when: writing a `.blink` type or choosing a call mode or event type: `${CLAUDE_SKILL_DIR}/reference/blink-types.md`.
4. **Choose the call mode and event type.** Default to `SingleAsync` or `ManyAsync` and `Type: Reliable`; use `Sync` or `Unreliable` only with a stated reason; use a `function` only when the client needs a reply (details in the same reference).
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
9. **Wire it into Rojo.** Map the generated server file to `ServerScriptService.Network`, so it never replicates, and the generated client file to `ReplicatedStorage.Network`.
   Entries: `${CLAUDE_SKILL_DIR}/reference/blink-types.md`.
   Never map the server file into `ReplicatedStorage`, and never put a game-code module there that holds server secrets.
10. **Treat generated Blink output as generated.** Run `blink network/game.blink --yes` (Blink 0.18.9 waits on a terminal prompt without `--yes`) and then follow the commit, lint-exclusion and diff rules in the reference (Read when: regenerating Blink output): `${CLAUDE_SKILL_DIR}/reference/blink-types.md`.
11. **Copy the templates** from `${CLAUDE_SKILL_DIR}/templates/` into the game and adapt only what they mark: `game.blink` and its output, `Validate`, `RateLimit`, `Rejections`, `Pickups`, `Main.server` and the two check modules. Read when: copying them, for what each adapts: `${CLAUDE_SKILL_DIR}/reference/blink-types.md`.
12. **Prove it with `run_playtest`.** Put `NetworkChecks` in `ServerScriptService` and `NetworkClientChecks` in `ReplicatedStorage`, and run both in one multiplayer or play-mode playtest; the playtest skill covers the call. Read when: writing or running the checks, with their exact bodies: `${CLAUDE_SKILL_DIR}/reference/playtest-proof.md`.
13. **Say what is not covered.** The playtest proves rejection and unchanged state for the sends it makes, not that every event is covered: each new `From: Client` event needs its own bad-data sends. It does not prove behaviour at real network latency, loss or packet reordering.

## Judgment

- Unchanged server state after a bad send outranks a helpful error: reject silently, count, return.
- The server's own state outranks anything in the payload: a client names an intent, never a result.
- A tight Blink type outranks a hand-written check where Blink can express it; a hand-written check outranks trust where it cannot.
- Async by default outranks a small speedup from a Sync event; use Sync only with the stated reason.
- The user's existing remotes outrank these templates: report what you would change in code you were not asked to touch, and move it to Blink only when asked.
