import { initScene, scene, camera, renderer } from './scene';
import { createArena } from './arena';
import { PlayerVisuals } from './player-visuals';
import { LocalPlayer } from './local-player';
import { RemotePlayer } from './remote-player';
import { Network } from './network';
import { LobbyUI } from './lobby-ui';
import { ARENA_WIDTH, COLOR_PLAYER1, COLOR_PLAYER2 } from '../shared/constants';
import type { ServerMessage } from '../shared/protocol';

type GameState = 'title' | 'lobby' | 'countdown' | 'playing';

export function startGame(): void {
  initScene();
  createArena(scene);

  const pressed = new Set<string>();
  window.addEventListener('keydown', (e) => pressed.add(e.code));
  window.addEventListener('keyup', (e) => pressed.delete(e.code));

  let gameState: GameState = 'title';
  let myPlayerId = -1;
  let myName = '';
  let roomId = '';
  let localPlayer: LocalPlayer | null = null;
  let remotePlayer: RemotePlayer | null = null;
  let p1Name = '';
  let p2Name = '';

  const network = new Network(handleMessage);

  const lobby = new LobbyUI({
    onCreateRoom: () => {
      network.connect();
      const check = setInterval(() => {
        if (network.connected) {
          clearInterval(check);
          network.send({ type: 'create_room' });
        }
      }, 100);
    },
    onJoinRoom: (code) => {
      if (!network.connected) {
        network.connect();
        const check = setInterval(() => {
          if (network.connected) {
            clearInterval(check);
            network.send({ type: 'join_room', roomId: code });
          }
        }, 100);
      } else {
        network.send({ type: 'join_room', roomId: code });
      }
    },
    onRename: (name) => {
      network.send({ type: 'rename', name });
    },
    onReady: () => {
      network.send({ type: 'ready' });
    },
    onLeave: () => {
      network.send({ type: 'leave' });
      network.disconnect();
      gameState = 'title';
      myPlayerId = -1;
      lobby.showTitle();
    },
  });

  function handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_created':
        myPlayerId = msg.playerId;
        myName = msg.name;
        roomId = msg.roomId;
        gameState = 'lobby';
        lobby.showRoomLobby(msg.roomId, msg.name);
        break;

      case 'room_joined':
        myPlayerId = msg.playerId;
        myName = msg.name;
        roomId = msg.roomId;
        gameState = 'lobby';
        lobby.showRoomLobby(msg.roomId, msg.name);
        break;

      case 'lobby_state':
        if (gameState === 'playing' || gameState === 'countdown') {
          // Game just ended, transition back to lobby
          gameState = 'lobby';
          cleanupPlayers();
          lobby.showRoomLobby(roomId, myName);
        }
        // Update player names from lobby state
        if (msg.players[0]) p1Name = msg.players[0].name;
        if (msg.players[1]) p2Name = msg.players[1].name;
        // Update my name in case server had it
        if (msg.players[myPlayerId]) {
          myName = msg.players[myPlayerId]!.name;
        }
        lobby.updateLobbyState(
          msg.players,
          myPlayerId,
          msg.lastResult,
        );
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
        localPlayer.reconcile(msg.p[myPlayerId], msg.seq);
        localPlayer.setRemoteState(msg.p[1 - myPlayerId]);
        localPlayer.setIsIt(msg.it === myPlayerId);
        remotePlayer.pushState(msg.p[1 - myPlayerId]);
        lobby.showHUD(p1Name, p2Name, msg.it, msg.time, myPlayerId);
        break;

      case 'tag_attempt':
        if (remotePlayer && msg.player !== myPlayerId) {
          remotePlayer.triggerTagEffect();
        }
        break;

      case 'tag_event':
        break;

      case 'game_over':
        // Don't transition yet — lobby_state will arrive next and handle it
        lobby.hideHUD();
        break;

      case 'opponent_left':
        if (gameState === 'playing' || gameState === 'countdown') {
          cleanupPlayers();
        }
        gameState = 'lobby';
        lobby.hideHUD();
        lobby.showRoomLobby(roomId, myName);
        lobby.setLobbyMsg('Opponent left the room');
        break;

      case 'error':
        lobby.setTitleStatus(msg.msg);
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

    remoteVisuals.setPosition(remoteStartX, 0);
  }

  function cleanupPlayers(): void {
    localPlayer?.visuals.destroy();
    remotePlayer?.visuals.destroy();
    localPlayer = null;
    remotePlayer = null;
  }

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
