---
name: ui-images
description: Draws Roblox UI art (buttons, panels, fixed words, fonts, effects) as SVG images sized for Studio. Use when the user says "make a button image", "draw a UI panel", "custom font for my logo", "style my menu", "9-slice". Not for maps (map-building), Luau logic (luau skill) or text that changes at run time.
---

# UI images

Roblox UI looks generic when every button is a flat Frame. The enemy is an image that is blurry, over the size limit, stretched at its corners, or baked with words that must change. The overcorrection is drawing everything as an image, including text that gets translated.

## Rough requests

Keep every ask, name and limit the user stated. Fill only what the work needs and add nothing unasked. Ask only when two readings give materially different results: few questions, each short. Do not wait for plan approval; act at once. Ask only if the UI's purpose or style is unclear.

## Process

1. **Draw as SVG at 2x** the size it shows on screen, so it stays sharp on dense screens.
2. **Keep each image at or under 1024 px** on both sides. Split or shrink anything bigger.
3. **Give 9-slice images a slice center** (the stretchable middle) so corners stay crisp when the element resizes.
4. **Draw fixed words** (a logo, a title) with a vendored font family, filled white. Tint them in Studio with `ImageColor3`, so one image serves every color.
5. **Keep words that change at run time or get translated** as a `TextLabel` with a built-in `FontFace`. Never bake them into an image.
6. **Draw effects** (glow, shine, shadow) as separate images, so they can be tinted, faded or turned off alone.
7. **Upload only through `insert_images`, and only when the user asks for images.** Otherwise hand over the SVG files.
8. **Keep buttons 48 px or more** in height and width, and place them inside `CoreUISafeInsets` so notches and system bars never cover them.

## Judgment

- A plain `TextLabel` that translates beats a pretty image that cannot.
- White art tinted by `ImageColor3` beats one image per color.
