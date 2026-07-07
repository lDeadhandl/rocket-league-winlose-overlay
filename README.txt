ROCKET LEAGUE WIN/LOSE OVERLAY

1. Run:
   START-WINDOWS.bat

   If Node.js is missing, the .bat tries to install it by itself with winget.
   npm comes with Node.js, then the project dependencies install themselves.
   The .bat also configures the Rocket League Stats API automatically (with a backup).
   If winget is not available, install Node.js LTS from here:
   https://nodejs.org/

2. In the panel that opens:
   - don't change anything in normal use
   - just watch Live status / Session / Diagnostics
   - open "Manual troubleshooting" only if auto-detection fails
   - use "Test connection" if it stays on connecting

3. In OBS, add a Browser Source:
   http://localhost:5177/overlay.html

   Width 1920, height 1080. No custom CSS needed.
   If you still see black, click "Refresh cache of current page" in the OBS source.

4. The .bat tries to enable the Stats API by itself in:
   <Install Dir>\TAGame\Config\DefaultStatsAPI.ini

   If it stays on connecting, close Rocket League, run START-WINDOWS.bat
   as administrator, then restart Rocket League.

   PacketSendRate=30
   Port=49123

Keep the black window open while you play.
(Or run AUTOSTART.bat once: the server then starts hidden at every
Windows login and there is no window to keep open. Run it again to turn it off.)

OBS

The overlay shows a small MMR / WIN / LOSE / WINSTREAK bar in the top right.
By default, wins/losses go back to zero when you restart the overlay.
In "Manual troubleshooting", tick "Keep win / lose between sessions" then "Save"
if you want to keep them across launches.
The MMR comes from Tracker.gg. If the auto mode gets it wrong, open "Manual troubleshooting"
and force the MMR mode.
The bar uses an embedded transparent SVG image, so you only need the OBS link.
An external overlay on top of exclusive fullscreen is not reliable without hooking/injection, so we stick with OBS to stay clean with EAC.

USEFUL LOGS

ECONNREFUSED 127.0.0.1:49123 = Rocket League is not providing the Stats API.
Match state = the connection to the game works.
Score update = the Blue/Orange scores are read correctly.
Player detected = the overlay knows which team to count.
No player matches your config = fix your username in the panel.
Result inferred from MatchDestroyed = FF/forfeit counted from the known score.

DIAGNOSTICS

If it stays on connecting, close Rocket League, start it again, then use "Test connection"
in the panel. If the TCP test fails on 49123, Rocket League did not load the Stats API.
