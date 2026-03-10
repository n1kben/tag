import * as THREE from 'three';
import {
  ARENA_WIDTH, ARENA_HEIGHT, CAMERA_FOV, CAMERA_TILT_DEG, CAMERA_PADDING,
} from './constants';

export let scene: THREE.Scene;
export let camera: THREE.PerspectiveCamera;
export let renderer: THREE.WebGLRenderer;

export function initScene(): void {
  scene = new THREE.Scene();

  // Camera
  const aspect = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 200);

  const tiltRad = THREE.MathUtils.degToRad(CAMERA_TILT_DEG);
  const halfFovRad = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
  const arenaHalfH = ARENA_HEIGHT / 2 + CAMERA_PADDING;
  const cameraHeight = arenaHalfH / Math.tan(halfFovRad);

  camera.position.set(0, cameraHeight, cameraHeight * Math.sin(tiltRad));
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  scene.add(directional);

  // Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
