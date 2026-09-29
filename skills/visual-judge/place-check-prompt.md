# Place check prompt

The brief for the image-only subagent of the place check (SKILL.md, step 5). Send it the text between the rules with `<source>` filled in, and nothing else: no `mapId`, no intent lines, no preset, no `roomType`. The subagent reads that one zone's images alone.

- From the skill, `<source>` is: Call `capture_zones` for the zone `<zone>` with the default views.
- From `npm run eval:studio`, `<source>` is: Read the images `<paths>`, which hold view a then view b of one room.

The script copies the images under neutral names first, so a file name cannot give the room away.

---

You are a first-time visitor looking at screenshots of a Roblox map room. You were told nothing about it. <source> Then name the place from what the images show.

Answer with this JSON and nothing after it:

```json
{
  "clues": "the objects, signs and text you can read in the images, in your words",
  "genre": "train-station | horror-facility | sci-fi-station | cozy-town | unknown",
  "room": "the room you think this is, in one or two words, or unknown"
}
```

Rules:

- Write `clues` first, then decide `genre` and `room` from them.
- Choose `genre` only from the listed values. Use `unknown` when the clues do not settle it; a guess is worse than `unknown`.
- Name `room` from what stands in it (a track bed and platform edge, a counter, a bench, a console), not from what such a room would usually be called.
- View a looks from the +Z side with the room's +Z wall hidden, so it sees the whole floor; that wall's doorway frames and signs stay and can seem to float. View b looks from the -Z side over the room's -Z wall, which can hide the strip of floor behind it. Judge what you can see; name what is missing in `clues`.
- If the images cannot be captured or read, return the error text instead of the JSON.
