# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code plugin (`.claude-plugin/plugin.json`) for Roblox Studio. It ships two MCP servers and five skills (`skills/`):

- `roblox-kit` (`src/server/main.ts`): this repo's own server with four tools, `build_map`, `check_map`, `capture_zones` and `run_playtest`.
- `studio` (`src/studio/launch-studio-mcp.ts`): a thin launcher that execs Roblox's built-in Studio MCP server with inherited stdio.

`.mcp.json` mirrors the plugin's server config for local development (`${CLAUDE_PLUGIN_ROOT:-.}`). Keep the two in sync.

## Commands

TypeScript runs directly on Node (>= 22.18, native type stripping); there is no build step and `tsc` only type-checks (`noEmit`, `erasableSyntaxOnly`, so no enums, namespaces or parameter properties). Imports use explicit `.ts` extensions.

- `npm run check`: everything CI runs (typecheck, ESLint, selene, Prettier, StyLua, tests, `claude plugin validate --strict .`).
- `npm test`: all unit tests (`node --test`).
- `node --test src/map/map-layout.test.ts`: one test file. Add `--test-name-pattern "<name>"` for one test.
- `npm run lint:luau` / `npm run format:luau:check`: selene and StyLua for `luau/`; both are pinned in `rokit.toml`.
- `npm run smoke:studio [-- --multiplayer]`: end-to-end build, check, capture and playtest against a running Studio.
- `npm run eval:studio`: builds each benchmark in `eval/benchmarks/`, runs visual review and appends to `eval/results.jsonl`. Needs `node scripts/fetch-references.ts` first; `node scripts/calibrate-review.ts` checks the reviewer against `eval/anchors/bad/`.
- `npm run hero-props -- <preset> <kind>` and `npm run hero-props:upload -- <preset>`: generate (headless Blender, found by `blenderPath()` from `BLENDER_PATH` or `config.blenderFallbackPaths`), review and upload hero-prop models. Uploads need an Open Cloud key and creator; see the README's Development section.

Unit tests never need Studio: they use `src/studio/fake-studio-connection.ts`. Studio-dependent checks live only in `scripts/`.

## Architecture

**TypeScript plans, Luau executes.** Every tool computes as much as possible in pure TypeScript, then sends a bundled file from `luau/` to Studio through `runLuauFile` (`src/luau/run-luau-file.ts`). That wraps the file body in a function called with the JSON-decoded arguments (the file reads `local arguments = ...`), runs it via Studio's `execute_luau`, and parses the returned JSON string with a zod schema. Luau files must therefore `return` a JSON string, and results over 100,000 characters are truncated by Studio and reported as errors.

**Studio connection.** Tools receive a `StudioConnection` in their `ToolContext`. The real one, `StudioMcpClient`, spawns its own Studio MCP process as an MCP client and retries an empty Studio list until discovery times out, since a fresh connection lists the open place only after a few seconds.

**Tool registry.** Each tool is a `ToolDefinition` (zod input and output schemas, annotations, handler) listed in the `tools` array in `src/server/main.ts`; array order is `tools/list` order. Handlers may throw; the registry turns throws into `isError` results. `check_map` stores full reports in memory (`CheckReportStore`), served as the `roblox-kit://check-reports/{reportId}` resource.

**build_map pipeline** (`src/map/`): `map-spec.ts` validates the input spec; `map-layout.ts` turns rooms into parts; with a `style`, `src/style/` resolves a preset from `presets/*.json` (schema in `preset-schema.ts`) and the map is furnished by `room-details.ts`, `prop-placement.ts` / `arrangement-placement.ts` / `set-piece-placement.ts` (with `relation-solver.ts` and `prop-rules.ts`), `hero-prop-placement.ts` and `src/lighting/`. `build-phases.ts` groups everything into six ordered phases that `luau/build-map.luau` builds. Randomness goes through `src/shared/seeded-random.ts` so a seed reproduces a map.

**Props.** Each prop kind is a ProceduralModel generator in `luau/props/<kind>.luau`, read at build time; a new kind also needs its name in `propKinds` in `src/map/prop-placement.ts`. Hero props are Blender-generated meshes (`src/hero-props/`) uploaded through Open Cloud; asset ids are recorded by recipe hash in `src/hero-props/hero-assets.json`, and `build_map` falls back to the set piece with a warning when no asset exists.

**Visual review.** `src/eval/` and `src/shared/ask-headless-reviewer.ts` score captured images with fresh headless reviewers, using prompts in `skills/visual-judge/`. Thresholds and the current wave's room types live in `src/config.ts`.

**Config.** Tunables (timeouts, naming conventions such as `RobloxKitMaps` and `RobloxKitCeiling`, check limits, image sizes) are centralized in the frozen `config` object in `src/config.ts`; reuse it rather than adding literals.

## Conventions

- Distances are studs; north is -Z, south +Z, east +X, west -X.
- `docs/`, `.exo/` and `.roblox-kit/` (credentials, hero-prop output) are gitignored and private; do not commit them.
