import { TICK_RATE, BROADCAST_RATE, GAME_DURATION, TAG_COOLDOWN, TAG_IMMUNITY_DURATION } from '../shared/constants';
import { stepPhysics, resolvePlayerCollision } from '../shared/physics';
import { StateMsg, TagAttemptMsg, TagEventMsg, GameOverMsg } from '../shared/protocol';
import { ServerPlayer } from './player-sim';
import { checkTagHit } from './tag-detection';
import { recordMatch } from './db';
import type { Room } from './room';

const TICK_MS = 1000 / TICK_RATE;
const BROADCAST_INTERVAL = TICK_RATE / BROADCAST_RATE; // every N ticks

export class GameLoop {
  private room: Room;
  private players: [ServerPlayer, ServerPlayer];
  private tick = 0;
  private timeRemaining: number = GAME_DURATION;
  private itPlayer = 0; // index of who's "it"
  private interval: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private startTimeMs = 0;

  constructor(room: Room, players: [ServerPlayer, ServerPlayer]) {
    this.room = room;
    this.players = players;
  }

  start(): void {
    this.startTimeMs = Date.now();
    this.lastTime = performance.now();
    this.itPlayer = Math.random() < 0.5 ? 0 : 1;
    this.timeRemaining = GAME_DURATION;
    this.tick = 0;

    this.interval = setInterval(() => this.frame(), 1);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private frame(): void {
    const now = performance.now();
    const elapsed = now - this.lastTime;
    this.lastTime = now;
    this.accumulator += elapsed;

    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.tickUpdate(TICK_MS / 1000);
    }
  }

  private tickUpdate(dt: number): void {
    this.tick++;
    this.timeRemaining -= dt;

    // Process queued inputs for each player
    for (let i = 0; i < 2; i++) {
      const player = this.players[i];
      let input = { dx: 0, dz: 0, tag: false };

      // Process all queued inputs up to this tick
      while (player.inputQueue.length > 0) {
        const queued = player.inputQueue.shift()!;
        player.lastProcessedSeq = queued.seq;
        input = queued.input;
      }

      // Update cooldowns
      if (player.tagCooldown > 0) player.tagCooldown -= dt;
      if (player.immunityTimer > 0) player.immunityTimer -= dt;

      // Tag — only the "it" player can attempt
      if (input.tag && player.tagCooldown <= 0 && i === this.itPlayer) {
        player.tagCooldown = TAG_COOLDOWN;
        const attempt: TagAttemptMsg = { type: 'tag_attempt', player: i };
        this.room.broadcast(attempt);

        const opponent = this.players[1 - i];
        if (opponent.immunityTimer <= 0 && checkTagHit(player, opponent)) {
          this.itPlayer = 1 - i;
          opponent.immunityTimer = TAG_IMMUNITY_DURATION;
          const tagEvent: TagEventMsg = { type: 'tag_event', tagger: i, tagged: 1 - i };
          this.room.broadcast(tagEvent);
        }
      }

      // Run physics
      stepPhysics(player.state, input, dt);

      // Track survival time (time NOT being "it")
      if (i !== this.itPlayer) {
        player.survivalTimeMs += dt * 1000;
      }
    }

    // Resolve player-player collision after both have moved
    resolvePlayerCollision(this.players[0].state, this.players[1].state);

    // Check game over
    if (this.timeRemaining <= 0) {
      this.timeRemaining = 0;
      this.endGame();
      return;
    }

    // Broadcast state at BROADCAST_RATE
    if (this.tick % BROADCAST_INTERVAL === 0) {
      this.broadcastState();
    }
  }

  private broadcastState(): void {
    for (let i = 0; i < 2; i++) {
      const msg: StateMsg = {
        type: 'state',
        tick: this.tick,
        time: this.timeRemaining,
        it: this.itPlayer,
        p: [
          { ...this.players[0].state },
          { ...this.players[1].state },
        ],
        seq: this.players[i].lastProcessedSeq,
      };
      this.room.sendTo(i, msg);
    }
  }

  private endGame(): void {
    this.stop();

    // Player who is "it" at the end loses — the other player wins
    const winner = 1 - this.itPlayer;
    const durationMs = Date.now() - this.startTimeMs;

    const msg: GameOverMsg = {
      type: 'game_over',
      winner,
      stats: {
        player1Name: this.players[0].name,
        player2Name: this.players[1].name,
        player1SurvivalMs: Math.round(this.players[0].survivalTimeMs),
        player2SurvivalMs: Math.round(this.players[1].survivalTimeMs),
        durationMs,
      },
    };
    this.room.broadcast(msg);

    // Record to database
    try {
      recordMatch(
        this.room.id,
        this.players[0].name,
        this.players[1].name,
        this.players[winner].name,
        durationMs,
        Math.round(this.players[0].survivalTimeMs),
        Math.round(this.players[1].survivalTimeMs),
      );
    } catch (e) {
      console.error('Failed to record match:', e);
    }

    this.room.onGameOver({
      winnerIdx: winner,
      stats: msg.stats,
    });
  }
}
