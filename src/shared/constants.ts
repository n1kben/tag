// World units: 1 unit ≈ 40 CS units (player is 0.8 wide, CS player is 32).
// Movement numbers are CS 1.6 values scaled by that ratio, then nudged for Boomerang Fu slide.

// Simulation
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // ticks → 30Hz snapshots

// Player body
export const PLAYER_RADIUS = 0.4;
export const EYE_HEIGHT = 0.9;
export const STEP_HEIGHT = 0.35;

// Movement (CS: 250u/s run, 800 gravity, 268 jump → scaled)
export const RUN_SPEED = 6.8;
export const GROUND_RESPONSE = 11; // how fast velocity chases the stick on ground (lower = slidier)
export const AIR_RESPONSE = 2.2;
export const GRAVITY = 20;
export const JUMP_VELOCITY = 6.8; // ≈1.16 units high, ≈4 units long at run speed
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;

// Bunny hop: jump within the window after landing keeps speed and grows the cap
export const BHOP_WINDOW = 0.12;
export const BHOP_GAIN = 1.07;
export const BHOP_MAX = 1.35;

// Falling (CS: safe below 500u/s, fatal at ~1100u/s)
export const SAFE_FALL_SPEED = 12.5;
export const FATAL_FALL_SPEED = 24.5;
export const KILL_Y = -6;

// Health (CS 100hp; armor folded in so a front stab takes two hits)
export const MAX_HP = 100;

// Seeker knife
export const STAB_RANGE = 1.45;
export const STAB_ARC_COS = 0.45; // ~63° half angle
export const STAB_DAMAGE = 55;
export const BACKSTAB_DAMAGE = 200;
export const BACKSTAB_MAX_SPEED = 2.5; // victim slower than this counts as caught off guard
export const STAB_COOLDOWN = 0.8;
export const LUNGE_SPEED = 11;
export const LUNGE_TIME = 0.14;

// Boomerang (seeker comeback weapon, unlocked after NUBSLASH_LOSSES lost rounds in a row)
export const NUBSLASH_LOSSES = 3;
export const RANG_SPEED = 17;
export const RANG_OUT_TIME = 0.45;
export const RANG_RADIUS = 0.45;
export const RANG_DAMAGE = 100;

// Grenades (hider kit: 2 flash, 1 frost, 1 smoke, 1 boom)
export type NadeKind = 'flash' | 'frost' | 'smoke' | 'boom';
export const NADE_KINDS: NadeKind[] = ['flash', 'frost', 'smoke', 'boom'];
export const NADE_LOADOUT: Record<NadeKind, number> = { flash: 2, frost: 1, smoke: 1, boom: 1 };
export const NADE_FUSE: Record<NadeKind, number> = { flash: 1.2, frost: 1.4, smoke: 1.2, boom: 1.4 };
export const NADE_THROW_SPEED = 9.5;
export const NADE_THROW_UP = 5.5;
export const NADE_MIN_CHARGE = 0.45; // fraction of full throw on a tap
export const NADE_CHARGE_TIME = 0.6;
export const AIM_SPEED = 0.4; // move speed multiplier while charging a throw
export const NADE_RADIUS = 0.18;
export const FROST_RADIUS = 3.6;
export const FROST_TIME = 4;
export const CHILL_RADIUS = 6;
export const CHILL_TIME = 7;
export const CHILL_SPEED = 0.6;
export const FLASH_RADIUS = 13;
export const FLASH_TIME = 3.2;
export const SMOKE_RADIUS = 3.4;
export const SMOKE_TIME = 14;
export const BOOM_RADIUS = 3.8;
export const BOOM_KNOCK = 15;
export const BOOM_DAMAGE = 20;

// Visibility for seekers (hiders always see everyone)
export const VIEW_RANGE = 19;
export const BUSH_REVEAL_RANGE = 2.2;

// Round flow (hnsmod defaults)
export const HIDE_TIME = 10;
export const ROUND_TIME = 120;
export const ROUND_END_TIME = 5;
export const ROUNDS_PER_MATCH = 8;
export const MAX_PLAYERS = 10;

// Palette (sampled from Boomerang Fu trailer frames + COLORS.csv team accents)
export const COLOR_HIDER = 0x23f0c7;
export const COLOR_SEEKER = 0xef767a;
export const COLOR_ACCENT = 0xffe347;

// Food roster (visuals live in client/characters.ts, keyed by index)
export const CHARACTERS = ['Milk', 'Melon', 'Carrot', 'Eggplant', 'Banana', 'Donut', 'Avocado', 'Sushi', 'Coffee', 'Popsicle'];
