const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const paths = require("./src/paths");
const { AppState, DEFAULT_CONFIG } = require("./src/app-state");
const { StatsClient } = require("./src/stats-client");
const { TrackerClient } = require("./src/tracker-client");
const { parseTeamNum } = require("./src/utils");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// With the server running permanently (auto-start at login), the startup
// session reset never fires; instead a fresh play session starts 0-0 when the
// game reconnects after being offline this long.
const SESSION_RESET_OFFLINE_MS = 30 * 60 * 1000;

const appState = new AppState(paths);
let liveServer = null;
const activeRankRequests = new Set();

const statsClient = new StatsClient({
  getUrl: () => appState.config.statsApiUrl,
  onMessage: (raw) => appState.handleStatsMessage(raw),
  log: (level, message, details) => appState.log(level, message, details),
  emitState: () => appState.emitState(),
  onConnected: (offlineMs) => {
    if (offlineMs <= SESSION_RESET_OFFLINE_MS || appState.config.keepSessionBetweenLaunches) return;
    appState.log("info", "Session reset: Rocket League relaunched after offline period", {
      offlineMinutes: Math.round(offlineMs / 60000)
    });
    appState.resetSession();
  }
});
const trackerClient = new TrackerClient({
  log: (level, message, details) => appState.log(level, message, details)
});

const lobby = {
  matchGuid: "",
  playlistId: null,
  playlistShort: "",
  players: [],
  updatedAt: null
};
let lobbySignature = "";
let lobbyRefreshTimer = null;
let lobbyFetchInFlight = false;

appState.setStatsStatusProvider(() => statsClient.status());
appState.on("state", () => scheduleLobbyRefresh());
appState.on("rankLookup", (request) => {
  fetchRank(request).catch((error) => {
    appState.log("warn", "Unexpected Tracker MMR error", {
      error: error && error.message ? error.message : String(error)
    });
  });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  serveStatic(url.pathname, res);
});

liveServer = new WebSocket.Server({ server, path: "/live" });

liveServer.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: appState.buildClientState() }));
  socket.send(JSON.stringify({ type: "lobby", payload: lobby }));
});

appState.on("state", (state) => broadcast("state", state));
appState.on("log", (item) => broadcast("log", item));
appState.on("result", (payload) => broadcast("result", payload));

const API_ROUTES = {
  "GET /api/state": (_req, res) => sendState(res),
  "GET /api/logs": (_req, res) => sendJson(res, 200, { logs: appState.logger.items }),
  "GET /api/lobby": (_req, res) => sendJson(res, 200, { lobby }),
  "POST /api/config": handleConfigUpdate,
  "POST /api/reset": (_req, res) => {
    appState.resetSession();
    sendState(res);
  },
  "POST /api/logs/clear": (_req, res) => {
    appState.clearLogs();
    sendState(res);
  },
  "POST /api/test-connection": (_req, res) => {
    statsClient.runDiagnostics();
    sendState(res, 202);
  },
  "POST /api/undo": (_req, res) => {
    appState.undoLastResult();
    sendState(res);
  },
  "POST /api/manual/win": (_req, res) => {
    recordManualResult("win");
    sendState(res);
  },
  "POST /api/manual/loss": (_req, res) => {
    recordManualResult("loss");
    sendState(res);
  },
  "POST /api/test/win": (_req, res) => {
    recordPreviewResult("win");
    sendState(res);
  },
  "POST /api/test/loss": (_req, res) => {
    recordPreviewResult("loss");
    sendState(res);
  }
};

server.listen(appState.config.serverPort, "0.0.0.0", () => {
  appState.log("info", "Overlay server started", {
    overlay: `http://localhost:${appState.config.serverPort}/overlay.html`,
    control: `http://localhost:${appState.config.serverPort}/control.html`,
    statsApiUrl: appState.config.statsApiUrl
  });
  statsClient.connect();
});

function broadcast(type, payload) {
  if (!liveServer) return;
  const message = JSON.stringify({ type, payload });

  for (const socket of liveServer.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/overlay.html" : requestPath;
  const filePath = path.normalize(path.join(paths.publicDir, safePath));
  const relativePath = path.relative(paths.publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(buffer);
  });
}

