// Recorded wire shapes, deliberately independent of the current client schema.
// A legacy client does not send hello at all; these are negotiating clients.
export const helloFixtures = [
  {
    name: "previous-release client uses the existing replay capability",
    client: {
      protocol_version: 1,
      release: "0.0.50",
      commit: "old-client",
      platform: "ios",
      capabilities: ["orchestration.afterSequence"],
      last_cursor: 17,
    },
    outcome: "compatible",
    capabilities: ["orchestration.afterSequence"],
  },
  {
    name: "next-release client degrades to a named supported subset",
    client: {
      protocol_version: 1,
      release: "0.0.52",
      commit: "new-client",
      platform: "android",
      capabilities: ["environmentThemes", "future.voice-format"],
      last_cursor: 3,
      future_field: { retained_by_client: true },
    },
    outcome: "degraded",
    capabilities: ["environmentThemes"],
  },
  {
    name: "unsupported protocol receives an update-required reply",
    client: {
      protocol_version: 0,
      release: "0.0.37",
      commit: "unsupported-client",
      platform: "mac",
      capabilities: ["environmentThemes"],
      last_cursor: null,
    },
    outcome: "update-required",
    capabilities: [],
  },
  {
    name: "future protocol never claims full compatibility",
    client: {
      protocol_version: 2,
      release: "0.0.52",
      commit: "future-client",
      platform: "web",
      capabilities: ["usageLimitSources"],
      last_cursor: 0,
    },
    outcome: "degraded",
    capabilities: ["usageLimitSources"],
  },
] as const;
