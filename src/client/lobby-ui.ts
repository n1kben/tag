export interface LobbyCallbacks {
  onCreateRoom: (name: string) => void;
  onJoinRoom: (roomId: string, name: string) => void;
}

export class LobbyUI {
  private overlay: HTMLDivElement;
  private statusDiv: HTMLDivElement;
  private countdownDiv: HTMLDivElement;
  private hudDiv: HTMLDivElement;
  private gameOverDiv: HTMLDivElement;

  constructor(callbacks: LobbyCallbacks) {
    // Main lobby overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'lobby-overlay';
    this.overlay.innerHTML = `
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

        <div style="margin-bottom: 1.5em;">
          <label style="display: block; margin-bottom: 0.5em; color: #ccc;">Your Name</label>
          <input id="lobby-name" type="text" maxlength="16" placeholder="Player"
            style="padding: 0.6em 1em; font-size: 1.1em; border: 2px solid #6457a6;
            background: #2a2a4a; color: white; border-radius: 8px; width: 220px; text-align: center;" />
        </div>

        <div style="display: flex; gap: 1em; margin-bottom: 1.5em;">
          <button id="lobby-create" style="
            padding: 0.8em 1.5em; font-size: 1.1em; font-weight: bold;
            background: #23f0c7; color: #1a1a2e; border: none; border-radius: 8px;
            cursor: pointer;
          ">Create Game</button>
        </div>

        <div style="display: flex; gap: 0.5em; align-items: center;">
          <input id="lobby-code" type="text" maxlength="6" placeholder="ROOM CODE"
            style="padding: 0.6em 1em; font-size: 1.1em; border: 2px solid #6457a6;
            background: #2a2a4a; color: white; border-radius: 8px; width: 150px;
            text-align: center; text-transform: uppercase; letter-spacing: 2px;" />
          <button id="lobby-join" style="
            padding: 0.8em 1.5em; font-size: 1.1em; font-weight: bold;
            background: #ff6b9d; color: white; border: none; border-radius: 8px;
            cursor: pointer;
          ">Join</button>
        </div>

        <div id="lobby-status" style="margin-top: 1.5em; color: #ffe347; min-height: 1.5em;"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    // Countdown overlay
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

    // HUD
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

    // Game over overlay
    this.gameOverDiv = document.createElement('div');
    this.gameOverDiv.id = 'gameover-overlay';
    this.gameOverDiv.style.cssText = `
      position: fixed; inset: 0;
      display: none; flex-direction: column;
      align-items: center; justify-content: center;
      background: rgba(26, 26, 46, 0.9);
      font-family: 'Segoe UI', sans-serif; color: white;
      z-index: 100;
    `;
    document.body.appendChild(this.gameOverDiv);

    // Status div reference
    this.statusDiv = this.overlay.querySelector('#lobby-status')!;

    // Event listeners
    const createBtn = this.overlay.querySelector('#lobby-create') as HTMLButtonElement;
    const joinBtn = this.overlay.querySelector('#lobby-join') as HTMLButtonElement;
    const nameInput = this.overlay.querySelector('#lobby-name') as HTMLInputElement;
    const codeInput = this.overlay.querySelector('#lobby-code') as HTMLInputElement;

    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Player';
      callbacks.onCreateRoom(name);
    });

    joinBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Player';
      const code = codeInput.value.trim().toUpperCase();
      if (code.length < 4) {
        this.setStatus('Enter a valid room code');
        return;
      }
      callbacks.onJoinRoom(code, name);
    });

    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinBtn.click();
    });
  }

  setStatus(text: string): void {
    this.statusDiv.textContent = text;
  }

  showRoomCode(code: string): void {
    this.setStatus(`Room code: ${code} — Waiting for opponent...`);
  }

  hide(): void {
    this.overlay.style.display = 'none';
  }

  show(): void {
    this.overlay.style.display = '';
  }

  showCountdown(seconds: number): void {
    this.hide();
    this.countdownDiv.style.display = 'flex';
    this.countdownDiv.textContent = seconds > 0 ? String(seconds) : 'GO!';
    if (seconds <= 0) {
      setTimeout(() => {
        this.countdownDiv.style.display = 'none';
      }, 500);
    }
  }

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

  showGameOver(winnerName: string, stats: {
    player1Name: string;
    player2Name: string;
    player1SurvivalMs: number;
    player2SurvivalMs: number;
  }): void {
    this.hudDiv.style.display = 'none';
    this.gameOverDiv.style.display = 'flex';
    this.gameOverDiv.innerHTML = `
      <h1 style="font-size: 3em; margin-bottom: 0.3em; color: #ffe347;">Game Over!</h1>
      <p style="font-size: 1.5em; margin-bottom: 1em; color: #23f0c7;">${winnerName} wins!</p>
      <div style="font-size: 1.1em; color: #ccc; margin-bottom: 2em;">
        <p>${stats.player1Name}: ${(stats.player1SurvivalMs / 1000).toFixed(1)}s survival</p>
        <p>${stats.player2Name}: ${(stats.player2SurvivalMs / 1000).toFixed(1)}s survival</p>
      </div>
      <button id="gameover-back" style="
        padding: 0.8em 1.5em; font-size: 1.1em; font-weight: bold;
        background: #23f0c7; color: #1a1a2e; border: none; border-radius: 8px;
        cursor: pointer;
      ">Back to Lobby</button>
    `;

    const backBtn = this.gameOverDiv.querySelector('#gameover-back') as HTMLButtonElement;
    backBtn.addEventListener('click', () => {
      this.gameOverDiv.style.display = 'none';
      this.show();
    });
  }

  showOpponentLeft(): void {
    this.hudDiv.style.display = 'none';
    this.gameOverDiv.style.display = 'flex';
    this.gameOverDiv.innerHTML = `
      <h1 style="font-size: 2em; margin-bottom: 1em; color: #ffe347;">Opponent Left</h1>
      <button id="gameover-back" style="
        padding: 0.8em 1.5em; font-size: 1.1em; font-weight: bold;
        background: #23f0c7; color: #1a1a2e; border: none; border-radius: 8px;
        cursor: pointer;
      ">Back to Lobby</button>
    `;

    const backBtn = this.gameOverDiv.querySelector('#gameover-back') as HTMLButtonElement;
    backBtn.addEventListener('click', () => {
      this.gameOverDiv.style.display = 'none';
      this.show();
    });
  }
}
