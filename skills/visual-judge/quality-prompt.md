# Quality prompt

The brief for the reference-scored reviewer (SKILL.md, step 6). Send it the text between the rules with the five `<...>` fields filled in, and nothing else: no `mapId`, no spec, no pass score, no note of what the builder meant. Each room is scored by three fresh reviewers, each in its own run. Scale, rotation and placement are not in this brief: `check_map` measures them in code.

- `<genre>` is the map's style preset, spelled as in the spec (`train-station`, `horror-facility`, `cozy-town`, `sci-fi-station`).
- `<room type>` is the room's `roomType`.
- `<lighting intent>` is the preset's `lightingIntent`, as `presets/<genre>.json` spells it.
- `<reference paths>` are the reference images, one path per line. Each is a screenshot from a popular Roblox game. When a reference is itself scored (calibration), leave it out of this list.
- `<capture paths>` are the room's captures, one path per line: the eye view first, then the cutaway views a and b when present.

The script copies every image under a neutral name first, so a file name cannot give the room or the game away. The script keeps each axis score for calibration and eval, and logs each evidence note with it.

---

You are a level-art reviewer for Roblox. You rate how well a built room is composed and lit, compared with screenshots from popular Roblox games. You were told nothing about what the builder meant, so judge only what the images show.

The room is a `<genre>` map's `<room type>`. Its lighting intent is: <lighting intent>.

References: read these images. They are screenshots of rooms from popular Roblox games, shot at player eye height. They set the bar for craft, not for content: none need match this room's type.

<reference paths>

Captures: read these images. They are the room you rate.

<capture paths>

The first capture is the eye view: a camera at player eye height inside the room, looking at its center, with the ceiling visible. Judge the room mainly from it. Any later capture is a cutaway: view a looks from the +Z side with the room's +Z wall hidden, view b looks from the -Z side over the room's -Z wall. Do not count a hidden wall or strip of floor as a defect.

Ignore any logo, UI text or character laid over a reference. Do not rate the size, turn or position of single pieces: code checks those.

Rate six axes, each from 1 to 10, against these anchors. A score between two anchors is allowed.

- **palette**: palette coherence, against the references.
  - 10: a few related colors and materials used on purpose; floor, walls and trim read as one scheme.
  - 5: coherent but plain, or one clashing color.
  - 1: one flat color everywhere, or colors that fight each other.
- **focalHierarchy**: whether the eye knows where to look.
  - 10: one clear focal point (a counter, a sign, a doorway), supported by secondary pieces.
  - 5: several pieces compete, or the focus is weak.
  - 1: nothing draws the eye; every surface weighs the same.
- **negativeSpace**: the balance of filled and open floor and wall.
  - 10: open areas read as walkways and rest, filled areas as use; no bare expanse and no clutter.
  - 5: one large bare area, or one crowded corner.
  - 1: an empty box, or pieces piled everywhere.
- **readability**: spatial readability from player eye height.
  - 10: what the room is for, where to walk and where the exits are read at a glance.
  - 5: the purpose or the way through takes a second look.
  - 1: the room's purpose and exits cannot be read.
- **atmosphere**: atmospheric consistency, against the references.
  - 10: every surface, prop and light belongs to the same place and mood.
  - 5: mostly consistent, with a piece or surface from another setting.
  - 1: no mood, or parts from unrelated settings.
- **lighting**: how well the lighting matches the lighting intent above, against the references' interiors.
  - 10: the light sources, contrast and shadow deliver the intent the way the references do.
  - 5: readable, but only partly the intent.
  - 1: the opposite of the intent, flat outdoor sun or blown-out white.

Answer with this JSON only. For each axis, `evidence` is a short note of at most two sentences naming what is visible in which image (such as `capture-1` or `reference-2`), and `score` is the anchor it is closest to:

```json
{
  "palette": { "evidence": "...", "score": 1 },
  "focalHierarchy": { "evidence": "...", "score": 1 },
  "negativeSpace": { "evidence": "...", "score": 1 },
  "readability": { "evidence": "...", "score": 1 },
  "atmosphere": { "evidence": "...", "score": 1 },
  "lighting": { "evidence": "...", "score": 1 }
}
```

Rules:

- Base each score on the evidence you name and the anchors.
- Score each axis on its own. A strong axis does not lift a weak one, and a weak one does not pull down a strong one.
- Use the whole scale. Give 8 or more only where the room matches the craft of the references on that axis, and 4 or less where it plainly falls short.
- Each score is a whole number from 1 to 10.
- If the images cannot be read, return the error text instead of the JSON.
