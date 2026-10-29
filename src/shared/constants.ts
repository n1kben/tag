// World units: the player is 0.8 wide. Movement is tuned against Boomerang Fu trailer footage
// (≈6 body-widths/s run, instant start, short slide on stop) with a snappy, readable jump.

// Simulation
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // ticks → 30Hz snapshots

// Player body
export const PLAYER_RADIUS = 0.4;
export const EYE_HEIGHT = 0.9;
export const STEP_HEIGHT = 0.35;

// Running: quick to full speed, a short Boomerang Fu slide when you let go
export const RUN_SPEED = 6.0; // ≈7.5 body-widths/s
export const GROUND_ACCEL = 18; // how fast velocity reaches the stick target (1/s)
export const GROUND_DECEL = 9; // lower = longer slide when releasing the stick
export const AIR_CONTROL = 9; // nearly full steering mid-air so you can line up crates

// Jumping: fast rise, heavier fall, tap for a hop / hold for full height
export const GRAVITY = 34; // while rising
export const FALL_GRAVITY = 52; // while falling
export const JUMP_HEIGHT = 1.45; // full-hold apex: clears a 1-unit ledge with room to spare
export const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
export const JUMP_CUT = 0.45; // releasing Space while rising keeps this much upward speed
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;

// Bunny hop (CS HNS skill): jump right on landing to keep speed and grow it a little
export const BHOP_WINDOW = 0.12;
export const BHOP_GAIN = 1.06;
export const BHOP_MAX = 1.25;

// Falling: drops up to SAFE_DROP are free; damage scales up to death at FATAL_DROP
export const SAFE_DROP = 3.5;
export const FATAL_DROP = 9;
export const SAFE_FALL_SPEED = Math.sqrt(2 * FALL_GRAVITY * SAFE_DROP);
export const FATAL_FALL_SPEED = Math.sqrt(2 * FALL_GRAVITY * FATAL_DROP);
export const KILL_Y = -6;

// Health (CS 100hp; armor folded in so a front stab takes two hits)
export const MAX_HP = 100;

// Seeker slash
export const STAB_RANGE = 0.1; // gap between bodies: you have to be practically touching
export const STAB_ARC_COS = 0.45; // ~63° half angle
export const STAB_DAMAGE = 55;
export const BACKSTAB_DAMAGE = 200;
export const BACKSTAB_MAX_SPEED = 2.5; // victim slower than this counts as caught off guard
export const STAB_COOLDOWN = 0.8;
export const LUNGE_SPEED = 5; // a small committed step-in, not a long reach
export const LUNGE_TIME = 0.06;
export const STAB_HEIGHT = 0.4; // the blade's line: anything taller in between (even a low wall) blocks it

// ── Grenades: hider kit, tune here ────────────────────────────────────────
// Flash a seeker right before they jump; frost them mid-air so they drop into the mist.
export type NadeKind = 'flash' | 'frost';
export const NADE_KINDS: NadeKind[] = ['flash', 'frost'];
export const NADE_LOADOUT: Record<NadeKind, number> = { flash: 2, frost: 1 }; // per round
export const NADE_FUSE: Record<NadeKind, number> = { flash: 1.2, frost: 1.4 }; // seconds
export const NADE_THROW_SPEED = 9.5;
export const NADE_THROW_UP = 5.5;
export const NADE_GRAVITY = 20;
export const NADE_MIN_CHARGE = 0.45; // fraction of a full throw on a tap
export const NADE_CHARGE_TIME = 0.6; // hold this long for a full throw
export const AIM_SPEED = 0.4; // move speed multiplier while charging a throw
export const NADE_RADIUS = 0.18;
export const FLASH_RADIUS = 13; // seekers in line of sight within this get blinded
export const FLASH_TIME = 3.2; // max blind seconds (less at range)
export const FROST_RADIUS = 3.6; // seekers inside are frozen solid (mid-air: they drop straight down)
export const FROST_TIME = 4;
export const CHILL_RADIUS = 6; // seekers inside are slowed
export const CHILL_TIME = 7;
export const CHILL_SPEED = 0.6;

// Deathmatch (CS "HNS deathmatch"): same teams and kit as Hide 'n Seek, no rounds.
// Catch a hider and you swap: you become a hider, they respawn as a seeker.
export const DM_TIME = 180;
export const RESPAWN_TIME = 2;
export const SPAWN_PROTECTION = 1.5; // can't be hurt right after (re)spawning
export const SWAP_PROTECTION = 1; // grace for a seeker who just became a hider
export const SURVIVE_POINT_EVERY = 15; // hiders score a point for every this-many seconds alive

// Round flow (hnsmod defaults)
export const HIDE_TIME = 10;
export const ROUND_TIME = 120; // on the full city; smaller maps get shorter rounds
export const MIN_ROUND_TIME = 70; // on the smallest (5-roof) map
export const ROUND_END_TIME = 5;
export const ROUNDS_PER_MATCH = 8;
export const MAX_PLAYERS = 10;

// Palette (sampled from Boomerang Fu trailer frames + COLORS.csv team accents)
export const COLOR_HIDER = 0x23f0c7;
export const COLOR_SEEKER = 0xef767a;
export const COLOR_ACCENT = 0xffe347;

// Food roster (visuals live in client/characters.ts, keyed by index)
export const CHARACTERS = ['Milk', 'Melon', 'Carrot', 'Eggplant', 'Banana', 'Donut', 'Avocado', 'Sushi', 'Coffee', 'Popsicle'];
