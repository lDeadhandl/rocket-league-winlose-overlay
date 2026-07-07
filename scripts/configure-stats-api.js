const fs = require("fs");
const os = require("os");
const path = require("path");

const SECTION = "TAGame.MatchStatsExporter_TA";
const REQUIRED_SETTINGS = {
  Port: "49123",
  PacketSendRate: "30"
};

function main() {
  if (process.platform !== "win32") {
    console.log("Configuration Stats API ignoree: Windows uniquement.");
    return 0;
  }

  const candidates = findConfigCandidates();
  const usable = candidates.filter((candidate) => candidate.allowCreate || fs.existsSync(candidate.file));

  if (!usable.length) {
    console.log("Configuration Stats API: Rocket League introuvable automatiquement.");
    console.log("Edite DefaultStatsAPI.ini manuellement si la connexion reste en connecting.");
    return 0;
  }

  let configured = 0;
  let changed = 0;
  let denied = 0;

  for (const candidate of usable) {
    try {
      const result = ensureStatsApiConfig(candidate.file);
      configured += 1;
      if (result.changed) {
        changed += 1;
        console.log(`Stats API configuree: ${candidate.file}`);
        if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
      } else {
        console.log(`Stats API deja OK: ${candidate.file}`);
      }
    } catch (error) {
      if (error && (error.code === "EACCES" || error.code === "EPERM")) {
        denied += 1;
        console.log(`Droits admin requis pour modifier: ${candidate.file}`);
      } else {
        console.log(`Configuration Stats API impossible: ${candidate.file}`);
        console.log(error && error.message ? error.message : String(error));
      }
    }
  }

  if (!configured && denied) {
    console.log("Relance START-WINDOWS.bat en administrateur si Rocket League est installe dans Program Files.");
    return 2;
  }

  if (changed) {
    console.log("Ferme completement Rocket League puis relance-le pour charger la config Stats API.");
  }

  return 0;
}

function findConfigCandidates() {
  const candidates = [];
  const seen = new Set();

  function addInstallRoot(root, source) {
    if (!root) return;
    const normalizedRoot = path.normalize(root);
    const file = path.join(normalizedRoot, "TAGame", "Config", "DefaultStatsAPI.ini");
    const allowCreate = fs.existsSync(file) || fs.existsSync(path.join(normalizedRoot, "TAGame"));
    addCandidate(file, source, allowCreate);
  }

  function addCandidate(file, source, allowCreate = false) {
    if (!file) return;
    const normalized = path.normalize(file);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ file: normalized, source, allowCreate });
  }

  const programFiles = unique([
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.ProgramW6432
  ]);

  for (const base of programFiles) {
    addInstallRoot(path.join(base, "Epic Games", "rocketleague"), "epic-default");
    addInstallRoot(path.join(base, "Steam", "steamapps", "common", "rocketleague"), "steam-default");
  }

  for (const root of findEpicInstallRoots()) addInstallRoot(root, "epic-manifest");
  for (const root of findSteamInstallRoots()) addInstallRoot(root, "steam-library");

  return candidates;
}

function findEpicInstallRoots() {
  const roots = [];
  const manifestDir = path.join(process.env.ProgramData || "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
  if (!fs.existsSync(manifestDir)) return roots;

  let names = [];
  try {
    names = fs.readdirSync(manifestDir);
  } catch {
    return roots;
  }

  for (const name of names) {
    if (!name.toLowerCase().endsWith(".item")) continue;
    const file = path.join(manifestDir, name);
    try {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
      const label = `${manifest.DisplayName || ""} ${manifest.AppName || ""} ${manifest.CatalogItemId || ""}`.toLowerCase();
      if (label.includes("rocket") && label.includes("league") && manifest.InstallLocation) {
        roots.push(manifest.InstallLocation);
      }
    } catch {
      // Ignore malformed Epic manifests.
    }
  }

  return roots;
}

function findSteamInstallRoots() {
  const roots = [];
  const steamRoots = unique([
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Steam")
  ]);

  for (const steamRoot of steamRoots) {
    const libraryFile = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
    const libraries = [steamRoot, ...readSteamLibraries(libraryFile)];

    for (const library of unique(libraries)) {
      const installRoot = path.join(library, "steamapps", "common", "rocketleague");
      if (fs.existsSync(installRoot)) roots.push(installRoot);
    }
  }

  return roots;
}

function readSteamLibraries(libraryFile) {
  if (!fs.existsSync(libraryFile)) return [];

  let content = "";
  try {
    content = fs.readFileSync(libraryFile, "utf8");
  } catch {
    return [];
  }
  const libraries = [];
  const pathRegex = /"path"\s+"([^"]+)"/gi;
  let match;

  while ((match = pathRegex.exec(content))) {
    libraries.push(match[1].replace(/\\\\/g, "\\"));
  }

  return libraries;
}

function ensureStatsApiConfig(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const exists = fs.existsSync(file);
  const original = exists ? fs.readFileSync(file, "utf8") : "";
  const updated = updateStatsApiIni(original);

  if (updated === original) {
    return { changed: false, backupPath: null };
  }

  let backupPath = null;
  if (exists) {
    backupPath = `${file}.bak-${timestamp()}`;
    fs.copyFileSync(file, backupPath);
  }

  fs.writeFileSync(file, updated, "utf8");
  return { changed: true, backupPath };
}

function updateStatsApiIni(content) {
  const newline = content.includes("\r\n") ? "\r\n" : content.includes("\n") ? "\n" : os.EOL;
  const normalized = String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.length ? normalized.replace(/\n$/, "").split("\n") : [];

  let sectionStart = -1;
  let sectionEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*\[([^\]]+)\]\s*$/);
    if (!match) continue;

    if (match[1].trim().toLowerCase() === SECTION.toLowerCase()) {
      sectionStart = index;
      sectionEnd = lines.length;
      for (let next = index + 1; next < lines.length; next += 1) {
        if (/^\s*\[[^\]]+\]\s*$/.test(lines[next])) {
          sectionEnd = next;
          break;
        }
      }
      break;
    }
  }

  if (sectionStart === -1) {
    if (lines.length && lines[lines.length - 1].trim()) lines.push("");
    lines.push(`[${SECTION}]`);
    for (const [key, value] of Object.entries(REQUIRED_SETTINGS)) {
      lines.push(`${key}=${value}`);
    }
    return `${lines.join(newline)}${newline}`;
  }

  const found = {};
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const match = lines[index].match(/^(\s*)([^=;#][^=]*?)(\s*)=(.*)$/);
    if (!match) continue;

    const key = match[2].trim();
    const requiredKey = Object.keys(REQUIRED_SETTINGS).find((item) => item.toLowerCase() === key.toLowerCase());
    if (!requiredKey) continue;

    lines[index] = `${requiredKey}=${REQUIRED_SETTINGS[requiredKey]}`;
    found[requiredKey] = true;
  }

  const missing = Object.keys(REQUIRED_SETTINGS).filter((key) => !found[key]);
  if (missing.length) {
    lines.splice(sectionEnd, 0, ...missing.map((key) => `${key}=${REQUIRED_SETTINGS[key]}`));
  }

  const output = lines.join(newline);
  return `${output}${hadTrailingNewline || output ? newline : ""}`;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ensureStatsApiConfig,
  findConfigCandidates,
  updateStatsApiIni
};
