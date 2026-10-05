---
name: playtest
description: Use when a Roblox game needs a playtest in Studio: proving server or client behavior, spawns, doors or multiplayer with checks, or when a run_playtest result fails or times out. Not for building maps (map-building skill), writing Luau (luau skill) or animation.
---

# Playtest

A playtest proves something only when a check states a fact and a report says which facts held. The enemy is a session started by hand, glanced at in the console and called tested. The overcorrection is a multiplayer run for every small edit, when a server-only run answers it in seconds.

## When to use

- Proving behavior in a running game: spawns, doors, scripts, replication, what each player sees.
- A `run_playtest` call that returned `passed: false`, reported `errors` or threw.
- Not for map soundness (`check_map`, map-building skill), writing Luau (luau skill) or animation.

## Process

1. **Pick the smallest mode.** `run` is the server only, `play` (the default) adds one player, `multiplayer` adds `players` clients from 1 to 8, default 2. `players` outside `multiplayer` and `clientChecks` in `run` fail the call, because they could never take effect.
2. **Write check bodies, not functions.** `serverChecks` is the body of `runChecks(check, expectedClients)`. `clientChecks` is the body of `runChecks(check, player)` and every client runs it once. A call with neither fails.
3. **Record one fact per `check(name, passed, detail)`.** Put the measured value in `detail`, an optional string, so a failure explains itself. Put server-owned facts in `serverChecks` and `LocalPlayer` or `PlayerGui` facts in `clientChecks`, because each runs in its own script.
4. **Keep `timeoutSeconds` short.** It runs 1 to 300 and defaults to 60; the tool keeps a 10 s margin on top. It bounds the server checks and the wait for every client report. Split a longer scenario into several calls.
5. **Read `errors` before `peers`.** `passed` is true only with no `errors`, no failed check and at least one recorded check. The server comes first in `peers`, then each client by player name. `checks` counts `total`, `passed` and `failed` over all peers.
6. **Know the failures.**
   - A body that throws becomes a failed check, "server checks ran to the end" or "client checks ran to the end", and earlier checks stay.
   - A body that never calls `check` adds "No check was recorded" to `errors`.
   - A yielding body past the timeout adds "server checks did not finish", or "N of M clients reported" for clients.
7. **Fix a syntax error from the console.** A server body that does not compile never ends the test, so the call throws after the timeout plus 10 s. Read `get_console_output`, fix the body and retry. A client one usually shows as a missing client report.
8. **Leave Studio's play state alone during the call.** It needs an open place in Edit mode and runs one test at a time. Stopping play early throws "ended without a report". After a timeout the tool calls `start_stop_play` with `is_start` false itself and reports if that failed.

## Built-in tools

- `run_playtest` is for repeatable assertions, and its `serverChecks` already run in a live server Script. For one look inside a session you started with `start_stop_play`, call `run_in_playtest` with a Luau body that returns one JSON value: it runs on the server of that session, so `require` returns the live module instances. Stop the session when done, because `run_in_playtest` never starts or stops one. Studio's other tools are for a hand-driven input.
- Start play with `start_stop_play` (`is_start` true), check `get_studio_state` for the available datamodel types, and stop it with `is_start` false.
- `character_navigation` needs `datamodel_type` `Client`. `user_mouse_input` and `user_keyboard_input` send ordered actions to the game.
- `get_console_output` reads the output log for script errors and prints.
- Never start play by hand before `run_playtest`, because a running test makes it fail.

## Clean up

- Each call removes its harness scripts, `RobloxKitPlaytestServerHarness` in ServerScriptService and `RobloxKitPlaytestClientHarness` in StarterPlayerScripts, even after a failure.
- If removal fails the error names both scripts. Delete them by hand, because they are left in the place.
- Stop hand-started play with `start_stop_play` before finishing.

## Judgment

- One failed check outranks any count of passing ones.
- A check body outranks manual input, because it can run again.
- The smallest mode outranks wider coverage.
