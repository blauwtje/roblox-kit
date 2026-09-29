/** Every tunable number and name of the server; nothing else in `src` hardcodes one. */
export const config = Object.freeze({
  /** Name of the Workspace folder holding one Model per map handle. */
  mapsFolderName: "RobloxKitMaps",
  /** URI prefix of the full check reports served as resource links. */
  checkReportUriPrefix: "roblox-kit://check-reports/",

  /** Name and version this server reports in the MCP handshake, to its client and to StudioMCP. */
  serverName: "roblox-kit",
  serverVersion: "0.1.0",
  /** Upper bound of the StudioMCP handshake and of a call to it that sets no timeout of its own. */
  upstreamTimeoutMs: 60_000,
  /** How long an empty Studio list is re-asked on one connection: a fresh StudioMCP lists nothing at first. */
  studioDiscoveryTimeoutMs: 15_000,
  studioDiscoveryPollIntervalMs: 1000,
  /** Characters of text `execute_luau` returns before Studio cuts it; the smoke probe fails if Studio changes this. */
  executeLuauMaxResultChars: 100_000,
  /** What Studio appends to an `execute_luau` result it cut. */
  executeLuauTruncationMarker: "... (truncated)",

  /** Part names build_map gives a room `<room>` + suffix; the Luau readers find zones by them. */
  floorNameSuffix: "-floor",
  spawnNameSuffix: "-spawn",
  wallNameInfix: "-wall-",
  ceilingNameSuffix: "-ceiling",
  /** CollectionService tag on every ceiling part; capture_zones hides the parts by it. */
  ceilingTag: "RobloxKitCeiling",

  defaultFloorMaterial: "Concrete",
  defaultWallMaterial: "Brick",
  defaultCeilingMaterial: "Concrete",
  defaultWallHeightStuds: 12,
  defaultWallThicknessStuds: 1,
  defaultDoorWidthStuds: 6,
  /** Seed of a map spec that sets none. */
  defaultSeed: 1,
  /** Grid that the center of a room placed by relation snaps to. */
  gridStuds: 5,

  /** How far below the ceiling a room light hangs. */
  lightCeilingDropStuds: 1,
  /** Height above the floor of the focal light over a spawn pad. */
  focalLightHeightStuds: 6,

  /** Penetration below this depth is face contact, not an overlap. */
  overlapToleranceStuds: 0.05,
  pathfindingAgentRadiusStuds: 2,
  pathfindingAgentHeightStuds: 5,

  /** Issues check_map returns inline; the rest is behind the report resource link. */
  maxInlineIssues: 20,
  /** Issues check_map keeps per kind in the full report; counts stay exact. */
  maxIssuesPerKind: 100,

  /** Scene limits per zone camera of a spec that sets no performance budget. */
  maxDrawCalls: 1000,
  maxTriangles: 1_000_000,

  /** Decimals kept in a camera coordinate; a hundredth of a stud is far below a pixel. */
  cameraCoordinateDecimals: 2,
  zoneShotPitchDegrees: 55,
  /** Studio's default camera field of view. */
  studioFieldOfViewDegrees: 70,

  defaultMultiplayerPlayers: 2,
  minPlaytestPlayers: 1,
  maxPlaytestPlayers: 8,
  defaultPlaytestTimeoutSeconds: 60,
  maxPlaytestTimeoutSeconds: 300,
  /** Seconds one playtest session call may take beyond the harness timeout: starting, reporting, cleanup. */
  playtestCallMarginSeconds: 10,
});
