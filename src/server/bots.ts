// Server-side bots so a room is fun (and testable) with any number of humans.
// They drive the same Input as players, so they obey the same physics and rules.
import { buildingAt, heightAt } from '../shared/map';
import { ROOF_NODES, navNodeAt, navNextEdge, openSpot, steerTo, type NavEdge, type NavNode } from '../shared/nav';
import { BTN_ACTION, BTN_ALT, type Body, type Input } from '../shared/sim';
import { STAB_RANGE, TICK_DT, type NadeKind } from '../shared/constants';
import type { Match, MPlayer } from './match';

type Goal = { x: number; z: number; node: number };

export class Brain {
  private goal: Goal | null = null;
  private edge: NavEdge | null = null;
  private edgeFrom = -1;
  private leaping = false;
  private stuckT = 0;
  private idleT = 0;
  private aimTicks = 0;
  private nadeCd = 2;
  private lastSeen: { x: number; z: number; y: number; t: number } | null = null;
  private think_t = 0;
  private altToggle = false;
  private walkX = 0;
  private walkZ = 0;

  reset(): void {
    this.goal = null;
    this.edge = null;
    this.leaping = false;
    this.stuckT = 0;
    this.idleT = 0;
    this.aimTicks = 0;
    this.nadeCd = 2 + Math.random() * 3;
    this.lastSeen = null;
  }

  think(m: Match, me: MPlayer): Input {
    this.think_t += TICK_DT;
    this.nadeCd -= TICK_DT;
    return me.role === 'hider' ? this.hider(m, me) : this.seeker(m, me);
  }

  // ── Hider: keep distance, run when a seeker closes in, nade the chaser ───
  private hider(m: Match, me: MPlayer): Input {
    const b = me.body;
    const threats = m.players.filter(p => p.alive && p.connected && p.role === 'seeker' && m.phase === 'seek');
    const near = threats
      .map(t => ({ t, d: Math.hypot(t.body.x - b.x, t.body.z - b.z) }))
      .sort((a, c) => a.d - c.d)[0];
    const spotted = !!near && near.d < 10; // a seeker is closing in

    // Finish a grenade wind-up (hold ACTION for a few ticks, then release)
    if (this.aimTicks > 0) {
      this.aimTicks--;
      const t = near?.t;
      const dir = t ? norm(t.body.x - b.x, t.body.z - b.z) : [Math.sin(b.facing), Math.cos(b.facing)];
      return { mx: dir[0] * 0.3, mz: dir[1] * 0.3, b: this.aimTicks > 0 ? BTN_ACTION : 0 };
    }

    if (spotted && near && near.d < 9 && this.nadeCd <= 0 && totalNades(me) > 0) {
      // Frost the gap they have to jump (it pops while they're in the air);
      // flash a chaser who's about to reach us on the same roof
      const gap = gapBetween(near.t.body, b);
      const want: NadeKind | null = gap && me.nades.frost > 0 ? 'frost' : near.d < 6 && me.nades.flash > 0 ? 'flash' : null;
      if (want) {
        if (me.nadeSel !== want) {
          // Cycling needs press/release, so tap ALT every other tick
          this.altToggle = !this.altToggle;
          return { mx: 0, mz: 0, b: this.altToggle ? BTN_ALT : 0 };
        }
        this.nadeCd = 3 + Math.random() * 3;
        const dist = want === 'frost' && gap ? Math.hypot(gap.x - b.x, gap.z - b.z) : near.d;
        this.aimTicks = Math.round(8 + Math.min(1, dist / 9) * 25);
        return { mx: 0, mz: 0, b: BTN_ACTION };
      }
    }

    if (spotted && near && near.d < 10 && (!this.goal || this.distToGoal(b.x, b.z) < 3 || this.idleT > 0)) {
      // Flee: pick a roof that puts distance between us and the seeker
      this.goal = this.fleeGoal(b.x, b.z, near.t.body.x, near.t.body.z);
      this.idleT = 0;
    }

    if (!this.goal) this.goal = this.hideGoal(b.x, b.z);
    const input = this.navigate(me, this.goal);
    if (input.mx === 0 && input.mz === 0) {
      this.idleT += TICK_DT;
      // Stay put in the bush; occasionally relocate
      if (this.idleT > 25 + Math.random() * 20) { this.goal = this.hideGoal(b.x, b.z); this.idleT = 0; }
    }
    return input;
  }

