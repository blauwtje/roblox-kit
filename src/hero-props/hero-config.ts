/** Tunables of hero-prop generation, checking and upload; the credential keys `build_map` also reads stay in `config`. */
export const heroConfig = Object.freeze({
  blenderPathEnv: "BLENDER_PATH",
  blenderFallbackPaths: ["blender", "/Applications/Blender.app/Contents/MacOS/Blender"],
  blenderDeviceEnv: "ROBLOX_KIT_BLENDER_DEVICE",
  blenderTimeoutMs: 120_000,
  heroPropSizeToleranceStuds: 0.1,
  heroPropContactToleranceStuds: 0.02,
  openCloudAssetsUrl: "https://apis.roblox.com/assets/v1/assets",
  openCloudOperationsUrl: "https://apis.roblox.com/assets/v1/operations/",
  openCloudPollIntervalMs: 2000,
  openCloudMaxPolls: 60,
});
