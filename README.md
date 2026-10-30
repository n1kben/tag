# Rooftop Fu

Online tag across floating rooftops. Taggers chase with knives; runners survive by running, jumping gaps and throwing grenades. Everyone can see everyone.

The rules come from Counter-Strike 1.6's Hide 'n Seek mod as played on `awp_rooftops`, which was really tag. The look comes from Boomerang Fu: food characters, pastel platforms, slice-in-half kills.

```sh
npm install
npm run dev                  # Vite on :8080 + game server on :3001 → http://localhost:8080
npm run build && npm start   # production: one server on :8080 for the page and the websocket
npm run check                # typecheck + map reachability + a headless bots-only match
```

Press **PLAY VS BOTS** to practise, or **CREATE ROOM** and share the link (the room code is in the URL hash). Rooms hold 10 players, bots included; anyone can add bots in the lobby.

## Modes

- **Tag**: 8 rounds. Taggers start frozen for 5s while runners scatter. Runners win if anyone survives the timer; taggers win by tagging everyone, and teams swap only when taggers win. Points: +1 per tag, +1 per surviving runner.
- **Deathmatch**: same teams and kit, no rounds, 3:00. Tag a runner and you swap: you become a runner (1s of grace), and they respawn as a tagger 2s later on the roof farthest from everyone (1.5s of spawn protection). Points: +1 per tag, +1 for dropping a tagger (frost or knock-off), +1 per 15s a runner stays alive, −1 for falling off on your own.

The map grows with the lobby: 1.25 roofs per player plus the plaza, at least 5, so 5 roofs for 1–3 players and 14 for 10. The rest of the 18-roof city sinks into the mist. Tag rounds scale with it, from 70s to 1:45 at 10 players. Tune with `ROOFS_PER_PLAYER` (`map.ts`) and `MIN_ROUND_TIME` / `ROUND_TIME` (`constants.ts`). Preview a size with `/?cam=0,-3,80&players=4`.

## Rules

- **One hit kills.** There's no health. The slash is a short step-in: you have to be almost touching, any obstacle in between blocks it, and you can swing again after 0.3s.
- **Runner kit**: 10 flashes and 5 frosts per round, one back every 5s alive. A flash blinds taggers in sight for up to 3.2s. A frost freezes taggers within 5.5 units for 2s (mid-air, they drop into the mist and you get the kill) and slows those out to 8 units to 60% for 4s.
- **Heads**: jump off a teammate's head for extra height. A runner landing on a tagger stuns them for 5s; a tagger landing on a runner bounces back the way they came.
- **Falling**: big drops hurt, the mist kills. Weak planks crack and collapse under you, then rebuild after 12s.
- **Bodies**: players are solid and block each other.

Grenade, slash and jump numbers live in `src/shared/constants.ts`.

## Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move (you face where you move) | WASD / arrows | left stick / d-pad | thumb anywhere on the left half |
| Jump | Space | A | JUMP |
| Slash (tagger) | J, K or Enter | X / Y / RT / bumpers | SLASH |
| Flash / frost (runner: hold to aim, release to throw) | J or Enter / K | X or RT / Y or bumpers | FLASH / FROST |
| Scoreboard · mute · debug HUD | Tab · M · P | hold Select | hold 🏆 · 🔊 |

- **Jump**: tap for a hop, hold for full height. Jump again within 0.05s of landing to **bunny hop**: each hop adds 8% top speed, up to 1.4×. Stay on the ground and it's gone.
- **Aiming**: no mouse aim. You throw where you face; while holding a grenade you stand still and the move keys turn you.
- **Gamepad menus**: stick moves the focus ring, A presses, B leaves the lobby, Start readies up, bumpers change character. Hints switch to Nintendo labels for 8BitDo / Switch pads. Safari only sees a pad after you press one of its buttons.
- **Touch**: controls appear after your first tap and hide on keyboard or pad input. Portrait and landscape both work. Tapping a menu button goes fullscreen on Android and iPad; on iPhone use Share → **Add to Home Screen**.

## Hosting

The production server binds to `127.0.0.1:8080` and serves the page and the websocket, so put one HTTPS proxy in front of it. Set up on the VPS:

```sh
git clone https://github.com/n1kben/tag.git ~/projects/rooftop-fu
~/projects/rooftop-fu/deploy/update.sh   # pull, build, (re)start the systemd user service
```

Run `update.sh` again to ship new commits. Restarting ends matches in progress, and the service needs `loginctl enable-linger $USER` to survive logout.

For the proxy, pick one:

- **Public IP + Caddy** (or any HTTPS proxy): also open UDP port 40000 (`RTC_PORT`) in the firewall, and gameplay runs over UDP.
- **Tailscale Funnel**: `tailscale funnel --bg --https=10000 http://127.0.0.1:8080`. No open ports needed, but Funnel only carries TCP, so everyone plays over the WebSocket.