  private hideGoal(x: number, z: number): Goal {
    // Somewhere far from the plaza spawn, not too far from here
    const n = [...ROOF_NODES]
      .map(r => ({ r, score: Math.hypot(r.cx, r.cz + 3) + Math.random() * 14 - Math.hypot(r.cx - x, r.cz - z) * 0.2 }))
      .sort((a, c) => c.score - a.score)[0].r;
    return spotOn(n);
  }

  private fleeGoal(x: number, z: number, sx: number, sz: number): Goal {
    const here = navNodeAt(x, z, 99);
    let best: Goal | null = null, bestScore = -Infinity;
    for (const n of ROOF_NODES) {
      if (here && n.id === here.id) continue;
      const score = Math.hypot(n.cx - sx, n.cz - sz) - Math.hypot(n.cx - x, n.cz - z) * 0.6 + Math.random() * 4;
      if (score > bestScore) { bestScore = score; best = spotOn(n); }
    }
    return best ?? this.hideGoal(x, z);
  }

  // ── Seeker: chase the nearest hider (it's tag: everyone is visible) ──────
  private seeker(m: Match, me: MPlayer): Input {
    const b = me.body;
    if (m.phase !== 'seek') return { mx: 0, mz: 0, b: 0 };
    // Flashed: a human sees a white screen, so a bot loses track and stumbles to a halt
    if (me.blind > 0.6) { this.goal = null; this.leaping = false; return { mx: 0, mz: 0, b: 0 }; }

    const visible = m.players
      .filter(p => p.alive && p.connected && p.role === 'hider' && !p.prot)
      .map(t => ({ t, d: Math.hypot(t.body.x - b.x, t.body.z - b.z) }))
      .sort((a, c) => a.d - c.d);
    const target = visible[0];

    if (target) {
      const t = target.t.body;
      this.lastSeen = { x: t.x, z: t.z, y: t.y, t: this.think_t };
      // In knife range and level with them: face and stab (lead the target a little)
      if (target.d < STAB_RANGE + 0.5 && Math.abs(t.y - b.y) < 1) {
        const [dx, dz] = norm(t.x + t.vx * 0.08 - b.x, t.z + t.vz * 0.08 - b.z);
        const facingOk = Math.cos(Math.atan2(dx, dz) - b.facing) > 0.8;
        return { mx: dx, mz: dz, b: facingOk && b.attackCd <= 0 ? BTN_ACTION : 0 };
      }
      const node = navNodeAt(t.x, t.z, t.y + 0.1);
      if (node) this.goal = { x: t.x, z: t.z, node: node.id };
    } else if (this.lastSeen && this.think_t - this.lastSeen.t < 6) {
      const node = navNodeAt(this.lastSeen.x, this.lastSeen.z, this.lastSeen.y + 0.1);
      if (node && (!this.goal || this.goal.node !== node.id)) this.goal = { x: this.lastSeen.x, z: this.lastSeen.z, node: node.id };
      if (this.distToGoal(b.x, b.z) < 1) this.lastSeen = null;
    }

    if (!this.goal || this.distToGoal(b.x, b.z) < 0.8 || this.stuckT > 2.5) {
      this.stuckT = 0;
      // Sweep: random bush (where hiders like to be) or random roof
      if (!this.goal || this.distToGoal(b.x, b.z) < 0.8) {
        const n = ROOF_NODES[Math.floor(Math.random() * ROOF_NODES.length)];
        this.goal = spotOn(n);
      }
    }
    return this.navigate(me, this.goal);
  }

