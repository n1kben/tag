import * as THREE from 'three';
import {
  ARENA_WIDTH, ARENA_HEIGHT,
  COLOR_GROUND,
} from '../shared/constants';

export function createArena(scene: THREE.Scene): void {
  // Ground
  const groundGeo = new THREE.PlaneGeometry(ARENA_WIDTH * 10, ARENA_HEIGHT * 10);
  const groundMat = new THREE.MeshStandardMaterial({ color: COLOR_GROUND });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);
}