Press **P** in game: the netgraph's first word says `UDP` or `WS`.

## Code

- `src/shared/`: runs on both sides.
  - `map.ts`: rooftops, obstacles, line of sight, map size per player count. Roofs are all one height; obstacles are either low (always jumpable) or tall (go around).
  - `sim.ts`: the deterministic movement step, for server authority and client prediction.
  - `nav.ts`: bot routes. An edge exists only if the real movement sim makes that jump.
  - `wire.ts`: binary snapshots and input packets.
- `src/server/`: lobby and rooms (`room.ts`), the 60Hz match (`match.ts`), bots (`bots.ts`), UDP (`rtc.ts`).
- `src/client/`: scene (`world.ts`), characters (`characters.ts`), effects (`fx.ts`), DOM UI (`ui.ts`), input (`input.ts`, `pad.ts`, `touch.ts`), netcode (`netcode.ts`, `net.ts`), and `game.ts` wiring it together.

Movement and visuals were matched against Boomerang Fu trailer footage: about 7 body-widths/s, a short skid on release, about 0.5s in the air.

## Networking

The server is authoritative at 60Hz and sends snapshots at 30Hz.

- **Your player** is predicted. The server runs every input exactly once, in order, and acks it; the client replays unacked inputs on each snapshot. After 250ms with no input the server stands you still.
- **Other players** are drawn slightly in the past, between two snapshots. The delay adapts to the connection (about 60ms on a good line); a late snapshot extrapolates for up to 100ms.
- **Slashes are lag-compensated**: checked against where the target was on the attacker's screen, up to 200ms back, if the target is still within 1.2m of reach now.
- **Events play on your screen's clock**, so you die when the lunge reaches you, not before.
- **Transport**: snapshots are about 550 bytes for 13 players. Over UDP (a WebRTC data channel) snapshots come down it and inputs go up, each packet repeating the last 3 inputs. The WebSocket carries the lobby and events and is the fallback.
- **Options**: `?udp=0` forces the WebSocket. Server env: `PORT`, `HOST`, `RTC=off`, `RTC_PORT`, `RTC_STUN` (only behind NAT).

`scripts/net-bench.ts` results (6 clients + 2 bots, 6 deathmatches; hit% = slashes that touched on the attacker's screen and landed):

| profile (rtt, loss) | WebSocket: teleports/min, frozen, hit% | UDP |
|---|---|---|
| good (30ms) | 0.0, 0%, 96% | 0.0, 0%, 98% |
| typical (80ms ±12, 0.5%) | 0.1, 0.6%, 91% | 0.1, 0%, 98% |
| bad (150ms ±30, 2%) | 1.2, 1.9%, 20% | 0.4, 0%, 56% |

## Performance

- The static city is baked into merged meshes (about 120 draw calls) and the shadow map is drawn once; characters use blob shadows.
- Resolution starts at the screen's pixel density (max 2×), drops when frames pass 20ms and climbs back with headroom. MSAA is off on Retina screens.
- URL options: `?dpr=1` pins resolution, `?noaa` and `?noshadow` turn those off, `?lite` gives half resolution and no shadows.
- **P** shows fps, draw calls, triangles, resolution and JS vs render time.

## Scripts

Run with `npx tsx scripts/<name>.ts`. Scripts that take a URL need the dev servers running and use your installed Chrome via `playwright-core`.

Simulation checks, no browser:
- `check-map`: every map size is connected both ways, spawns are clear, low obstacles are jumpable.
- `check-slash`, `check-aim`, `check-jump`, `check-solid`, `check-refill`: slash reach and blocking, grenade aiming, jump and bunny-hop timing, heads/stomps/planks, grenade refill.
- `check-dm [n] [matches]`: Deathmatch swaps, team sizes and survival points.
- `check-inputs`, `check-codec`, `check-smooth`: server input handling, snapshot round-trip and size, smooth own-player drawing.
- `sim-match [n] [tag|dm]`: a full bots-only match in about 200ms.
- `balance [matches]`: Tag runner win rate per map size (bots favour taggers, so compare runs rather than reading it as absolute).
- `net-bench [profile|all] [seconds] [runs] [clients] [bots] [tcp|udp|both]`: real server and client netcode over a simulated network. Deterministic, about 5s per profile.
- `abuse [wsUrl]`: hostile messages; the server must survive.

In Chrome:
- `mp-e2e <url> <outDir>`, `dm-e2e <url> <outDir>`: two clients create, join, ready up and play Tag or Deathmatch.
- `check-udp`, `check-pad`, `check-touch`, `check-name-input`, `check-you-label <url>`: UDP data channel, gamepad, touch, lobby name input, YOU tag colour.
- `fps <url…>`: render fps, to compare builds.
- `shot`, `play-shots`, `juice-shots`, `jump-shots`: screenshots. `make-icons` renders the home-screen icons.
