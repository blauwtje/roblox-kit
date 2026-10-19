---
name: game-formula
description: The front-page Roblox design formula plus ready templates for a "Steal a" base game, a "+1 per second" escape obby and shared juice effects (floating numbers, bursts, fades, cutscenes). Use for "front page game", "make it addictive", "steal a brainrot", "game feel", "rebirth". Not for saving data, remotes, maps, playtests or this plugin's own code.
---

# Game formula

Front-page games share one shape: a cheap action pays a visible number, the number buys an upgrade, and the upgrade makes the next number bigger. The enemy is a game with features but no loop: systems the player cannot feel, rewards with no sound or motion, a first minute that explains instead of pays. The overcorrection is copying a hit's art or names, or stacking systems (pets, shops, quests) before the one loop is fun.

## Rough requests

Keep every ask, name and limit the user stated. Fill only what the work needs from the templates, and add nothing unasked. Ask only when two readings give materially different results, such as which of the two formulas fits: the fewest questions, each short. Do not wait for approval; start from a template.

## When to use

- Making a game that should feel like a front-page hit, or adding reward feedback, onboarding or rebirth to one.
- Not for saving data (`data`), remotes and validation (`networking`), maps (`map-building`) or playtests (`playtest`); this skill calls on them.
- Out of scope, so say so: horror rounds, roleplay towns, dress-up, combat arenas, vehicles, pets, monetization.

## The formula

1. Core loop: cheap action, visible reward number, upgrade, bigger number. Every loop turn takes seconds, never minutes.
2. First 30 seconds: the player earns the first reward before reading anything. Put the first payout within a few steps of the spawn and the first upgrade within one payout.
3. Constant feedback: every reward gets juice (a floating `+$25`, a burst, a HUD pulse). No silent state change.
4. Visible progression: `leaderstats` with the main number, a HUD with the next goal, and a bigger number on every step.
5. Social pressure: others can see your progress and take it. Stealing, leaderboards and shared displays beat solo meters.
6. Rebirth: a reset that keeps a permanent multiplier, offered once the player has the number to afford it.
7. Short sessions: a goal reachable in five minutes, a bigger one behind it, and a reason to rejoin (a timer, a reset).
8. Look: bright, saturated colors, large readable numbers, one clear focal object per area.

## Templates

They live in `${CLAUDE_SKILL_DIR}/templates/`; copy the folder you need into the user's game and adapt the lines marked `ADAPT`.

- `juice/`: `GameFormulaJuice` (ModuleScript in ReplicatedStorage) and `GameFormulaFxClient` (LocalScript in StarterPlayerScripts). Both are always needed.
- `steal-egg/`: a "Steal a" base loop: earn from your base, steal from another base, lose what is stolen, rebirth.
- `plus-one-escape/`: a "+1 per second" escape obby: income ticks while you progress, checkpoints, a rebirth.

Each game folder has a `Checks.luau`, a server chunk that drives the loop in a solo playtest and errors on failure. Persist progress through the `data` skill, not the template's in-memory state.

## Juice API

`local Juice = require(ReplicatedStorage.GameFormulaJuice)`, called from the server. All effects are cosmetic and never yield.

- `Juice.popText(position, text, color?)`: floating number that rises, pops and fades.
- `Juice.burst(position, color?, count?)`: particle burst.
- `Juice.spin(part, secondsPerTurn?)` and `Juice.bob(part, height?)`: looping motion, drawn on clients.
- `Juice.fade(player, seconds?)`: screen fade out and in, to hide a teleport or reset.
- `Juice.cutscene(player, cframes, seconds)`: camera tour, then back to the player.
- `Juice.pulse(player, label)`: pulse the HUD label named `label`.

## Proof

1. Run `npm run check` when the plugin's own files change.
2. `npm run smoke:games` inserts the templates into the open place, runs their scripted playthrough in a solo playtest, captures shots and removes them.
3. `npm run prove:games` scores those shots beside real images of the matching front-page games with headless reviewers.

For the user's own game, run the same `Checks.luau` idea with `run_playtest`, and judge the look with the `visual-judge` skill.
