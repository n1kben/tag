# Rooftop Fu

Online rooftop tag. The rules come from Counter-Strike 1.6's Hide 'n Seek mod, as played on `awp_rooftops`; despite the name, that mode is really tag, so that's what this is: everyone can see everyone, taggers chase with knives, and runners survive by running, jumping gaps and throwing grenades. The look and feel come from Boomerang Fu on Switch: food characters, pastel floating platforms, slice-in-half kills and a lot of juice.

```sh
npm install
npm run dev        # Vite on :8080 + game server on :3001 → open http://localhost:8080
npm run build && npm start   # production: one server on :8080 serves the client and the websocket
npm run check      # typecheck + map reachability + a headless bots-only match
```

Two modes, picked on the title screen or in the lobby:
- **Tag**: rooftop tag in rounds, with CS 1.6 HNS rules (below).
- **Deathmatch** (CS "HNS deathmatch"): the same teams and kit (taggers slash, runners flash and frost) with no rounds, for 3:00. Tag a runner and you swap: you become a runner with fresh grenades and 1s of grace, and they respawn as a tagger 2s later on the roof farthest from everyone (1.5s of spawn protection, you blink). Points: +1 per tag, +1 for dropping a tagger (frost or a knock-off), +1 for every 15s a runner stays alive, −1 for falling off on your own.

The play area scales with the lobby: 1.25 roofs per player on top of the plaza (minimum 5 roofs; 13 or more players get the whole city), grown outward from the plaza through jumpable gaps, so it's always one connected patch. The other roofs sink into the mist as backdrop. Tag rounds scale with the map too, from 70s on the smallest to 2:00 on the full city. Tune with `ROOFS_PER_PLAYER` (map.ts) and `MIN_ROUND_TIME` (constants.ts). Preview a size with `/?cam=0,-3,80&players=4`.

Press **PLAY VS BOTS** for a practice match, or **CREATE ROOM** and share the link (the room code sits in the URL hash). Anyone can add bots in the lobby.

## Playing online (VPS + Tailscale Funnel)

The production server serves the page and the websocket on one port, so a single HTTPS tunnel is all friends need: no Tailscale on their side and no open ports on the VPS.

```sh
# on the VPS (once)
git clone -b worktree-rooftop-hns https://github.com/n1kben/tag.git ~/projects/rooftop-fu
~/projects/rooftop-fu/deploy/update.sh          # build + systemd user service on 127.0.0.1:8080
tailscale funnel --bg --https=10000 http://127.0.0.1:8080
# → https://<machine>.<tailnet>.ts.net:10000   (Funnel only allows ports 443, 8443 and 10000)

# later, to ship new commits
~/projects/rooftop-fu/deploy/update.sh
```

Funnel has to be allowed for the node once in the Tailscale admin console; the first `funnel` command prints the link. Turn it off with `tailscale funnel --https=10000 off`. Restarting the server ends matches in progress.

**UDP.** Funnel only carries TCP, so behind it every player stays on the WebSocket (it works, just with TCP's stalls on lossy connections). For UDP, the server needs one public UDP port: `RTC_PORT` (default 40000) on a box with a public IP, open in its firewall (`ufw allow 40000/udp`, plus the provider's panel if it has one). The page and WebSocket can stay behind Funnel; the browser connects to that UDP port directly, and falls back to the WebSocket by itself when it can't. Press **P** in game: the netgraph's first word says `UDP` or `WS`.

## Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move (you face where you move) | WASD / arrows | left stick / d-pad | stick: put a thumb anywhere on the left half |
| Jump: tap for a hop, hold for full height. No cooldown: **bunny hop** by pressing again right as you land (within 0.05s) and your top speed grows 8% per hop, up to 1.4×; linger on the ground and it's gone. `HOP_*` in constants.ts | Space | A | JUMP |
| Tagger slashes | J, K or Enter | X / RT / Y / bumpers | SLASH |
| Runner holds to aim a flash / a frost (the throw arc shows), lets go to throw | J (or Enter) / K | X or RT / Y or bumpers | FLASH / FROST |
| Scoreboard · mute · debug HUD | Tab · M · P | hold Select (−) | hold 🏆 · 🔊 |

