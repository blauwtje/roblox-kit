/** Tunables of SVG-to-PNG rendering. */
export const imagesConfig = Object.freeze({
  fontsFolder: new URL("./fonts/", import.meta.url),
  fontManifestFile: "fonts.json",
  defaultFontFamily: "Inter",
  defaultScale: 1,
  maxScale: 8,
});
