# Rooftop Fu

Online rooftop tag. The rules come from Counter-Strike 1.6's Hide 'n Seek mod, as played on `awp_rooftops`; despite the name, that mode is really tag: everyone can see everyone, and hiders survive by running, jumping gaps and throwing grenades. The look and feel come from Boomerang Fu on Switch: food characters, pastel floating platforms, slice-in-half kills and a lot of juice.

```sh
npm install
npm run dev        # Vite on :8080 + game server on :3001 → open http://localhost:8080
npm run build && npm start   # production: one server on :8080 serves the client and the websocket
npm run check      # typecheck + map reachability + a headless bots-only match
```

Press **PLAY VS BOTS** for a practice match, or **CREATE ROOM** and share the link (the room code sits in the URL hash). Anyone can add bots in the lobby.

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
| Hiders can't attack; kit: 2 flash, 1 frost (4s freeze / 60% chill), 1 smoke, 1 HE | Same kit; HE becomes **Boom**, which knocks seekers back (shove one off a roof and you get the kill). Tune it all in the grenade block of `src/shared/constants.ts` |
| Knife: 2 front stabs (100 HP + armour), backstab one-shots | Slash is a Boomerang Fu lunge: 2 hits from the front, an instant kill from behind on a hider who isn't running |
| Fall damage; kill triggers off the map | Fall damage on big drops; falling into the mist kills |
| Semiclip for teammates | Teammates pass through each other; opponents shove |
| It's a chase, not a hiding game | Everyone is always visible. Smoke still covers you on screen and blocks flashes. |

## How it's built

- `src/shared/`: the single source of truth that both sides run.
  - `map.ts`: buildings, props, bushes, line of sight.
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

## Dev scripts

- `scripts/check-map.ts`: every roof is reachable and has a way back.
- `scripts/sim-match.ts [n]`: runs a full bots-only match in about 200ms and prints kills, swaps and grenade use.
- `scripts/mp-e2e.ts <url> <outDir>`: two real Chrome clients create, join, rename, ready up and play. Needs the dev servers running.
- `scripts/play-shots.ts`, `scripts/juice-shots.ts`, `scripts/shot.ts`: screenshots taken with the locally installed Chrome (`playwright-core`, no browser download).
