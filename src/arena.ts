import * as THREE from 'three';
import {
  ARENA_WIDTH, ARENA_HEIGHT, WALL_THICKNESS, WALL_HEIGHT,
  COLOR_WALLS, COLOR_BORDER, COLOR_GROUND,
} from './constants';

export function createArena(scene: THREE.Scene): THREE.Box3[] {
  const walls: THREE.Box3[] = [];
  const wallMat = new THREE.MeshStandardMaterial({ color: COLOR_WALLS });

  const halfW = ARENA_WIDTH / 2;
  const halfH = ARENA_HEIGHT / 2;
  const t = WALL_THICKNESS;

  // Ground
  const groundGeo = new THREE.PlaneGeometry(ARENA_WIDTH + 6, ARENA_HEIGHT + 6);
  const groundMat = new THREE.MeshStandardMaterial({ color: COLOR_GROUND });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  scene.add(ground);

  // Wall definitions: [width, height, depth, x, y, z]
  const wallDefs: [number, number, number, number, number, number][] = [
    // Top (negative Z)
    [ARENA_WIDTH + t * 2, WALL_HEIGHT, t, 0, WALL_HEIGHT / 2, -(halfH + t / 2)],
    // Bottom (positive Z)
    [ARENA_WIDTH + t * 2, WALL_HEIGHT, t, 0, WALL_HEIGHT / 2, halfH + t / 2],
    // Left
    [t, WALL_HEIGHT, ARENA_HEIGHT, -(halfW + t / 2), WALL_HEIGHT / 2, 0],
    // Right
    [t, WALL_HEIGHT, ARENA_HEIGHT, halfW + t / 2, WALL_HEIGHT / 2, 0],
  ];

  for (const [w, h, d, x, y, z] of wallDefs) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.position.set(x, y, z);
    scene.add(mesh);

    const box = new THREE.Box3().setFromObject(mesh);
    walls.push(box);
  }

  // Dashed border (yellow rectangle just outside walls)
  const bx = halfW + t + 0.1;
  const bz = halfH + t + 0.1;
  const borderPoints = [
    new THREE.Vector3(-bx, 0.01, -bz),
    new THREE.Vector3(bx, 0.01, -bz),
    new THREE.Vector3(bx, 0.01, bz),
    new THREE.Vector3(-bx, 0.01, bz),
  ];
  const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints);
  const borderMat = new THREE.LineDashedMaterial({
    color: COLOR_BORDER,
    dashSize: 0.5,
    gapSize: 0.3,
  });
  const border = new THREE.LineLoop(borderGeo, borderMat);
  border.computeLineDistances();
  scene.add(border);

  return walls;
}
