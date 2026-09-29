/** Every tunable number and name of the server; nothing else in `src` hardcodes one. */
export const config = Object.freeze({
  /** Name of the Workspace folder holding one Model per map handle. */
  mapsFolderName: "RobloxKitMaps",
  /** URI prefix of the full check reports served as resource links. */
  checkReportUriPrefix: "roblox-kit://check-reports/",

  /** Name and version this server reports in the MCP handshake, to its client and to StudioMCP. */
  serverName: "roblox-kit",
  serverVersion: "0.1.0",
  /** Upper bound of the StudioMCP handshake and of every call to it. */
  upstreamTimeoutMs: 60_000,

  defaultFloorMaterial: "Concrete",
  defaultWallMaterial: "Brick",
  defaultWallHeightStuds: 12,
  defaultWallThicknessStuds: 1,
  defaultDoorWidthStuds: 6,

  /** Penetration below this depth is face contact, not an overlap. */
  overlapToleranceStuds: 0.05,
  pathfindingAgentRadiusStuds: 2,
  pathfindingAgentHeightStuds: 5,

  zoneShotPitchDegrees: 55,
  /** Studio's default camera field of view. */
  studioFieldOfViewDegrees: 70,

  minPlaytestPlayers: 1,
  maxPlaytestPlayers: 8,
  defaultPlaytestTimeoutSeconds: 60,
  maxPlaytestTimeoutSeconds: 300,
});