async function handleApi(req, res, url) {
  try {
    const route = API_ROUTES[`${req.method} ${url.pathname}`];
    if (route) return await route(req, res, url);

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      appState.log("error", "API error", {
        path: url.pathname,
        error: error && error.message ? error.message : String(error)
      });
    }
    sendJson(res, statusCode, { error: error.message || "Internal server error" });
  }
}

async function handleConfigUpdate(req, res) {
  const body = await readBody(req);
  const result = appState.saveConfig({
    statsApiUrl: String(body.statsApiUrl || appState.config.statsApiUrl || DEFAULT_CONFIG.statsApiUrl),
    playerName: String(body.playerName || "").trim(),
    primaryId: String(body.primaryId || "").trim(),
    manualTeamNum: parseTeamNum(body.manualTeamNum),
    rankEnabled: body.rankEnabled !== false && body.rankEnabled !== "false",
    rankPlaylistId: body.rankPlaylistId || "auto",
    keepSessionBetweenLaunches: body.keepSessionBetweenLaunches === true || body.keepSessionBetweenLaunches === "true",
    overlayDurationMs: Number(body.overlayDurationMs || appState.config.overlayDurationMs)
  });

  if (result.statsApiUrlChanged) statsClient.connect();
  sendState(res);
}

async function fetchRank(request) {
  if (!request || activeRankRequests.has(request.requestKey)) return;
  activeRankRequests.add(request.requestKey);

  try {
    const rank = await trackerClient.getPlaylistRank({
      primaryId: request.primaryId,
      playerName: request.playerName,
      playlistId: request.playlist.id,
      forceRefresh: Boolean(request.forceRefresh)
    });
    const applied = appState.applyRankResult(request.signature, rank);
    if (applied) {
      appState.log(rank.status === "ready" ? "info" : "warn", rank.status === "ready" ? "Tracker MMR received" : "Tracker MMR unavailable", {
        playlist: rank.playlistName,
        rating: rank.rating,
        tier: rank.tier || null,
        division: rank.division || null,
        status: rank.status,
        error: rank.error || null
      });
    }
  } finally {
    activeRankRequests.delete(request.requestKey);
  }
}

function recordManualResult(result) {
  const playerTeamNum = parseTeamNum(appState.latestState.playerTeamNum);
  const winnerTeamNum = result === "win" ? playerTeamNum : oppositeTeamNum(playerTeamNum);

  appState.recordResult(result, {
    MatchGuid: appState.latestState.matchGuid || `manual-${Date.now()}`,
    WinnerTeamNum: winnerTeamNum,
    Manual: true
  });
}

function recordPreviewResult(result) {
  const playerTeamNum = parseTeamNum(appState.latestState.playerTeamNum) ?? 0;

  appState.recordResult(result, {
    MatchGuid: `test-${Date.now()}`,
    WinnerTeamNum: result === "win" ? playerTeamNum : oppositeTeamNum(playerTeamNum),
    Preview: true
  });
}

function oppositeTeamNum(teamNum) {
  const parsed = parseTeamNum(teamNum);
  if (parsed === null) return null;
  return parsed === 0 ? 1 : 0;
}

// --- Lobby tracker -----------------------------------------------------------
// Watches the players list from the Stats API and fetches each player's rank
// through the same TrackerClient (shared 5-minute profile cache).
//
// The lobby is keyed to the match: players are merged in as they appear and
// are NEVER removed when they leave mid-match (they only get a "left" flag).
// The list resets when a new matchGuid shows up or the playlist changes.

function scheduleLobbyRefresh() {
  clearTimeout(lobbyRefreshTimer);
  lobbyRefreshTimer = setTimeout(() => {
    maybeRefreshLobby().catch((error) => {
      appState.log("warn", "Unexpected lobby refresh error", {
        error: error && error.message ? error.message : String(error)
      });
    });
  }, 3000);
}

