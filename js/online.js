// Online multiplayer: lobby (create/join a room) and driving the shared
// table-screen UI from server-pushed snapshots instead of a local PokerGame.
// The server (server/room.js) is authoritative and only ever tells each
// client its own hole cards, so nothing here needs to hide anything further.

const OnlineApp = {
  tab: 'create',
  code: null,
  youId: null,
  hostId: null,
  inRoom: false,
  snapshot: null,
  announcedBustOut: false,

  init() {
    this.bindSetupPanel();
    this.bindLobbyScreen();

    Net.on('roomCreated', (msg) => this.onRoomEntered(msg));
    Net.on('roomJoined', (msg) => this.onRoomEntered(msg));
    Net.on('lobby', (msg) => this.onLobby(msg));
    Net.on('error', (msg) => this.showError(msg.message));
    Net.on('engineEvent', (msg) => this.handleEngineEvent(msg.event, msg.payload, msg.snapshot));
    Net.on('disconnected', () => this.onDisconnected());

    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      const btn = document.querySelector('.table-type-btn[data-table-type="online"]');
      if (btn) btn.click();
      this.setTab('join');
      document.getElementById('online-room-code').value = room.toUpperCase();
    }
  },

  bindSetupPanel() {
    document.getElementById('online-tab-create').addEventListener('click', () => this.setTab('create'));
    document.getElementById('online-tab-join').addEventListener('click', () => this.setTab('join'));

    const botFillInput = document.getElementById('online-bot-fill');
    const botFillLabel = document.getElementById('online-bot-fill-label');
    botFillInput.addEventListener('input', () => {
      botFillLabel.textContent = `${botFillInput.value} bots`;
    });

    const codeInput = document.getElementById('online-room-code');
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase();
    });

    document.getElementById('online-create-btn').addEventListener('click', () => this.createRoom());
    document.getElementById('online-join-btn').addEventListener('click', () => this.joinRoom());
  },

  bindLobbyScreen() {
    document.getElementById('lobby-copy-btn').addEventListener('click', () => this.copyLink());
    document.getElementById('lobby-start-btn').addEventListener('click', () => Net.send({ type: 'startGame' }));
    document.getElementById('lobby-leave-btn').addEventListener('click', () => this.leaveLobby());
  },

  onTableTypeSelected() {
    this.setTab(this.tab);
  },

  setTab(tab) {
    this.tab = tab;
    document.getElementById('online-tab-create').classList.toggle('selected', tab === 'create');
    document.getElementById('online-tab-join').classList.toggle('selected', tab === 'join');
    document.getElementById('online-create-panel').classList.toggle('hidden', tab !== 'create');
    document.getElementById('online-join-panel').classList.toggle('hidden', tab !== 'join');
    document.getElementById('chips-option-row').classList.toggle('hidden', tab !== 'create');
    document.getElementById('online-create-btn').classList.toggle('hidden', tab !== 'create');
    document.getElementById('online-join-btn').classList.toggle('hidden', tab !== 'join');
    this.clearError();
  },

  showError(message) {
    const el = document.getElementById('online-error');
    el.textContent = message;
    el.classList.remove('hidden');
  },

  clearError() {
    document.getElementById('online-error').classList.add('hidden');
  },

  async createRoom() {
    this.clearError();
    const name = document.getElementById('online-name-create').value.trim() || 'Player';
    const botFillCount = Number(document.getElementById('online-bot-fill').value);
    const startingChips = Number(document.getElementById('starting-chips').value);
    try {
      await Net.connect();
    } catch {
      this.showError('Could not reach the game server.');
      return;
    }
    Net.send({ type: 'createRoom', name, mode: App.selectedMode, startingChips, botFillCount });
  },

  async joinRoom() {
    this.clearError();
    const name = document.getElementById('online-name-join').value.trim() || 'Player';
    const code = document.getElementById('online-room-code').value.trim().toUpperCase();
    if (!code) {
      this.showError('Enter a room code.');
      return;
    }
    try {
      await Net.connect();
    } catch {
      this.showError('Could not reach the game server.');
      return;
    }
    Net.send({ type: 'joinRoom', name, code });
  },

  onRoomEntered(msg) {
    this.code = msg.code;
    this.youId = msg.youId;
    this.inRoom = true;
    this.announcedBustOut = false;
    App.showScreen('lobby');
    document.getElementById('lobby-code').textContent = msg.code;
    document.getElementById('lobby-link').value = `${location.origin}${location.pathname}?room=${msg.code}`;
  },

  onLobby(msg) {
    this.hostId = msg.hostId;
    if (msg.started) return; // table screen takes over via engineEvent
    const isHost = msg.hostId === this.youId;

    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    for (const p of msg.players) {
      const row = document.createElement('div');
      row.className = `lobby-player${p.connected ? '' : ' disconnected'}`;
      const tags = [
        p.id === msg.hostId ? '<span class="host-tag">HOST</span>' : '',
        p.id === this.youId ? '<span class="you-tag">you</span>' : '',
        p.connected ? '' : '<span class="offline-tag">offline</span>',
      ].join(' ');
      row.innerHTML = `<span>${p.name}</span><span class="lobby-player-tags">${tags}</span>`;
      list.appendChild(row);
    }
    if (msg.botFillCount > 0) {
      const row = document.createElement('div');
      row.className = 'lobby-player lobby-bots-note';
      row.textContent = `+ ${msg.botFillCount} bot${msg.botFillCount === 1 ? '' : 's'} filling empty seats`;
      list.appendChild(row);
    }

    const totalSeats = msg.players.length + msg.botFillCount;
    const startBtn = document.getElementById('lobby-start-btn');
    startBtn.classList.toggle('hidden', !isHost);
    startBtn.disabled = totalSeats < 2;
    document.getElementById('lobby-wait-text').classList.toggle('hidden', isHost);
  },

  copyLink() {
    const input = document.getElementById('lobby-link');
    input.select();
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).catch(() => {});
  },

  leaveLobby() {
    Net.send({ type: 'leaveRoom' });
    this.inRoom = false;
    App.showScreen('setup');
  },

  leaveGame() {
    Net.send({ type: 'leaveRoom' });
    this.inRoom = false;
    App.engine = 'local';
    App.showScreen('setup');
  },

  onDisconnected() {
    if (!this.inRoom) return;
    this.inRoom = false;
    App.engine = 'local';
    App.showScreen('setup');
    this.showError('Connection to the game server was lost.');
  },

  enterGame() {
    App.engine = 'online';
    App.showScreen('table');
    document.getElementById('action-buttons').classList.remove('spectating');
    UI.clearLog();
    UI.hideResult();
    UI.hideGameOver();
    UI.showRebuy(false);
  },

  nameFor(id) {
    const p = this.snapshot && this.snapshot.players.find((pl) => pl.id === id);
    return p ? p.name : id;
  },

  renderSnapshot(snapshot) {
    UI.renderSeats(
      { players: snapshot.players, dealerIndex: snapshot.dealerIndex },
      { centerId: snapshot.you, activePlayerId: snapshot.activePlayerId, revealAll: true }
    );
    UI.renderCommunity(snapshot.board);
    UI.renderPot(snapshot.pot);
    UI.setHUD({
      mode: snapshot.mode,
      blinds: snapshot.blinds,
      level: snapshot.tournamentLevel,
      handNumber: snapshot.handNumber,
      handsPerLevel: 4,
    });

    const me = snapshot.players.find((p) => p.id === snapshot.you);
    if (me && me.busted && snapshot.mode === 'cash' && !snapshot.gameOver) {
      UI.showRebuy(true, [me.name]);
    } else {
      UI.showRebuy(false);
    }
    if (me) {
      if (me.busted && snapshot.mode === 'tournament' && !this.announcedBustOut) {
        this.announcedBustOut = true;
        UI.log('You busted out of the tournament.');
      } else if (!me.busted) {
        this.announcedBustOut = false;
      }
    }
  },

  handleEngineEvent(event, payload, snapshot) {
    this.snapshot = snapshot;
    if (App.engine !== 'online' || document.getElementById('table-screen').classList.contains('hidden')) {
      this.enterGame();
    }

    switch (event) {
      case 'handStart': {
        UI.hideResult();
        UI.renderStreet('Preflop');
        this.renderSnapshot(snapshot);
        UI.log(`— Hand #${payload.handNumber} — blinds ${payload.blinds.small}/${payload.blinds.big} —`);
        break;
      }
      case 'blindsPosted': {
        UI.log(`${this.nameFor(payload.sb)} posts small blind ${payload.blinds.small}`);
        UI.log(`${this.nameFor(payload.bb)} posts big blind ${payload.blinds.big}`);
        this.renderSnapshot(snapshot);
        break;
      }
      case 'street': {
        const labels = { flop: 'Flop', turn: 'Turn', river: 'River', runout: 'Board' };
        UI.renderStreet(labels[payload.street] || '');
        UI.log(`— ${labels[payload.street] || payload.street} —`);
        this.renderSnapshot(snapshot);
        break;
      }
      case 'action': {
        const name = this.nameFor(payload.playerId);
        if (payload.action === 'fold') UI.log(`${name} folds`);
        else if (payload.action === 'check') UI.log(`${name} checks`);
        else if (payload.action === 'call') UI.log(`${name} calls ${payload.amount}`);
        else if (payload.action === 'bet') UI.log(`${name} bets ${payload.total}`);
        else if (payload.action === 'raise') UI.log(`${name} raises to ${payload.total}`);
        this.renderSnapshot(snapshot);
        break;
      }
      case 'actionOn': {
        this.renderSnapshot(snapshot);
        if (snapshot.activePlayerId === snapshot.you && snapshot.legal) {
          App.currentLegal = snapshot.legal;
          UI.configureActions(snapshot.legal);
          UI.showActionButtons(true);
        } else {
          UI.showActionButtons(false);
        }
        break;
      }
      case 'handResult': {
        UI.showActionButtons(false);
        if (payload.showdownHands) {
          for (const entry of payload.showdownHands) {
            const cardsStr = entry.holeCards.map((c) => `${rankLabel(c.rank)}${suitSymbol(c.suit)}`).join(' ');
            UI.log(`${this.nameFor(entry.playerId)} shows ${cardsStr} — ${entry.hand}`);
          }
        }
        let text;
        if (payload.winners.length === 1) {
          const w = payload.winners[0];
          text = w.hand
            ? `<strong>${this.nameFor(w.playerId)}</strong> wins ${w.amount.toLocaleString()} with ${w.hand}`
            : `<strong>${this.nameFor(w.playerId)}</strong> wins ${w.amount.toLocaleString()} (others folded)`;
        } else {
          text = payload.winners
            .map((w) => `<strong>${this.nameFor(w.playerId)}</strong> wins ${w.amount.toLocaleString()}${w.hand ? ` with ${w.hand}` : ''}`)
            .join('<br/>');
        }
        for (const w of payload.winners) {
          UI.log(`${this.nameFor(w.playerId)} wins ${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
        }
        UI.renderSeats(
          { players: snapshot.players, dealerIndex: snapshot.dealerIndex },
          { centerId: snapshot.you, revealAll: true, showdownHands: payload.showdownHands }
        );
        UI.renderCommunity(snapshot.board);
        UI.renderPot(snapshot.pot);
        UI.showResult(text);
        break;
      }
      case 'handEnd':
        break;
      case 'gameOver': {
        const winner = payload.winner;
        if (!winner) break;
        if (winner.id === snapshot.you) {
          UI.showGameOver('You won the tournament! 🏆');
        } else {
          UI.showGameOver(`${winner.name} wins the tournament! 🏆`);
        }
        break;
      }
      // 'presence': a player's connection state changed but no engine event
      // fired (e.g. mid-hand disconnect) — just re-sync the seats.
      default:
        this.renderSnapshot(snapshot);
        break;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => OnlineApp.init());