  // ── Shared navigation ────────────────────────────────────────────────────
  private distToGoal(x: number, z: number): number {
    return this.goal ? Math.hypot(this.goal.x - x, this.goal.z - z) : Infinity;
  }

  private navigate(me: MPlayer, goal: Goal): Input {
    const b = me.body;
    const speed = Math.hypot(b.vx, b.vz);

    // Mid-leap: keep committing to the landing spot
    if (this.leaping && this.edge) {
      if (b.grounded && navNodeAt(b.x, b.z, b.y)?.id !== this.edgeFrom) {
        this.leaping = false;
        this.edge = null;
      } else if (b.grounded && speed < 0.3) {
        this.leaping = false; // bailed on the edge
        this.edge = null;
      } else {
        return steerTo(b, this.edge.tx, this.edge.tz);
      }
    }
    // Airborne from a hop: keep heading where we were walking, not at some far roof
    if (!b.grounded) return steerTo(b, this.walkX, this.walkZ, 1, false);

    const here = navNodeAt(b.x, b.z, b.y);
    if (!here) return this.walk(b, goal.x, goal.z, speed);

    if (here.id === goal.node || (buildingAt(goal.x, goal.z) && navNodeAt(goal.x, goal.z, 99)?.id === here.id)) {
      const d = Math.hypot(goal.x - b.x, goal.z - b.z);
      if (d < 0.5) return { mx: 0, mz: 0, b: 0 };
      return this.walk(b, goal.x, goal.z, speed, d < 1.5 ? 0.6 : 1);
    }

    const edge = navNextEdge(here.id, goal.node);
    // No route (e.g. goal is a crate we can't path to): just walk toward it
    if (!edge) return this.walk(b, goal.x, goal.z, speed);
    this.edge = edge;
    this.edgeFrom = here.id;
    if (Math.hypot(edge.rx - b.x, edge.rz - b.z) > 0.3) return this.walk(b, edge.rx, edge.rz, speed);
    // Edges are validated at full speed; a chilled or frozen bot waits at the run-up
    if (me.chilled > 0 || me.frozen > 0) return { mx: 0, mz: 0, b: 0 };
    this.leaping = true;
    return steerTo(b, edge.tx, edge.tz);
  }

  private walk(b: Body, x: number, z: number, speed: number, run = 1): Input {
    this.walkX = x;
    this.walkZ = z;
    return this.unstick(b, speed, steerTo(b, x, z, run, false));
  }

  private unstick(b: Body, speed: number, input: Input): Input {
    if ((input.mx || input.mz) && speed < 0.8) this.stuckT += TICK_DT; else this.stuckT = Math.max(0, this.stuckT - TICK_DT);
    if (this.stuckT > 0.6) {
      // Wiggle sideways around the obstacle, but never off a ledge
      const side = Math.sin(this.think_t * 3) > 0 ? 1 : -1;
      const mx = input.mx * 0.3 - input.mz * side, mz = input.mz * 0.3 + input.mx * side;
      if (heightAt(b.x + mx * 0.7, b.z + mz * 0.7) < b.y - 0.3) return { mx: 0, mz: 0, b: 0 };
      return { mx, mz, b: input.b };
    }
    return input;
  }
}

function spotOn(n: NavNode): Goal {
  const { x, z } = openSpot(n);
  return { x, z, node: n.id };
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

function totalNades(p: MPlayer): number {
  return p.nades.flash + p.nades.frost;
}

/** First drop between two players (where a chaser has to jump), if any. */
function gapBetween(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { x: number; z: number } | null {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const floor = Math.min(from.y, to.y) - 0.5;
  for (let s = 0.5; s < d; s += 0.4) {
    const x = from.x + ((to.x - from.x) * s) / d, z = from.z + ((to.z - from.z) * s) / d;
    if (heightAt(x, z) < floor) return { x, z };
  }
  return null;
}

