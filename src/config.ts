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
  /** Part attribute that holds a hidden ceiling's or near wall's own Transparency until capture_zones restores it. */
  cutawayOriginalTransparencyAttribute: "RobloxKitOriginalTransparency",

  defaultFloorMaterial: "Concrete",
  defaultWallMaterial: "Brick",
  defaultCeilingMaterial: "Concrete",
  defaultWallHeightStuds: 12,
  defaultWallThicknessStuds: 1,
  /**
   * How far a room floor's top rises above y = 0, the top of a place's Baseplate, so the two faces do not
   * z-fight; kept below overlapToleranceStuds so walls and props standing on y = 0 still count as touching it.
   */
  floorLiftStuds: 0.04,
  defaultDoorWidthStuds: 6,
  /** Seed of a map spec that sets none. */
  defaultSeed: 1,
  /** Grid that the center of a room placed by relation snaps to. */
  gridStuds: 5,

  /** How far below the ceiling a room light hangs. */
  lightCeilingDropStuds: 1,
  /** Side of the cube fixture that build_map hangs from the ceiling at each ceiling light. */
  lightFixtureSizeStuds: 1,
  /** Height above the floor of the focal light over a spawn pad. */
  focalLightHeightStuds: 6,

  /** Penetration below this depth is face contact, not an overlap. */
  overlapToleranceStuds: 0.05,
  pathfindingAgentRadiusStuds: 2,
  pathfindingAgentHeightStuds: 5,
  /** Straight-line distance beyond which a spawn and a target are reported as tooFar, not pathfound. */
  maxPathStuds: 3000,

  /** Issues check_map returns inline; the rest is behind the report resource link. */
  maxInlineIssues: 20,
  /** Issues check_map keeps per kind in the full report; counts stay exact. */
  maxIssuesPerKind: 100,
  /** Full check reports kept in memory; the oldest is dropped past this. */
  maxCheckReports: 50,

  /** Scene limits per zone camera of a spec that sets no performance budget. */
  maxDrawCalls: 1000,
  maxTriangles: 1_000_000,
  /** Seconds the camera rests before its scene stats are read; a shorter wait reads the previous camera's numbers. */
  statsSettleSeconds: 1,
  /** Seconds one stats sampling call may take beyond the settle time of its cameras. */
  statsCallMarginSeconds: 10,

  /** Milliseconds capture_zones waits before each screen_capture: a capture right after a build or a lighting change reads the scene's unsettled light, far brighter or darker than a later one. */
  captureSettleMs: 3000,
  /** A capture is blank when at least this share of its pixels lies within blankCaptureLuminanceTolerance (0-255) of its median luminance; a hidden viewport measures 0.99, real captures at most 0.76. */
  blankCaptureUniformShare: 0.95,
  blankCaptureLuminanceTolerance: 8,

  /** Decimals kept in a camera coordinate; a hundredth of a stud is far below a pixel. */
  cameraCoordinateDecimals: 2,
  zoneShotPitchDegrees: 55,
  /** The eye view: the camera stands this high above the zone's lowest point, this far in from its -Z side, pitched down by eyePitchDegrees. */
  eyeHeightStuds: 5,
  eyeInsetStuds: 3,
  eyePitchDegrees: 10,
  /** Studio's default camera field of view. */
  studioFieldOfViewDegrees: 70,
  /** Long-edge range in pixels a capture is expected to fall in; capture_zones warns outside it. */
  imageLongEdgeMin: 1000,
  imageLongEdgeMax: 1568,
  /** Images capture_zones returns per call, which is also one judge round's cap (1,924 tokens each at 1456x1030); further zones go to remainingZones. */
  maxImagesPerCall: 8,
  /** Milliseconds one blind place check of `npm run eval:studio` (a headless `claude -p` reading two images) may take. */
  placeCheckTimeoutMs: 180_000,
  /** Fresh reviewers that each score one room of `npm run eval:studio`; each axis takes their median. */
  qualityReviewersPerRoom: 3,
  /** Milliseconds one reference-scored reviewer (a headless `claude -p` reading every reference and capture) may take. */
  qualityReviewTimeoutMs: 420_000,
  /** The score every axis median of a room must reach to pass the quality review, on the 1-10 scale. */
  visualPassScore: 7,
  calibrationReferenceMeanFloor: 6,
  calibrationBadAnchorMeanCeiling: 4,
  calibrationAxisGap: 2,
  evalWaveRoomTypes: ["platform", "concourse", "ticket-hall"],

  /** Folder, under the repository root, that generated hero-prop GLBs go to, one `<preset>-<kind>-<hash>` folder each. */
  heroPropsFolder: ".roblox-kit/hero-props",
  /** The environment variable naming the Blender that generates hero props headless (`-b --factory-startup`), so blender-mcp never loads. */
  blenderPathEnv: "BLENDER_PATH",
  /** Tried in order when that variable is unset: a name looked up on PATH, then an absolute install path. */
  blenderFallbackPaths: ["blender", "/Applications/Blender.app/Contents/MacOS/Blender"],
  blenderTimeoutMs: 120_000,
  /** How far a generated hero prop's extent may differ from its recipe size on any axis, in studs. */
  heroPropSizeToleranceStuds: 0.1,
  /** Milliseconds one hero-prop render reviewer (a headless `claude -p` reading three renders) may take. */
  heroPropReviewTimeoutMs: 180_000,
  /** Distinct recipe hashes of one hero-prop kind that may be reviewed; a further revision is refused. */
  maxHeroPropRounds: 3,

  /** Open Cloud Assets API that a reviewed hero-prop GLB is uploaded to, and the operations it is polled at. */
  openCloudAssetsUrl: "https://apis.roblox.com/assets/v1/assets",
  openCloudOperationsUrl: "https://apis.roblox.com/assets/v1/operations/",
  /** Environment variables that hold the Open Cloud API key (Assets read and write) and the creator: a user id or a group id. */
  openCloudApiKeyEnv: "ROBLOX_OPEN_CLOUD_API_KEY",
  openCloudCreatorUserIdEnv: "ROBLOX_CREATOR_USER_ID",
  openCloudCreatorGroupIdEnv: "ROBLOX_CREATOR_GROUP_ID",
  /** Gitignored files, under the repository root, read when the variables are unset: the key (trimmed), and the creator as {"groupId":"<digits>"} or {"userId":"<digits>"}. */
  openCloudKeyFile: ".roblox-kit/open-cloud-key",
  openCloudCreatorFile: ".roblox-kit/open-cloud-creator.json",
  /** Wait between two polls of an upload operation, and how many polls before the upload counts as failed. */
  openCloudPollIntervalMs: 2000,
  openCloudMaxPolls: 60,

  defaultMultiplayerPlayers: 2,
  minPlaytestPlayers: 1,
  maxPlaytestPlayers: 8,
  defaultPlaytestTimeoutSeconds: 60,
  maxPlaytestTimeoutSeconds: 300,
  /** Seconds one playtest session call may take beyond the harness timeout: starting, reporting, cleanup. */
  playtestCallMarginSeconds: 10,
});
