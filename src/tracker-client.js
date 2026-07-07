const { execFile } = require("child_process");

const { getPlaylist } = require("./playlist");

const PROFILE_TTL_MS = 5 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;

class TrackerClient {
  constructor({ log }) {
    this.log = typeof log === "function" ? log : () => {};
    this.profileCache = new Map();
  }

  async getPlaylistRank({ primaryId, playerName, playlistId, forceRefresh = false }) {
    const playlist = getPlaylist(playlistId);
    const profileTarget = parsePrimaryId(primaryId, playerName);

    if (!playlist || !profileTarget) {
      return {
        status: "unavailable",
        playlistId: playlist ? playlist.id : null,
        playlistName: playlist ? playlist.label : "Unknown mode",
        playlistShort: playlist ? playlist.short : "MMR",
        rating: null,
        tier: "",
        division: "",
        error: "missing-player-or-playlist",
        updatedAt: new Date().toISOString()
      };
    }

    try {
      this.log("info", "Tracker lookup started", {
        playlist: playlist.label,
        platform: profileTarget.slug,
        targetSource: profileTarget.targetSource,
        target: profileTarget.target,
        fallbackTarget: profileTarget.fallbackTarget || null,
        expectedPlatformUserId: profileTarget.expectedPlatformUserId || null
      });
      const profile = await this.getProfile(profileTarget, { forceRefresh });
      const rank = profile.playlists[playlist.id];

      if (!rank) {
        this.log("warn", "Tracker playlist missing from profile", {
          playlist: playlist.label,
          platform: profileTarget.slug,
          targetUsed: profile.lookup.targetUsed,
          platformUserHandle: profile.player.platformUserHandle || null,
          platformUserId: profile.player.platformUserId || null
        });
        return {
          status: "missing",
          playlistId: playlist.id,
          playlistName: playlist.label,
          playlistShort: playlist.short,
          rating: null,
          tier: "Unranked",
          division: "",
          error: null,
          updatedAt: profile.updatedAt
        };
      }

      this.log("info", "Tracker profile validated", {
        playlist: playlist.label,
        platform: profileTarget.slug,
        targetUsed: profile.lookup.targetUsed,
        platformUserHandle: profile.player.platformUserHandle || null,
        platformUserId: profile.player.platformUserId || null,
        rating: rank.rating,
        tier: rank.tier,
        division: rank.division
      });

      return {
        status: "ready",
        playlistId: playlist.id,
        playlistName: playlist.label,
        playlistShort: playlist.short,
        rating: rank.rating,
        tier: rank.tier,
        division: rank.division,
        matchesPlayed: rank.matchesPlayed,
        leaderboardRank: rank.leaderboardRank,
        percentile: rank.percentile,
        error: null,
        updatedAt: profile.updatedAt
      };
    } catch (error) {
      this.log("warn", "Tracker lookup failed", {
        playlist: playlist.label,
        platform: profileTarget.slug,
        targetSource: profileTarget.targetSource,
        target: profileTarget.target,
        fallbackTarget: profileTarget.fallbackTarget || null,
        error: error && error.message ? error.message : String(error)
      });
      return {
        status: "error",
        playlistId: playlist.id,
        playlistName: playlist.label,
        playlistShort: playlist.short,
        rating: null,
        tier: "",
        division: "",
        error: error && error.message ? error.message : String(error),
        updatedAt: new Date().toISOString()
      };
    }
  }

