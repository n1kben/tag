import { initScene, scene, camera, renderer } from './scene';
import { createArena } from './arena';
import { PlayerVisuals } from './player-visuals';
import { LocalPlayer } from './local-player';
import { RemotePlayer } from './remote-player';
import { Network } from './network';
import { LobbyUI } from './lobby-ui';
import { ARENA_WIDTH, COLOR_PLAYER1, COLOR_PLAYER2 } from '../shared/constants';
import type { ServerMessage } from '../shared/protocol';

type GameState = 'lobby' | 'countdown' | 'playing' | 'game_over';

export function startGame(): void {
  initScene();
  createArena(scene);

  const pressed = new Set<string>();
  window.addEventListener('keydown', (e) => pressed.add(e.code));
  window.addEventListener('keyup', (e) => pressed.delete(e.code));

  let gameState: GameState = 'lobby';
  let myPlayerId = -1;
  let localPlayer: LocalPlayer | null = null;
  let remotePlayer: RemotePlayer | null = null;
  let p1Name = '';
  let p2Name = '';

  const network = new Network(handleMessage);

  const lobby = new LobbyUI({
    onCreateRoom: (name) => {
      network.connect();
      // Wait for connection, then send
      const check = setInterval(() => {
        if (network.connected) {
          clearInterval(check);
          network.send({ type: 'create_room', name });
        }
      }, 100);
    },
    onJoinRoom: (roomId, name) => {
      if (!network.connected) {
        network.connect();
        const check = setInterval(() => {
          if (network.connected) {
            clearInterval(check);
            network.send({ type: 'join_room', roomId, name });
          }
        }, 100);
      } else {
        network.send({ type: 'join_room', roomId, name });
      }
    },
  });

  function handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_created':
        myPlayerId = msg.playerId;
        lobby.showRoomCode(msg.roomId);
        break;

      case 'room_joined':
        myPlayerId = msg.playerId;
        p1Name = myPlayerId === 0 ? 'You' : msg.opponent;
        p2Name = myPlayerId === 1 ? 'You' : msg.opponent;
        break;

      case 'opponent_joined':
        if (myPlayerId === 0) {
          p1Name = 'You';
          p2Name = msg.opponent;
        }
        break;

      case 'countdown':
        gameState = 'countdown';
        lobby.showCountdown(msg.seconds);
        if (msg.seconds <= 0) {
          gameState = 'playing';
          setupPlayers();
        }
        break;

      case 'state':
        if (!localPlayer || !remotePlayer) return;
        // Reconcile local player
        localPlayer.reconcile(msg.p[myPlayerId], msg.seq);

        // Push remote player state
        remotePlayer.pushState(msg.p[1 - myPlayerId]);

        // Update HUD
        lobby.showHUD(p1Name, p2Name, msg.it, msg.time, myPlayerId);
        break;

      case 'tag_event':
        if (localPlayer && msg.tagger === myPlayerId) {
          localPlayer.triggerTagEffect();
        }
        if (remotePlayer && msg.tagger !== myPlayerId) {
          remotePlayer.triggerTagEffect();
        }
        break;

      case 'game_over':
        gameState = 'game_over';
        const winnerName = msg.winner === myPlayerId ? 'You' : (myPlayerId === 0 ? p2Name : p1Name);
        lobby.showGameOver(winnerName, msg.stats);
        cleanupPlayers();
        break;

      case 'opponent_left':
        gameState = 'game_over';
        lobby.showOpponentLeft();
        cleanupPlayers();
        break;

      case 'error':
        lobby.setStatus(msg.msg);
        break;
    }
  }

  function setupPlayers(): void {
    cleanupPlayers();
    const spawnX = ARENA_WIDTH / 4;
    const colors = [COLOR_PLAYER1, COLOR_PLAYER2];

    const localVisuals = new PlayerVisuals(scene, colors[myPlayerId]);
    const remoteVisuals = new PlayerVisuals(scene, colors[1 - myPlayerId]);

    const localStartX = myPlayerId === 0 ? -spawnX : spawnX;
    const remoteStartX = myPlayerId === 0 ? spawnX : -spawnX;

    localPlayer = new LocalPlayer(localVisuals, network, pressed, localStartX, 0);
    remotePlayer = new RemotePlayer(remoteVisuals);

    // Set initial positions
    remoteVisuals.setPosition(remoteStartX, 0);
  }

  function cleanupPlayers(): void {
    localPlayer?.visuals.destroy();
    remotePlayer?.visuals.destroy();
    localPlayer = null;
    remotePlayer = null;
  }

  // Game loop
  let lastTime = 0;

  function loop(time: number): void {
    requestAnimationFrame(loop);

    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (dt <= 0) return;

    if (gameState === 'playing') {
      localPlayer?.update(dt);
      remotePlayer?.update(dt);
    }

    renderer.render(scene, camera);
  }

  requestAnimationFrame(loop);
}
