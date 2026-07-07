---
name: verify
description: Drive the overlay server end-to-end without Rocket League or tracker.gg, using a fake Stats API feed and a fake curl.exe for tracker responses.
---

# Verifying the RL win/lose overlay offline

The app is `node server.js` in this directory. It has two external dependencies,
both of which can be faked for a deterministic offline run:

1. **Stats API** (the game): a TCP server the app connects to (`statsApiUrl` in
   `config.json`). It expects newline-free concatenated JSON objects like
   `{"Event":"MatchCreated","Data":{"MatchGuid":"..."}}` and
   `{"Event":"UpdateState","Data":"<stringified JSON with MatchGuid, Players[], Game.Teams, Game.Target>"}`.
   See `scripts/smoke-test.js` `makeUpdateState()` for the exact shape.
   Sequence that produces a detected 2v2 lobby: MatchCreated → MatchInitialized →
   UpdateState (4 players) → RoundStarted.

2. **tracker.gg**: `src/tracker-client.js` shells out to `curl.exe` (found via
   PATH) with `-w "\n%{http_code}"`. Prepend a directory containing a fake
   `curl.exe` to PATH to control responses. The fake must print `body\n<status>`
   to stdout and exit 0. A minimal valid 200 body:
   `{"data":{"platformInfo":{"platformUserId":"<last URL path segment>","platformUserHandle":"x"},"segments":[{"type":"playlist","attributes":{"playlistId":11},"stats":{"rating":{"value":1500},"tier":{"metadata":{"name":"GC1"}},"division":{"metadata":{"name":"Division I"}}}}]}}`
   — `platformUserId` must equal the requested target or the client rejects it
   ("Tracker profile id mismatch"). A C# fake compiled with
   `Add-Type -OutputAssembly curl.exe -OutputType ConsoleApplication` works.

## Gotchas

- **The user's live overlay often runs on port 5177 / stats 49123.** Check
  `netstat` first. Never run the repo copy directly — robocopy the app dir to a
  scratch location, edit its `config.json` (`serverPort: 5178`,
  `statsApiUrl: tcp://127.0.0.1:49124`), and run the copy. `src/paths.js`
  resolves everything relative to the app dir, so the copy is fully isolated.
- **Observe via WebSocket, path `/live`** (`ws://127.0.0.1:5178/live`, `ws`
  module is in `node_modules`). Broadcasts are `{"type":"lobby"|"state"|...,
  "payload":...}`; a new client receives the current state on connect. Plain
  `ws://host:port` without `/live` gets HTTP 400.
- The app logs to stdout and `data/overlay.log`; the log lines ("Tracker lookup
  started", "Lobby updated", "Lobby rank retry scheduled") are the easiest way
  to trace lookup/retry behavior.
- Playlist detection needs MatchInitialized (or another lifecycle event) before
  an UpdateState with the full player count, otherwise it stays
  "waiting-for-start" and no lobby/tracker lookups happen.
