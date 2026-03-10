import { initScene, scene, camera, renderer } from './scene';
import { createArena } from './arena';
import { Player, WASD_KEYS, ARROW_KEYS } from './player';

export function startGame(): void {
  initScene();

  const walls = createArena(scene);

  const pressed = new Set<string>();

  const player = new Player(
    scene,
    WASD_KEYS,
    pressed,
    undefined,
    undefined,
    ARROW_KEYS,
  );

  // Input
  window.addEventListener('keydown', (e) => {
    pressed.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    pressed.delete(e.code);
  });

  // Game loop
  let lastTime = 0;

  function loop(time: number): void {
    requestAnimationFrame(loop);

    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    if (dt <= 0) return;

    player.update(dt, walls);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(loop);
}