  async getProfile(profileTarget, { forceRefresh = false } = {}) {
    const key = `${profileTarget.slug}:${profileTarget.target}`;
    const cached = this.profileCache.get(key);
    const now = Date.now();

    // forceRefresh bypasses cached values/errors but still reuses an in-flight
    // request to avoid duplicate concurrent hits on the tracker API.
    if (cached && cached.expiresAt > now && (!forceRefresh || cached.promise)) {
      this.log("info", "Tracker cache used", {
        platform: profileTarget.slug,
        targetSource: profileTarget.targetSource,
        target: profileTarget.target,
        status: cached.error ? "error" : cached.promise ? "pending" : "ready"
      });
      if (cached.promise) return cached.promise;
      if (cached.error) throw cached.error;
      return cached.value;
    }

    const promise = fetchTrackerProfile(profileTarget, (level, message, details) => this.log(level, message, details))
      .then((value) => {
        this.profileCache.set(key, {
          value,
          error: null,
          promise: null,
          expiresAt: Date.now() + PROFILE_TTL_MS
        });
        return value;
      })
      .catch((error) => {
        this.profileCache.set(key, {
          value: null,
          error,
          promise: null,
          expiresAt: Date.now() + ERROR_TTL_MS
        });
        throw error;
      });

    this.profileCache.set(key, {
      value: null,
      error: null,
      promise,
      expiresAt: now + ERROR_TTL_MS
    });

    return promise;
  }
}

function parsePrimaryId(primaryId, playerName) {
  if (!primaryId || !String(primaryId).includes("|")) return null;

  const [platformRaw, id] = String(primaryId).split("|");
  const platform = String(platformRaw || "").toLowerCase();
  const slugByPlatform = {
    steam: "steam",
    epic: "epic",
    xboxone: "xbl",
    xbl: "xbl",
    ps4: "psn",
    psn: "psn",
    switch: "switch"
  };
  const slug = slugByPlatform[platform];
  if (!slug) return null;

  const normalizedId = normalizePlatformUserId(slug, id);
  const fallbackTarget = playerName ? String(playerName) : "";
  const target = slug === "steam" || slug === "epic" ? normalizedId : fallbackTarget;
  if (!target) return null;

  return {
    slug,
    target: String(target),
    targetSource: slug === "steam" || slug === "epic" ? "primary-id" : "player-name",
    fallbackTarget: slug === "epic" && fallbackTarget && fallbackTarget !== target ? fallbackTarget : "",
    expectedPlatformUserId: normalizedId || ""
  };
}

function fetchTrackerProfile(profileTarget, log = () => {}) {
  const encodedTarget = encodeURIComponent(profileTarget.target);
  const url = `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${profileTarget.slug}/${encodedTarget}`;

  log("info", "Tracker profile request", {
    platform: profileTarget.slug,
    targetSource: profileTarget.targetSource,
    target: profileTarget.target
  });

  return requestJson(url).then((payload) => ({
    payload,
    targetUsed: profileTarget.targetSource
  })).catch((error) => {
    if (error && error.statusCode === 404 && profileTarget.slug === "epic" && profileTarget.fallbackTarget) {
      const fallbackUrl = `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${profileTarget.slug}/${encodeURIComponent(profileTarget.fallbackTarget)}`;
      log("warn", "Tracker Epic ID not found, falling back to username", {
        target: profileTarget.target,
        fallbackTarget: profileTarget.fallbackTarget
      });
      return requestJson(fallbackUrl).then((payload) => ({
        payload,
        targetUsed: "fallback-player-name"
      }));
    }
    throw error;
  }).then(({ payload, targetUsed }) => {
    const data = payload && payload.data;
    if (!data || typeof data !== "object") throw new Error("Tracker profile missing data");
    const verification = verifyTrackerProfileTarget(profileTarget, data.platformInfo);
    log("info", "Tracker profile id verified", {
      platform: profileTarget.slug,
      targetUsed,
      expectedPlatformUserId: verification.expected || null,
      actualPlatformUserId: verification.actual || null,
      verified: verification.verified
    });

    return {
      player: data.platformInfo || {},
      playlists: parseTrackerPlaylists(data.segments || []),
      lookup: { targetUsed },
      updatedAt: new Date().toISOString()
    };
  });
}

