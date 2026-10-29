# Rooftop Fu

Online rooftop tag. The rules come from Counter-Strike 1.6's Hide 'n Seek mod, as played on `awp_rooftops`; despite the name, that mode is really tag: everyone can see everyone, and hiders survive by running, jumping gaps and throwing grenades. The look and feel come from Boomerang Fu on Switch: food characters, pastel floating platforms, slice-in-half kills and a lot of juice.

```sh
npm install
npm run dev        # Vite on :8080 + game server on :3001 → open http://localhost:8080
npm run build && npm start   # production: one server on :8080 serves the client and the websocket
npm run check      # typecheck + map reachability + a headless bots-only match
```

Two modes, picked on the title screen or in the lobby:
- **Hide 'n Seek**: rooftop tag with CS 1.6 HNS rules (below).
- **Deathmatch** (CS "HNS deathmatch"): the same teams and kit (seekers slash, hiders flash and frost) with no rounds, for 3:00. Catch a hider and you swap: you become a hider with fresh grenades and 1s of grace, and they respawn as a seeker 2s later on the roof farthest from everyone (1.5s of spawn protection, you blink). Points: +1 per catch, +1 for dropping a seeker (frost or a knock-off), +1 for every 15s a hider stays alive, −1 for falling off on your own.

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

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Move (you face where you move) | WASD / arrows | left stick / d-pad |
| Jump: tap for a hop, hold for full height, jump right on landing to chain hops | Space | A |
| Seeker slashes · hider holds to aim a grenade (the throw arc shows) and releases to throw | Enter | X / RT |
| Hider switches grenade | Q | Y / bumpers |
| Scoreboard · mute · debug HUD | Tab · M · P | |

There's no mouse aim on purpose. As in Boomerang Fu, you face (and throw) where you move.

## Rules (CS 1.6 hidenseek defaults → this game)

| CS 1.6 HNS | Rooftop Fu |
|---|---|
| Terrorists hide, CTs seek, teams about even | Hiders vs seekers; seekers are the smaller half |
| `hns_hidetime 10`: seekers' screens black, frozen | 10s hide phase: seekers are locked with a blacked-out screen and a countdown |
| Hiders win if anyone survives the round timer; seekers win by killing every hider | Same, with a 2:00 seek phase |
| Teams swap only when seekers win | Same |
| `hns_hiders_alivefrags`: +1 per surviving hider | +1 point per surviving hider, +1 per kill |
| Hiders can't attack; kit: 2 flash, 1 frost (4s freeze / 60% chill), smoke, HE | **2 flash + 1 frost** (smoke and HE cut). Flash a seeker right before a jump; frost them mid-air and they drop into the mist (you get the kill). Tune in the grenade block of `src/shared/constants.ts` |
| Knife: 2 front stabs (100 HP + armour), backstab one-shots | Slash is a short Boomerang Fu step-in: you have to be practically touching (a gap of 0.3u or less), and walls, hedges, crates, ducts and huts block it. 2 hits from the front, an instant kill from behind on a hider who isn't running |
| Fall damage; kill triggers off the map | Fall damage on big drops; falling into the mist kills |
| Semiclip for teammates | Teammates pass through each other; opponents shove |
| It's a chase, not a hiding game | Everyone is always visible |

## How it's built

- `src/shared/`: the single source of truth that both sides run.
  - `map.ts`: the rooftops, obstacles and line of sight. Every roof is the same height, so the challenge is timing jumps across alleys and over obstacles. Obstacles come in two clear heights: low ones (ducts, walls, hedges, crates, AC units, vents) are always jumpable; tall ones (huts, tanks, chimneys, stalls) you run around. Each roof gets a seeded layout (staggered ducts, a hut courtyard, a slalom, hedge rows, or a yard), mirrored per roof and scattered with extra low clutter. Obstacles always leave a 1.1-unit gap to run through, a clear strip along roof edges for run-ups, and room to land past anything low.
  - `sim.ts`: the deterministic movement step, used for server authority and client prediction.
  - `nav.ts`: the bot route graph. An edge exists only if the real movement sim completes that jump from several start conditions.
- `src/server/`: rooms and lobby (`room.ts`), the match at a 60Hz tick (`match.ts`), bots (`bots.ts`).
- `src/client/`:
  - `world.ts`: rooftops, lighting and the height mist.
  - `characters.ts`: the food characters and the slice death.
  - `fx.ts`: effects and juice.
  - `ui.ts`: the DOM UI.
  - `game.ts`: prediction and reconciliation, interpolation, and wiring events to effects.
- Movement is tuned against Boomerang Fu trailer footage: about 6–7 body-widths/s, full speed in about 0.13s, a short skid when you let go. The jump is snappy: about 0.5s in the air, a heavier fall, variable height, near-full air control, and a blob shadow on the surface below to show where you'll land. `npx tsx scripts/jump-metrics.ts` prints the numbers.
- Networking: the client sends one input per 60Hz tick, and the server consumes exactly one per tick and acks it. The client replays inputs the server hasn't acked yet, and smooths any correction away. Other players are drawn about 100ms in the past from 30Hz snapshots.

The look was matched against frames from Boomerang Fu's official release trailer:
- the same camera pitch
- periwinkle walls that fade into white mist
- pale rims on platform edges and soft lavender shadows
- purple-brown crates, red stall roofs, bunting

## Performance

- The static city is baked into merged meshes (about 120 draw calls in play) and the shadow map is drawn once at load; characters use blob shadows.
- Resolution adapts: it starts at the screen's pixel density (max 2×), steps down when frames take longer than 20ms, and climbs back when there's headroom.
- MSAA is off on high-density (Retina) screens, where it costs about 40% for no visible gain.
- URL options: `?dpr=1` pins the resolution, `?noaa` turns anti-aliasing off, `?noshadow` turns shadows off, `?lite` gives half resolution with no shadows.
- Press **P** for fps, draw calls, triangles, resolution, and JS vs render milliseconds.

## Dev scripts

- `scripts/check-map.ts`: every roof is reachable and has a way back, spawns are clear, no obstacle has an in-between height, and every low obstacle can be cleared with the real jump.
- `scripts/check-slash.ts`: slash reach through the real server tick (hits when touching, misses from half a body away) and that every obstacle type blocks it.
- `scripts/fps.ts <url…>`: render fps in headless Chrome, to compare scene cost between builds. Add `?lite` to any URL for half resolution and no shadows.
- `scripts/check-dm.ts [n] [matches]`: Deathmatch invariants. Team sizes stay fixed, every catch swaps that pair, caught hiders return as seekers, hiders earn survival points.
- `scripts/sim-match.ts [n] [hns|dm]`: runs a full bots-only match in about 200ms and prints kills, swaps and grenade use.
- `scripts/mp-e2e.ts <url> <outDir>` and `scripts/dm-e2e.ts <url> <outDir>`: two real Chrome clients create, join, rename, ready up and play Hide 'n Seek or Deathmatch (including die and respawn). Need the dev servers running.
- `scripts/play-shots.ts`, `scripts/juice-shots.ts`, `scripts/shot.ts`: screenshots taken with the locally installed Chrome (`playwright-core`, no browser download).
