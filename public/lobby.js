const params = new URLSearchParams(window.location.search);
const settings = {
  // ?hide=end (default) clears the panel when the match is destroyed;
  // ?hide=never keeps the last lobby on screen.
  hideOnEmpty: params.get("hide") !== "never"
};

const el = {
  panel: document.getElementById("lobbyPanel"),
  title: document.getElementById("lobbyTitle"),
  rows: document.getElementById("lobbyRows")
};

const TIER_COLORS = [
  [/supersonic/i, "#ff4655"],
  [/grand champ/i, "#e0364b"],
  [/champion/i, "#b48ef0"],
  [/diamond/i, "#5ea3f0"],
  [/platinum/i, "#7fd8e8"],
  [/gold/i, "#e8c04b"],
  [/silver/i, "#c3cbd1"],
  [/bronze/i, "#c07a3a"]
];

document.body.classList.toggle("preview-mode", params.get("preview") === "1");

if (params.get("demo") === "1") {
  renderLobby({
    playlistShort: "2V2",
    players: [
      { name: "Uncuru", teamNum: 1, isSelf: true, rank: { status: "ready", rating: 1687, tier: "Grand Champion I" } },
      { name: "MateGuy", teamNum: 1, isSelf: false, rank: { status: "ready", rating: 1702, tier: "Grand Champion I" } },
      { name: "Opponent1", teamNum: 0, isSelf: false, rank: { status: "ready", rating: 1745, tier: "Grand Champion II" } },
      { name: "Opponent2", teamNum: 0, isSelf: false, rank: { status: "loading" } }
    ]
  });
} else {
  connect();
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/live`);

  socket.addEventListener("message", (event) => {
    const message = parseSocketMessage(event.data);
    if (!message) return;
    if (message.type === "lobby") renderLobby(message.payload);
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connect, 1200);
  });
}

function renderLobby(lobby) {
  const players = lobby && Array.isArray(lobby.players) ? lobby.players : [];

  if (!players.length) {
    if (settings.hideOnEmpty) el.panel.classList.remove("is-visible");
    return;
  }

  el.title.textContent = `Lobby ${lobby.playlistShort || ""}`.trim();

  const sorted = [...players].sort((a, b) => {
    const teamA = a.teamNum === null ? 2 : a.teamNum;
    const teamB = b.teamNum === null ? 2 : b.teamNum;
    if (teamA !== teamB) return teamA - teamB;
    return (ratingOf(b) || 0) - (ratingOf(a) || 0);
  });

  el.rows.innerHTML = sorted.map(renderRow).join("");
  el.panel.classList.add("is-visible");
}

function renderRow(player) {
  const rank = player.rank || {};
  const teamClass = player.teamNum === 1 ? "orange" : "blue";
  const tier = tierAbbrev(rank.tier);
  const color = tierColor(rank.tier);
  const tierHtml = tier
    ? `<span class="lo-tier" style="color:${color};border:1px solid ${withAlpha(color, 0.45)};background:${withAlpha(color, 0.14)}">${escapeHtml(tier)}</span>`
    : "<span></span>";

  return `
    <div class="lo-row ${teamClass} ${player.isSelf ? "self" : ""}${player.left ? " left" : ""}">
      <span class="lo-dot"></span>
      <span class="lo-name">${escapeHtml(player.name || "?")}</span>
      <span class="lo-mmr">${escapeHtml(formatRating(rank))}</span>
      ${tierHtml}
    </div>
  `;
}

function ratingOf(player) {
  const rank = player.rank || {};
  return rank.status === "ready" && Number.isFinite(Number(rank.rating)) ? Number(rank.rating) : null;
}

function formatRating(rank) {
  if (rank.status === "loading") return "...";
  if (rank.status === "ready" && rank.rating !== null && rank.rating !== undefined) return String(rank.rating);
  if (rank.status === "missing") return "UR";
  return "--";
}

function tierAbbrev(tier) {
  const name = String(tier || "").trim();
  if (!name || /unranked/i.test(name)) return "";
  if (/supersonic/i.test(name)) return "SSL";

  const roman = name.match(/\b(III|II|I)\b/);
  const num = { I: 1, II: 2, III: 3 }[roman ? roman[1] : ""] || "";
  const prefix = /grand champ/i.test(name) ? "GC"
    : /champion/i.test(name) ? "C"
    : /diamond/i.test(name) ? "D"
    : /platinum/i.test(name) ? "P"
    : /gold/i.test(name) ? "G"
    : /silver/i.test(name) ? "S"
    : /bronze/i.test(name) ? "B"
    : "";
  return prefix ? `${prefix}${num}` : name.slice(0, 4).toUpperCase();
}

function tierColor(tier) {
  const name = String(tier || "");
  for (const [pattern, color] of TIER_COLORS) {
    if (pattern.test(name)) return color;
  }
  return "#c3cbd1";
}

function withAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseSocketMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
