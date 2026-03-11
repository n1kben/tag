import type { LobbyPlayer } from '../shared/protocol';

export interface LobbyCallbacks {
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onRename: (name: string) => void;
  onReady: () => void;
  onLeave: () => void;
}

export class LobbyUI {
  private titleScreen: HTMLDivElement;
  private roomLobby: HTMLDivElement;
  private countdownDiv: HTMLDivElement;
  private hudDiv: HTMLDivElement;
  private callbacks: LobbyCallbacks;
  private statusDiv: HTMLDivElement;

  constructor(callbacks: LobbyCallbacks) {
    this.callbacks = callbacks;

    // ── Title screen ──
    this.titleScreen = document.createElement('div');
    this.titleScreen.id = 'title-screen';
    this.titleScreen.innerHTML = `
      <div style="
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        background: rgba(26, 26, 46, 0.95);
        font-family: 'Segoe UI', sans-serif; color: white;
        z-index: 100;
      ">
        <h1 style="font-size: 3em; margin-bottom: 0.3em; color: #23f0c7;">TAG!</h1>
        <p style="color: #aaa; margin-bottom: 2em;">Online Multiplayer</p>

        <button id="title-create" style="
          padding: 0.8em 2em; font-size: 1.1em; font-weight: bold;
          background: #23f0c7; color: #1a1a2e; border: none; border-radius: 8px;
          cursor: pointer; margin-bottom: 1.5em; min-width: 220px;
        ">Create Game</button>

        <div style="display: flex; gap: 0.5em; align-items: center;">
          <input id="title-code" type="text" maxlength="6" placeholder="ROOM CODE"
            style="padding: 0.6em 1em; font-size: 1.1em; border: 2px solid #6457a6;
            background: #2a2a4a; color: white; border-radius: 8px; width: 150px;
            text-align: center; text-transform: uppercase; letter-spacing: 2px;" />
          <button id="title-join" style="
            padding: 0.8em 1.5em; font-size: 1.1em; font-weight: bold;
            background: #ff6b9d; color: white; border: none; border-radius: 8px;
            cursor: pointer;
          ">Join</button>
        </div>

        <div id="title-status" style="margin-top: 1.5em; color: #ffe347; min-height: 1.5em;"></div>
      </div>
    `;
    document.body.appendChild(this.titleScreen);
    this.statusDiv = this.titleScreen.querySelector('#title-status')!;

    // ── Room lobby ──
    this.roomLobby = document.createElement('div');
    this.roomLobby.id = 'room-lobby';
    this.roomLobby.style.display = 'none';
    this.roomLobby.innerHTML = `
      <div style="
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        background: rgba(26, 26, 46, 0.95);
        font-family: 'Segoe UI', sans-serif; color: white;
        z-index: 100;
      ">
        <h2 style="color: #23f0c7; margin-bottom: 0.3em;">Room</h2>
        <p id="lobby-room-code" style="
          font-size: 2em; font-weight: bold; letter-spacing: 4px;
          color: #ffe347; margin-bottom: 1.5em;
        "></p>

        <div id="lobby-last-result" style="
          margin-bottom: 1.5em; text-align: center; display: none;
        "></div>

        <div style="
          display: flex; gap: 2em; margin-bottom: 2em;
          align-items: stretch;
        ">
          <!-- Player 1 card -->
          <div id="lobby-p0" style="
            background: #2a2a4a; border: 2px solid #6457a6; border-radius: 12px;
            padding: 1.5em; min-width: 200px; text-align: center;
          ">
            <div style="color: #23f0c7; font-size: 0.9em; margin-bottom: 0.5em;">Player 1</div>
            <div id="lobby-p0-name" style="font-size: 1.3em; font-weight: bold; margin-bottom: 0.8em;">—</div>
            <div id="lobby-p0-status" style="color: #aaa; font-size: 0.9em;"></div>
          </div>
          <!-- Player 2 card -->
          <div id="lobby-p1" style="
            background: #2a2a4a; border: 2px solid #6457a6; border-radius: 12px;
            padding: 1.5em; min-width: 200px; text-align: center;
          ">
            <div style="color: #ff6b9d; font-size: 0.9em; margin-bottom: 0.5em;">Player 2</div>
            <div id="lobby-p1-name" style="font-size: 1.3em; font-weight: bold; margin-bottom: 0.8em;">—</div>
            <div id="lobby-p1-status" style="color: #aaa; font-size: 0.9em;"></div>
          </div>
        </div>

        <!-- Name input -->
        <div style="margin-bottom: 1em;">
          <label style="display: block; margin-bottom: 0.4em; color: #ccc; font-size: 0.9em;">Your Name</label>
          <input id="lobby-name-input" type="text" maxlength="16"
            style="padding: 0.5em 1em; font-size: 1.1em; border: 2px solid #6457a6;
            background: #2a2a4a; color: white; border-radius: 8px; width: 200px; text-align: center;" />
        </div>

        <div style="display: flex; gap: 1em;">
          <button id="lobby-ready-btn" style="
            padding: 0.8em 2em; font-size: 1.1em; font-weight: bold;
            background: #23f0c7; color: #1a1a2e; border: none; border-radius: 8px;
            cursor: pointer; min-width: 160px;
          ">Start</button>
          <button id="lobby-leave-btn" style="
            padding: 0.8em 1.5em; font-size: 1.1em; font-weight: bold;
            background: #6457a6; color: white; border: none; border-radius: 8px;
            cursor: pointer;
          ">Leave</button>
        </div>
        <div id="lobby-msg" style="margin-top: 1em; color: #ffe347; min-height: 1.5em;"></div>
      </div>
    `;
    document.body.appendChild(this.roomLobby);

    // ── Countdown overlay ──
    this.countdownDiv = document.createElement('div');
    this.countdownDiv.id = 'countdown-overlay';
    this.countdownDiv.style.cssText = `
      position: fixed; inset: 0;
      display: none; align-items: center; justify-content: center;
      font-family: 'Segoe UI', sans-serif; color: white;
      font-size: 8em; font-weight: bold;
      z-index: 90; pointer-events: none;
      text-shadow: 0 0 30px rgba(35, 240, 199, 0.5);
    `;
    document.body.appendChild(this.countdownDiv);

    // ── HUD ──
    this.hudDiv = document.createElement('div');
    this.hudDiv.id = 'game-hud';
    this.hudDiv.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0;
      display: none; justify-content: space-between; align-items: center;
      padding: 1em 2em;
      font-family: 'Segoe UI', sans-serif; color: white;
      z-index: 80; pointer-events: none;
    `;
    document.body.appendChild(this.hudDiv);

    // ── Event listeners ──
    this.setupTitleEvents();
    this.setupLobbyEvents();
  }

  private setupTitleEvents(): void {
    const createBtn = this.titleScreen.querySelector('#title-create') as HTMLButtonElement;
    const joinBtn = this.titleScreen.querySelector('#title-join') as HTMLButtonElement;
    const codeInput = this.titleScreen.querySelector('#title-code') as HTMLInputElement;

    createBtn.addEventListener('click', () => {
      this.callbacks.onCreateRoom();
    });

    joinBtn.addEventListener('click', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length < 4) {
        this.setTitleStatus('Enter a valid room code');
        return;
      }
      this.callbacks.onJoinRoom(code);
    });

    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinBtn.click();
    });
  }

  private setupLobbyEvents(): void {
    const readyBtn = this.roomLobby.querySelector('#lobby-ready-btn') as HTMLButtonElement;
    const leaveBtn = this.roomLobby.querySelector('#lobby-leave-btn') as HTMLButtonElement;
    const nameInput = this.roomLobby.querySelector('#lobby-name-input') as HTMLInputElement;

    let renameTimeout: ReturnType<typeof setTimeout> | null = null;
    nameInput.addEventListener('input', () => {
      if (renameTimeout) clearTimeout(renameTimeout);
      renameTimeout = setTimeout(() => {
        const name = nameInput.value.trim();
        if (name) this.callbacks.onRename(name);
      }, 300);
    });

    readyBtn.addEventListener('click', () => {
      this.callbacks.onReady();
    });

    leaveBtn.addEventListener('click', () => {
      this.callbacks.onLeave();
    });
  }

  // ── Title screen ──

  setTitleStatus(text: string): void {
    this.statusDiv.textContent = text;
  }

  showTitle(): void {
    this.titleScreen.style.display = '';
    this.roomLobby.style.display = 'none';
    this.hudDiv.style.display = 'none';
    this.countdownDiv.style.display = 'none';
    // Clear code input
    const codeInput = this.titleScreen.querySelector('#title-code') as HTMLInputElement;
    codeInput.value = '';
    this.statusDiv.textContent = '';
  }

  // ── Room lobby ──

  showRoomLobby(roomId: string, myName: string): void {
    this.titleScreen.style.display = 'none';
    this.roomLobby.style.display = '';
    this.hudDiv.style.display = 'none';
    this.countdownDiv.style.display = 'none';

    (this.roomLobby.querySelector('#lobby-room-code') as HTMLElement).textContent = roomId;
    (this.roomLobby.querySelector('#lobby-name-input') as HTMLInputElement).value = myName;
    (this.roomLobby.querySelector('#lobby-last-result') as HTMLElement).style.display = 'none';
    (this.roomLobby.querySelector('#lobby-msg') as HTMLElement).textContent = '';
  }

  updateLobbyState(players: (LobbyPlayer | null)[], myIdx: number, lastResult?: {
    winnerIdx: number;
    stats: {
      player1Name: string;
      player2Name: string;
      player1SurvivalMs: number;
      player2SurvivalMs: number;
    };
  }): void {
    for (let i = 0; i < 2; i++) {
      const nameEl = this.roomLobby.querySelector(`#lobby-p${i}-name`) as HTMLElement;
      const statusEl = this.roomLobby.querySelector(`#lobby-p${i}-status`) as HTMLElement;
      const cardEl = this.roomLobby.querySelector(`#lobby-p${i}`) as HTMLElement;

      if (players[i]) {
        const isMe = i === myIdx;
        nameEl.textContent = players[i]!.name + (isMe ? ' (you)' : '');
        if (players[i]!.ready) {
          statusEl.textContent = 'Ready!';
          statusEl.style.color = '#23f0c7';
          cardEl.style.borderColor = '#23f0c7';
        } else {
          statusEl.textContent = isMe ? '' : 'Not ready';
          statusEl.style.color = '#aaa';
          cardEl.style.borderColor = '#6457a6';
        }
      } else {
        nameEl.textContent = 'Waiting...';
        statusEl.textContent = '';
        statusEl.style.color = '#aaa';
        cardEl.style.borderColor = '#6457a6';
      }
    }