async function maybeRefreshLobby() {
  const latest = appState.latestState;
  const playlist = latest.playlist || {};
  const currentPlayers = (latest.players || [])
    .filter((player) => player && player.PrimaryId && player.Name)
    .slice(0, 8);

  if (!currentPlayers.length || playlist.id === null || playlist.id === undefined) return;

  const matchGuid = latest.matchGuid || "";
  const matchChanged = Boolean(matchGuid && lobby.matchGuid && matchGuid !== lobby.matchGuid);
  const playlistChanged = lobby.playlistId !== null && lobby.playlistId !== playlist.id;

  if (matchChanged || playlistChanged) {
    lobby.players = [];
    lobby.updatedAt = null;
  }

  if (matchGuid) lobby.matchGuid = matchGuid;
  lobby.playlistId = playlist.id;
  lobby.playlistShort = playlist.short || "MMR";

  // Merge: add unknown players, refresh known ones, never delete.
  const currentIds = new Set(currentPlayers.map((player) => player.PrimaryId));
  let added = 0;

  for (const player of currentPlayers) {
    const existing = lobby.players.find((entry) => entry.primaryId === player.PrimaryId);
    if (existing) {
      existing.name = player.Name;
      const teamNum = parseTeamNum(player.TeamNum);
      if (teamNum !== null) existing.teamNum = teamNum;
      continue;
    }

    lobby.players.push({
      name: player.Name,
      primaryId: player.PrimaryId,
      teamNum: parseTeamNum(player.TeamNum),
      isSelf: player.PrimaryId === latest.playerPrimaryId,
      left: false,
      trackerUrl: buildTrackerUrl(player),
      rank: { status: "loading" }
    });
    added += 1;
  }

  for (const entry of lobby.players) {
    entry.left = !currentIds.has(entry.primaryId);
  }

  const signature = [
    lobby.matchGuid,
    lobby.playlistId,
    lobby.players.map((entry) => entry.primaryId).sort().join(","),
    lobby.players.filter((entry) => entry.left).map((entry) => entry.primaryId).sort().join(",")
  ].join("|");

  if (signature === lobbySignature) return;
  lobbySignature = signature;

  if (added) {
    appState.log("info", "Lobby updated", {
      players: lobby.players.map((entry) => entry.name + (entry.left ? " (left)" : "")),
      playlist: lobby.playlistShort
    });
  }

  broadcast("lobby", lobby);
  fetchPendingLobbyRanks();
}

async function fetchPendingLobbyRanks() {
  if (lobbyFetchInFlight) return;
  lobbyFetchInFlight = true;

  try {
    // Drain queue: pick up entries added while this worker is running too.
    for (;;) {
      const entry = lobby.players.find((candidate) => candidate.rank && candidate.rank.status === "loading");
      if (!entry) break;

      entry.rank = await trackerClient.getPlaylistRank({
        primaryId: entry.primaryId,
        playerName: entry.name,
        playlistId: lobby.playlistId
      });

      broadcast("lobby", lobby);
      await sleep(400);
    }

    lobby.updatedAt = new Date().toISOString();
    broadcast("lobby", lobby);
  } finally {
    lobbyFetchInFlight = false;
  }
}

function buildTrackerUrl(player) {
  const [platformRaw] = String(player.PrimaryId || "").split("|");
  const slugByPlatform = {
    steam: "steam",
    epic: "epic",
    xboxone: "xbl",
    xbl: "xbl",
    ps4: "psn",
    psn: "psn",
    switch: "switch"
  };
  const slug = slugByPlatform[String(platformRaw || "").toLowerCase()];
  if (!slug) return "";

  // Steam profiles resolve by id64; every other platform resolves by name.
  const target = slug === "steam"
    ? String(player.PrimaryId).split("|")[1] || player.Name
    : player.Name;

  return `https://rocketleague.tracker.network/rocket-league/profile/${slug}/${encodeURIComponent(target)}/overview`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;

    function fail(message, statusCode = 400) {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    }

    req.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 1_000_000) {
        fail("Body too large", 413);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        settled = true;
        resolve(parsed);
      } catch {
        fail("Invalid JSON", 400);
      }
    });
    req.on("error", (error) => fail(error.message || "Request read error", 400));
  });
}

function sendState(res, statusCode = 200) {
  sendJson(res, statusCode, appState.buildClientState());
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
