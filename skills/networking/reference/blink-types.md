# Blink types and call modes

## Typing fields (step 3)

- Numbers: give every integer a range (`u8(1..8)`, not bare `u8`) and every `f32`/`f64` a range. NaN fails a range check only from 0.18.9 on, which is why step 1 pins it.
- Strings: give a length range (`string(1..32)`); an unbounded string is unbounded memory. Blink 0.18.9 generates a `#Value.Name` length check from it.
- Arrays: give a size range on the element type (`Item[0..16]`, where `Item` is a named `struct Item { ... }`); Blink 0.18.9 generates a length check from it. Maps have no size range in 0.18.9 (`map[0..4]` does not parse), so bound a map's key and value types (`map {[string(1..8)]: u8(0..9)}`) and prefer an array when the count matters. Never leave an array open-ended.
- Instances: name the class (`Instance(Model)`). That checks the class only, so a client can still name any Model in the place; step 6 covers the rest.
- `vector` has no range, so a client can send NaN or infinity in a position; step 6 covers that too.
- Prefer a struct of intent fields over one generic payload.

## Call mode and event type (step 4)

- Default to `SingleAsync` or `ManyAsync`. Use `SingleSync` or `ManySync` only with a stated performance reason: Blink's events documentation says that yielding or erroring in a sync event "can cause undefined and sometimes game-breaking behaviour". With `SyncValidation`, a Sync listener that yields also gets its handler thread closed by whichever player's packet arrives next.
- Use `Type: Reliable` by default. Use `Unreliable` only for frequent, loss-tolerant data (an effect, a position update) that stays under 1000 bytes, the limit both Blink's events documentation and Roblox's `UnreliableRemoteEvent` reference state. An event a player must not miss is `Reliable`.
- Use a `function` with `Yield: Coroutine` only when the client needs a reply; the client waits on it, so a server handler for it must return quickly and may return `nil`.

## Generated output (step 10)

- Commit `network/generated/Server.luau` and `network/generated/Client.luau`, and mark them in `.gitattributes`: `network/generated/** linguist-generated=true`.
- Exclude them from linting and formatting: add `"network/generated/*"` to `exclude` in `selene.toml` and `network/generated/` to `.styluaignore`.
- Never edit them by hand. Change `game.blink`, regenerate, and run `git diff network/generated` to confirm the diff is only what the change should cause, before calling work done.

## Templates (step 11)

- `network/game.blink` and its `generated/` output: replace the sample events, regenerate (step 10), never copy the sample output over your own.
- `Validate.luau`, `RateLimit.luau`, `Rejections.luau`: into `ServerScriptService`, next to each other and unchanged.
- `Pickups.luau`: the sample server-authoritative handlers (pickup range, `Pickups` folder, slot count). Replace them with the game's handlers using the same check order, and keep `SLOT_COUNT` equal to the range in `game.blink`.
- `Main.server.luau`: starts the modules, configures one rate limit per `From: Client` event and connects each listener once (step 8).
- `NetworkChecks.luau` (server) and `NetworkClientChecks.luau` (client, into `ReplicatedStorage`): the playtest checks used in step 12. Adapt their fixtures and sends to the game's own events.

## Payload shape

- Prefer a struct of intent fields over one generic payload.
