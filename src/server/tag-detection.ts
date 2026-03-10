import { PLAYER_SIZE } from '../shared/constants';
import { ServerPlayer } from './player-sim';

/**
 * Check if tagger's forward hitbox overlaps the target.
 * Forward hitbox: PLAYER_SIZE * 1.2 ahead, PLAYER_SIZE * 0.8 wide.
 */
export function checkTagHit(tagger: ServerPlayer, target: ServerPlayer): boolean {
  const s = tagger.state;
  const t = target.state;

  // Forward direction from facing angle
  const fwdX = -Math.sin(s.facingAngle);
  const fwdZ = -Math.cos(s.facingAngle);

  // Hitbox center is ahead of tagger
  const hitboxCenterX = s.x + fwdX * PLAYER_SIZE * 0.6;
  const hitboxCenterZ = s.z + fwdZ * PLAYER_SIZE * 0.6;

  const hitboxW = PLAYER_SIZE * 0.8;
  const hitboxD = PLAYER_SIZE * 1.2;

  // Right direction (perpendicular to forward)
  const rightX = -fwdZ;
  const rightZ = fwdX;

  // Vector from hitbox center to target
  const toTargetX = t.x - hitboxCenterX;
  const toTargetZ = t.z - hitboxCenterZ;

  // Project onto forward and right axes (OBB vs circle approximation)
  const projFwd = toTargetX * fwdX + toTargetZ * fwdZ;
  const projRight = toTargetX * rightX + toTargetZ * rightZ;

  const targetRadius = PLAYER_SIZE / 2;

  return (
    Math.abs(projFwd) < hitboxD / 2 + targetRadius &&
    Math.abs(projRight) < hitboxW / 2 + targetRadius
  );
}
