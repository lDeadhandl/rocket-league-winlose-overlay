# Rocket League Win/Lose Overlay

OBS overlay for Rocket League that shows the session's MMR, wins, losses and winstreak.

It uses Rocket League's official local Stats API. It does not hook the game, injects nothing, and works cleanly with EAC through OBS.

## Preview

![OBS overlay](docs/screenshots/overlay.png)

![Dashboard](docs/screenshots/dashboard.png)

## What it does

- Shows a transparent OBS bar with `MMR / WIN / LOSE / STREAK`.
- Automatically counts wins/losses when Rocket League sends the winner.
- Also counts FF/forfeits when the final score allows inferring the result.
- Fetches the MMR from Tracker.gg once the player and mode are detected.
- Keeps the last displayed MMR until a new valid MMR is received.
- Resets wins/losses on every launch by default, with an option to keep them between sessions.
- Provides a local dashboard with logs, history and correction buttons.

## Quick Install

### 1. Download

Download the latest release:

```txt
https://github.com/julianout/RocketLeague-win-lose/releases/latest
```

Grab:

```txt
rocket-league-winlose-overlay-ready.zip
```

Unzip the folder wherever you want.

### 2. Run

Double-click:

```txt
START-WINDOWS.bat
```

The launcher takes care of:

- installing Node.js LTS with `winget` if Node is missing;
- checking `npm`;
- installing the project dependencies;
- enabling the Rocket League Stats API (with a backup);
- opening the dashboard;
- starting the overlay server.

If Node.js cannot be installed automatically, install Node.js LTS from here, then run the `.bat` again:

```txt
https://nodejs.org/
```

### 3. Restart Rocket League

If the launcher changed the Stats API config, fully close Rocket League and start it again.

If it stays on `connecting`, run `START-WINDOWS.bat` as administrator, then restart Rocket League.

Manual config if needed:

```txt
<Rocket League folder>\TAGame\Config\DefaultStatsAPI.ini
```

```ini
[TAGame.MatchStatsExporter_TA]
Port=49123
PacketSendRate=30
```

The launcher prints:

```txt
Panel: http://localhost:5177/control.html
OBS:   http://localhost:5177/overlay.html
```

Keep that window open while you play.

### 4. Add to OBS

Add a `Browser Source` with:

```txt
http://localhost:5177/overlay.html
```

Recommended settings:

```txt
Width: 1920
Height: 1080
Custom CSS: empty
```

No custom CSS needed. If OBS keeps an old render, click `Refresh cache of current page`.

## Auto-start (optional)

Run `AUTOSTART.bat` once to make the server start hidden at every Windows login — no console window, nothing to launch before playing. Run it again to turn auto-start off (it also stops the running server).

After changing the code, run it twice (off + on) to restart the server with the new code.

With an always-on server, the session counter auto-resets when Rocket League reconnects after being offline for 30+ minutes, so every play session still starts at 0-0 (unless `Keep win / lose between sessions` is enabled).

## BakkesMod Version

This project is not a native BakkesMod plugin. The GitHub release zip contains the full Windows launcher with `.bat` files.

Publishing on the BakkesMod site requires a separate zip without `.bat`, `.exe`, `.dll`, `.sh` or other forbidden files. That zip is not attached to the GitHub release.

## Dashboard

Open:

```txt
http://localhost:5177/control.html
```

In normal use you don't have to configure anything. The dashboard is mostly there to check:

- Stats API connection;
- detected player;
- detected team;
- live score;
- MMR mode;
- Tracker MMR;
- session history;
- useful logs.

The `Manual troubleshooting` section stays collapsed. It is only needed if auto-detection fails or if you want to correct a result.

By default, wins/losses go back to zero when you restart the overlay. In `Manual troubleshooting`, tick `Keep win / lose between sessions` then `Save` if you want to keep the session across launches.

## MMR

The official Stats API does not provide the MMR. The app therefore uses Tracker.gg based on the player detected by Rocket League.

Mode detection:

- if Rocket League sends a playlist/mode field, the app uses it;
- otherwise the app infers the mode from the player count: 1v1, 2v2, 3v3, 4v4;
- if auto-detection gets it wrong, force the mode in `Manual troubleshooting`.

Tracker.gg can lag behind or temporarily reject some requests. When that happens, win/loss counting keeps working.

## Useful Logs

Important messages in the dashboard:

- `Stats API connected over TCP`: the app is connected to the Rocket League port.
- `Match state`: Rocket League is sending data.
- `Player detected`: the app knows which team to count.
- `MMR mode detected`: the app knows which mode to use for the MMR.
- `Tracker MMR received`: the MMR was received.
- `WIN result recorded` / `LOSE result recorded`: the match was counted.
- `Result inferred from MatchDestroyed`: FF/forfeit counted from the last known score.

If it stays on `connecting`, open `Manual troubleshooting`, then click `Test connection`.
If the TCP test fails, close Rocket League and run `START-WINDOWS.bat` as administrator so the launcher can update `DefaultStatsAPI.ini`.

## OBS Options

Hide the permanent bar:

```txt
http://localhost:5177/overlay.html?hud=0
```

Change the WIN/LOSE toast duration:

```txt
http://localhost:5177/overlay.html?duration=9000
```

Demo mode to check the rendering:

```txt
http://localhost:5177/overlay.html?demo=1&preview=1
http://localhost:5177/control.html?demo=1
```

## Notes

An overlay on top of Rocket League's exclusive fullscreen is not reliable without hooking/injection. With EAC, the clean approach is an OBS Browser Source.

The following local files are not committed:

- `config.json`
- `data/session.json`
- `data/overlay.log`
- `node_modules/`