    // Update ready button text
    const readyBtn = this.roomLobby.querySelector('#lobby-ready-btn') as HTMLButtonElement;
    const myPlayer = players[myIdx];
    if (myPlayer?.ready) {
      readyBtn.textContent = 'Cancel';
      readyBtn.style.background = '#ff6b9d';
    } else {
      readyBtn.textContent = 'Start';
      readyBtn.style.background = '#23f0c7';
    }

    // Show last game result if available
    const resultEl = this.roomLobby.querySelector('#lobby-last-result') as HTMLElement;
    if (lastResult) {
      resultEl.style.display = '';
      const winnerName = lastResult.winnerIdx === 0
        ? lastResult.stats.player1Name
        : lastResult.stats.player2Name;
      resultEl.innerHTML = `
        <p style="color: #ffe347; font-size: 1.2em; font-weight: bold; margin-bottom: 0.3em;">
          ${winnerName} won the last round!
        </p>
        <p style="color: #ccc; font-size: 0.9em;">
          ${lastResult.stats.player1Name}: ${(lastResult.stats.player1SurvivalMs / 1000).toFixed(1)}s survival &nbsp;|&nbsp;
          ${lastResult.stats.player2Name}: ${(lastResult.stats.player2SurvivalMs / 1000).toFixed(1)}s survival
        </p>
      `;
    } else {
      resultEl.style.display = 'none';
    }
  }

  setLobbyMsg(text: string): void {
    (this.roomLobby.querySelector('#lobby-msg') as HTMLElement).textContent = text;
  }

  // ── Countdown ──

  showCountdown(seconds: number): void {
    this.roomLobby.style.display = 'none';
    this.titleScreen.style.display = 'none';
    this.countdownDiv.style.display = 'flex';
    this.countdownDiv.textContent = seconds > 0 ? String(seconds) : 'GO!';
    if (seconds <= 0) {
      setTimeout(() => {
        this.countdownDiv.style.display = 'none';
      }, 500);
    }
  }

  // ── HUD ──

  showHUD(p1Name: string, p2Name: string, itPlayer: number, timeRemaining: number, myIdx: number): void {
    this.hudDiv.style.display = 'flex';
    const itLabel = itPlayer === myIdx ? '(IT - YOU!)' : '(IT)';
    const p1Label = itPlayer === 0 ? `${p1Name} ${0 === myIdx ? itLabel : '(IT)'}` : p1Name;
    const p2Label = itPlayer === 1 ? `${p2Name} ${1 === myIdx ? itLabel : '(IT)'}` : p2Name;
    const timeStr = Math.ceil(timeRemaining).toString();

    this.hudDiv.innerHTML = `
      <span style="color: #23f0c7; font-size: 1.2em; font-weight: bold;">${p1Label}</span>
      <span style="font-size: 2em; font-weight: bold; color: #ffe347;">${timeStr}</span>
      <span style="color: #ff6b9d; font-size: 1.2em; font-weight: bold;">${p2Label}</span>
    `;
  }

  hideHUD(): void {
    this.hudDiv.style.display = 'none';
  }
}