Menus work on a gamepad too: the stick / d-pad moves a yellow focus ring, A presses, B leaves the lobby, Start readies up, the bumpers flip your character. Room codes are typed (keyboard, or the iPad's on-screen one). Once the pad is in use, the hints show its buttons, with Nintendo labels for 8BitDo / Switch pads (`src/client/pad.ts`, checked by `scripts/check-pad.ts <baseUrl>`). Safari only sees a controller after you press one of its buttons on the page.

Touch controls appear after your first tap; any key or gamepad input hides them again (`src/client/touch.ts`, checked by `scripts/check-touch.ts <baseUrl>`). Phones and tablets work in portrait and landscape: held upright, the camera backs off to show as much width as a square screen. Tapping a menu button goes fullscreen where the browser allows it (Android, iPad); on iPhone use Share → **Add to Home Screen**, which also launches it full screen.

There's no mouse aim on purpose. As in Boomerang Fu, you face (and throw) where you move; while holding a grenade you stand still and the move keys just turn you to aim.

## Rules (CS 1.6 hidenseek defaults → this game)

| CS 1.6 HNS | Rooftop Fu |
|---|---|
| Terrorists hide, CTs seek, teams about even | Runners vs taggers; taggers are the smaller half |
| `hns_hidetime 10`: seekers' screens black, frozen | No hiding: taggers just start frozen for 5s (they can watch, with a countdown) while runners scatter |
| Hiders win if anyone survives the round timer; seekers win by killing every hider | Same (runners/taggers), with a 2:00 chase |
| Teams swap only when seekers win | Same (taggers) |
| `hns_hiders_alivefrags`: +1 per surviving hider | +1 point per surviving runner, +1 per tag |
| Hiders can't attack; kit: 2 flash, 1 frost (4s freeze / 60% chill), smoke, HE | **2 flash + 1 frost**, and one back for every 20s you stay alive missing some, up to the kit (smoke and HE cut). Flash a tagger right before a jump; frost them mid-air and they drop into the mist (you get the kill). Tune in the grenade block of `src/shared/constants.ts` |
| Knife: 2 front stabs (100 HP + armour), backstab one-shots | Boomerang Fu rules: **one hit kills**, and there's no health. The slash is a short step-in: you have to be practically touching (a gap of 0.3u or less), walls, hedges, crates, ducts and huts block it, and you can swing again after 0.3s |
| Fall damage; kill triggers off the map | Fall damage on big drops; falling into the mist kills |
| Semiclip for teammates | Teammates pass through each other; opponents shove |
| It's a chase, not a hiding game | Everyone is always visible |

## How it's built

- `src/shared/`: the single source of truth that both sides run.
  - `map.ts`: the rooftops, obstacles and line of sight. Every roof is the same height, so the challenge is timing jumps across alleys and over obstacles. Obstacles come in two clear heights: low ones (ducts, walls, hedges, crates, AC units, vents) are always jumpable; tall ones (huts, tanks, chimneys, stalls) you run around. Each roof gets a seeded layout (staggered ducts, a hut courtyard, a slalom, hedge rows, or a yard), mirrored per roof and scattered with extra low clutter. Obstacles always leave a 1.1-unit gap to run through, a clear strip along roof edges for run-ups, and room to land past anything low.
  - `sim.ts`: the deterministic movement step, used for server authority and client prediction.
  - `nav.ts`: the bot route graph. An edge exists only if the real movement sim completes that jump from several start conditions.
  - `wire.ts`: binary snapshots and input packets.
- `src/server/`: rooms and lobby (`room.ts`), the match at a 60Hz tick (`match.ts`), bots (`bots.ts`), the UDP data channel (`rtc.ts`).
- `src/client/`:
  - `world.ts`: rooftops, lighting and the height mist.
  - `characters.ts`: the food characters and the slice death.
  - `fx.ts`: effects and juice.
  - `ui.ts`: the DOM UI.
  - `netcode.ts`: prediction and reconciliation, the snapshot buffer and render clock, event timing, net stats. No DOM, so the net bench runs it too.
  - `net.ts`: the WebSocket and the UDP data channel.
  - `game.ts`: screens, and wiring snapshots and events to characters and effects.
- Movement is tuned against Boomerang Fu trailer footage: about 6–7 body-widths/s, full speed in about 0.13s, a short skid when you let go. The jump is snappy: about 0.5s in the air, a heavier fall, variable height, near-full air control, and a blob shadow on the surface below to show where you'll land. `npx tsx scripts/jump-metrics.ts` prints the numbers.

The look was matched against frames from Boomerang Fu's official release trailer:
- the same camera pitch
- periwinkle walls that fade into white mist
- pale rims on platform edges and soft lavender shadows
- purple-brown crates, red stall roofs, bunting

## Networking

Server-authoritative at 60Hz, like CS 1.6, tuned with `scripts/net-bench.ts` (below).

- **Your own player** is predicted: the client runs your input at once and sends it; the server runs every input it receives, exactly once and in order, and acks it; the client replays whatever isn't acked yet on top of each snapshot and slides away any difference. Inputs that arrive late are caught up in a burst (up to 1s, never faster than real time overall). Nothing at all for 250ms (a stall, a background tab) and the server stands you still, so nobody hangs in the air.
- **Everyone else** is drawn a little in the past, between two snapshots (30Hz). How far adapts to the connection: one snapshot interval plus how late snapshots tend to arrive (about 60ms on a good line). A late snapshot doesn't freeze anyone: they carry on along their velocity for up to 100ms.
- **Slashes are lag-compensated**: the server checks a slash against where the target was on the attacker's screen (up to 200ms back), as long as they're still within reach now (1.2m slack), so someone who has really got away is safe. `UNLAG_MAX_TICKS` / `UNLAG_NOW_SLACK` in constants.ts.
- **Events play on your screen's clock**: a kill, spawn or grenade shows when your view of the world reaches the moment it happened, so you die when the tagger's lunge reaches you, not 100ms before. Your own kills and throws show instantly.
- **On the wire**: snapshots are binary (about 550 bytes for 13 players; your own state exact, others to 1cm). With UDP (WebRTC data channel, unreliable and unordered) snapshots come down it and inputs go up it, each packet repeating the last 3 inputs so a lost one costs nothing. Lobby, rounds and events stay on the WebSocket, which is also the fallback. `?udp=0` forces the WebSocket. Server env: `RTC=off`, `RTC_PORT`, `RTC_STUN` (only if the server is behind NAT).
- **Netgraph**: press **P** for the transport, ping, how far behind others are drawn, late snapshots, frozen time, corrections and teleports.

What the bench measures (6 clients + 2 bots, 6 deathmatches each; victim gap = distance between you and the tagger on your screen when you're shown dying, hit% = slashes that touched on the attacker's screen and landed):

| profile (rtt, loss) | before: teleports/min, frozen, hit%, victim gap p95 | now over WebSocket | now over UDP |
|---|---|---|---|
| good (30ms) | 0.0, 0%, 26%, 0.68m | 0.0, 0%, 96%, 0.68m | 0.0, 0%, 98%, 0.68m |
| typical (80ms ±12, 0.5%) | 1.1, 1.3%, 11%, 0.76m | 0.1, 0.6%, 91%, 1.42m | 0.1, 0%, 98%, 1.23m |
| bad (150ms ±30, 2%) | 30.7, 8.4%, 8%, 1.80m | 1.2, 1.9%, 20%, 2.14m | 0.4, 0%, 56%, 2.06m |

The victim's median gap went from 0.3–0.5m to under 0.2m on good and typical lines (about 0.35m on bad, as before); the worst 5% got a little wider, the price of lag compensation favouring the attacker (capped).

## Performance

- The static city is baked into merged meshes (about 120 draw calls in play) and the shadow map is drawn once at load; characters use blob shadows.
- Resolution adapts: it starts at the screen's pixel density (max 2×), steps down when frames take longer than 20ms, and climbs back when there's headroom.
- MSAA is off on high-density (Retina) screens, where it costs about 40% for no visible gain.
- URL options: `?dpr=1` pins the resolution, `?noaa` turns anti-aliasing off, `?noshadow` turns shadows off, `?lite` gives half resolution with no shadows.
- Press **P** for fps, draw calls, triangles, resolution, and JS vs render milliseconds (under the netgraph).

## Dev scripts

- `scripts/check-map.ts`: for every map size (1–18 players), every roof is reachable and has a way back, spawns are clear, no obstacle has an in-between height, and every low obstacle can be cleared with the real jump.
- `scripts/check-slash.ts`: slash reach through the real server tick (hits when touching, misses from half a body away) and that every obstacle type blocks it.
- `scripts/fps.ts <url…>`: render fps in headless Chrome, to compare scene cost between builds. Add `?lite` to any URL for half resolution and no shadows.
- `scripts/balance.ts [matches]`: Tag runner win rate by map size (bots-only; bots favour taggers even on the full city, so use it for comparisons, not absolute balance).
- `scripts/check-dm.ts [n] [matches]`: Deathmatch invariants. Team sizes stay fixed, every tag swaps that pair, tagged runners return as taggers, runners earn survival points.
- `scripts/sim-match.ts [n] [tag|dm]`: runs a full bots-only match in about 200ms and prints kills, swaps and grenade use.
- `scripts/net-bench.ts [profile|all] [seconds] [runs] [clients] [bots] [tcp|udp|both]`: the real server match and client netcode over a simulated network (delay, jitter, loss; TCP-like or UDP-like) on a simulated clock, bots playing from what their client sees. Prints rubber-banding, teleports, freezes, how far others are drawn behind, the victim's view at a kill, the attacker's hit rate. Deterministic, about 5s per profile.
- `scripts/check-inputs.ts`: server input handling. Moves straight away after a silence, catches up after a stall and burst, can't outrun real time.
- `scripts/check-codec.ts`: binary snapshots round-trip (own state exact, others within rounding) and fit one UDP packet.
- `scripts/check-udp.ts <url>`: a real Chrome against the dev server opens the data channel, gets snapshots over it and moves; `?udp=0` does the same over the WebSocket.
- `scripts/mp-e2e.ts <url> <outDir>` and `scripts/dm-e2e.ts <url> <outDir>`: two real Chrome clients create, join, rename, ready up and play Tag or Deathmatch (including die and respawn). Need the dev servers running.
- `scripts/play-shots.ts`, `scripts/juice-shots.ts`, `scripts/shot.ts`: screenshots taken with the locally installed Chrome (`playwright-core`, no browser download).
