/** Tunables of SVG-to-PNG rendering. */
export const imagesConfig = Object.freeze({
  fontsFolder: new URL("./fonts/", import.meta.url),
  fontManifestFile: "fonts.json",
  defaultFontFamily: "Inter",
  defaultScale: 1,
  maxScale: 8,
  maxImagePixels: 1024,
  alphaBleedThreshold: 128,
  alphaBleedPasses: 16,
  alphaBleedMinPasses: 8,
  alphaBleedMaxPasses: 32,
});

/** Tunables of image upload caching and moderation waits. */
export const imageStoreConfig = Object.freeze({
  kitAssetsFile: new URL("../hero-props/image-assets.json", import.meta.url),
  userAssetsPath: ".roblox-kit/image-assets.json",
  moderationPollIntervalMs: 2000,
  moderationMaxPolls: 30,
  maxImageSide: 4096,
});