function verifyTrackerProfileTarget(profileTarget, platformInfo) {
  const expected = normalizePlatformUserId(profileTarget.slug, profileTarget.expectedPlatformUserId);
  const actual = normalizePlatformUserId(profileTarget.slug, platformInfo && platformInfo.platformUserId);

  if (!expected || !actual || expected === actual) {
    return {
      expected,
      actual,
      verified: Boolean(expected && actual && expected === actual)
    };
  }
  throw new Error("Tracker profile id mismatch");
}

function normalizePlatformUserId(slug, id) {
  const value = String(id || "").trim();
  if (!value) return "";

  if (slug === "epic") return formatEpicUuid(value);
  return value;
}

function formatEpicUuid(value) {
  const compact = String(value || "").trim().replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return "";
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20)
  ].join("-");
}

const BROWSER_HEADERS = [
  "Accept: application/json, text/plain, */*",
  "Accept-Language: en-US,en;q=0.9",
  "Origin: https://rocketleague.tracker.network",
  "Referer: https://rocketleague.tracker.network/",
  "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
];

// Cloudflare fingerprints Node's TLS handshake and returns 403 no matter the
// headers. curl.exe uses the OS TLS stack (Schannel on Windows) and passes,
// so we shell out to curl first and only fall back to fetch if curl is missing.
function requestJson(url) {
  return requestJsonViaCurl(url).catch((error) => {
    if (error && error.curlMissing) return requestJsonViaFetch(url);
    throw error;
  });
}

function requestJsonViaCurl(url) {
  const binary = process.platform === "win32" ? "curl.exe" : "curl";
  const args = [
    "-s",
    "--compressed",
    "--max-time", "8",
    "-w", "\n%{http_code}"
  ];
  for (const header of BROWSER_HEADERS) args.push("-H", header);
  args.push(url);

  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error && (error.code === "ENOENT" || /not recognized|introuvable/i.test(String(error.message)))) {
        const missing = new Error("curl not found");
        missing.curlMissing = true;
        reject(missing);
        return;
      }
      if (error && !stdout) {
        reject(new Error(`Tracker curl error: ${error.message || error}`));
        return;
      }

      const output = String(stdout || "");
      const splitAt = output.lastIndexOf("\n");
      const statusCode = Number(output.slice(splitAt + 1).trim());
      const body = output.slice(0, splitAt);

      if (!Number.isFinite(statusCode) || statusCode === 0) {
        reject(new Error("Tracker curl: unreadable response"));
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        const httpError = new Error(`Tracker HTTP ${statusCode}`);
        httpError.statusCode = statusCode;
        reject(httpError);
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Tracker curl: invalid JSON"));
      }
    });
  });
}

async function requestJsonViaFetch(url) {
  if (typeof fetch !== "function") {
    throw new Error("Node.js fetch unavailable");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const headers = {};
    for (const header of BROWSER_HEADERS) {
      const split = header.indexOf(": ");
      headers[header.slice(0, split)] = header.slice(split + 2);
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`Tracker HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Tracker timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseTrackerPlaylists(segments) {
  const playlists = {};

  for (const segment of segments) {
    if (!segment || segment.type !== "playlist") continue;
    const playlistId = Number(segment.attributes && segment.attributes.playlistId);
    if (!Number.isInteger(playlistId)) continue;

    const stats = segment.stats || {};
    playlists[playlistId] = {
      rating: readStatValue(stats.rating),
      tier: readStatName(stats.tier) || "Unranked",
      division: readStatName(stats.division) || "",
      matchesPlayed: readStatValue(stats.matchesPlayed),
      leaderboardRank: readStatRank(stats.rating),
      percentile: readStatPercentile(stats.rating)
    };
  }

  return playlists;
}

function readStatValue(stat) {
  const value = stat && stat.value;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function readStatRank(stat) {
  const value = stat && stat.rank;
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function readStatPercentile(stat) {
  const value = stat && stat.percentile;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function readStatName(stat) {
  return stat && stat.metadata && stat.metadata.name ? String(stat.metadata.name) : "";
}

module.exports = {
  TrackerClient,
  formatEpicUuid,
  parsePrimaryId,
  parseTrackerPlaylists
};
