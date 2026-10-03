// Wires the setup screen and table screen to the PokerGame engine for the two
// local (single-browser) table types. Online multiplayer's lobby and network
// wiring lives in js/online.js; it drives this same table-screen UI by
// setting App.engine = 'online' and feeding it server snapshots instead of a
// local `game` instance — see App.humanAct and the table-screen bindings
// below for the branch points.

const HUMAN_ID = 'human';

const App = {
  game: null,
  engine: 'local', // 'local' | 'online'
  selectedMode: 'cash',
  selectedTableType: 'mixed',
  tableType: 'mixed',
  startingChips: 1500,
  currentLegal: null,
  currentBigBlind: null,
  botTimer: null,
  autoAdvanceTimer: null,
  perspectiveId: null,
  actingHumanId: null,

  init() {
    UI.init();
    this.bindSetupScreen();
    this.bindTableScreen();
  },

  bindSetupScreen() {
    const modeButtons = document.querySelectorAll('.mode-btn[data-mode]');
    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        modeButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedMode = btn.dataset.mode;
        document.getElementById('selected-mode-label').textContent =
          this.selectedMode === 'tournament' ? 'Tournament' : 'Cash Game';
      });
    });
    modeButtons[0].classList.add('selected');

    const tableTypeButtons = document.querySelectorAll('.table-type-btn');
    tableTypeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        tableTypeButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedTableType = btn.dataset.tableType;
        this.updateTableTypeOptions();
      });
    });
    tableTypeButtons[0].classList.add('selected');
    this.updateTableTypeOptions();

    const botCountInput = document.getElementById('bot-count');
    const botCountLabel = document.getElementById('bot-count-label');
    botCountInput.addEventListener('input', () => {
      botCountLabel.textContent = `${botCountInput.value} bots`;
    });

    const tableBotCountInput = document.getElementById('table-bot-count');
    const tableBotCountLabel = document.getElementById('table-bot-count-label');
    tableBotCountInput.addEventListener('input', () => {
      tableBotCountLabel.textContent = `${tableBotCountInput.value} bots`;
    });

    const irlPlayerCountInput = document.getElementById('irl-player-count');
    const irlPlayerCountLabel = document.getElementById('irl-player-count-label');
    irlPlayerCountInput.addEventListener('input', () => {
      irlPlayerCountLabel.textContent = `${irlPlayerCountInput.value} players`;
      this.renderIrlPlayerRows();
    });
    this.renderIrlPlayerRows();

    const chipButtons = document.querySelectorAll('.chip-btn');
    chipButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        chipButtons.forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.startingChips = Number(btn.dataset.chips);
        // Everyone buys in for the new default; individual rows can still
        // be bumped up afterward for players putting in more.
        document.querySelectorAll('.irl-player-chips').forEach((input) => {
          input.value = this.startingChips;
        });
      });
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      this.beginGameFromSetup();
    });

    document.getElementById('open-solver-btn').addEventListener('click', () => {
      SolverScreen.open();
    });
  },

  // Toggles which option panel is visible for the selected table type. The
  // 'online' panel's own Create/Join tab switching is handled by OnlineApp.
  updateTableTypeOptions() {
    const type = this.selectedTableType;
    document.getElementById('mixed-options').classList.toggle('hidden', type !== 'mixed');
    document.getElementById('bots-options').classList.toggle('hidden', type !== 'bots');
    document.getElementById('online-options').classList.toggle('hidden', type !== 'online');
    document.getElementById('irl-options').classList.toggle('hidden', type !== 'irl');
    document.getElementById('start-btn').classList.toggle('hidden', type === 'online');
    document.getElementById('chips-option-label').textContent = type === 'irl' ? 'Default buy-in' : 'Starting chips';
    if (type === 'online' && typeof OnlineApp !== 'undefined') {
      OnlineApp.onTableTypeSelected();
    } else {
      document.getElementById('chips-option-row').classList.remove('hidden');
      document.getElementById('online-create-btn').classList.add('hidden');
      document.getElementById('online-join-btn').classList.add('hidden');
    }
  },

  // (Re)builds the per-player name/buy-in rows for "Play IRL" to match the
  // current player-count slider, preserving values already typed for seats
  // that still exist and defaulting new seats to the shared buy-in amount —
  // "everyone joins for the same amount, bump a row for anyone buying extra."
  renderIrlPlayerRows() {
    const count = Number(document.getElementById('irl-player-count').value);
    const container = document.getElementById('irl-players-list');
    const existing = [...container.querySelectorAll('.irl-player-row')].map((row) => ({
      name: row.querySelector('.irl-player-name').value,
      chips: row.querySelector('.irl-player-chips').value,
    }));
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const prev = existing[i];
      const row = document.createElement('div');
      row.className = 'irl-player-row';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'irl-player-name';
      nameInput.placeholder = `Player ${i + 1}`;
      nameInput.value = prev ? prev.name : '';

      const chipsInput = document.createElement('input');
      chipsInput.type = 'number';
      chipsInput.className = 'irl-player-chips';
      chipsInput.min = '1';
      chipsInput.step = '50';
      chipsInput.value = prev ? prev.chips : this.startingChips;

      row.appendChild(nameInput);
      row.appendChild(chipsInput);
      container.appendChild(row);
    }
  },

  beginGameFromSetup() {
    const tableType = this.selectedTableType;
    const config = { startingChips: this.startingChips };
    if (tableType === 'mixed') {
      config.botCount = Number(document.getElementById('bot-count').value);
    } else if (tableType === 'bots') {
      config.botCount = Number(document.getElementById('table-bot-count').value);
    } else if (tableType === 'irl') {
      config.irlPlayers = [...document.querySelectorAll('.irl-player-row')].map((row, i) => ({
        name: row.querySelector('.irl-player-name').value.trim() || `Player ${i + 1}`,
        chips: Math.max(1, Number(row.querySelector('.irl-player-chips').value) || this.startingChips),
      }));
    }
    this.beginGame(tableType, this.selectedMode, config);
  },

  bindTableScreen() {
    document.getElementById('leave-btn').addEventListener('click', () => this.leaveTable());
    document.getElementById('quit-btn').addEventListener('click', () => this.leaveTable());
    document.getElementById('restart-btn').addEventListener('click', () => this.leaveTable());

    document.getElementById('rebuy-btn').addEventListener('click', () => {
      if (this.engine === 'online') {
        Net.send({ type: 'rebuy' });
        UI.showRebuy(false);
        return;
      }
      for (const p of this.game.players) {
        if (p.isHuman && p.busted) {
          p.chips = this.startingChips;
          p.busted = false;
        }
      }
      UI.showRebuy(false);
      this.dealNextHand();
    });

    document.getElementById('next-hand-btn').addEventListener('click', () => {
      clearTimeout(this.autoAdvanceTimer);
      UI.hideResult();
      if (this.engine === 'online') {
        Net.send({ type: 'nextHand' });
        return;
      }
      this.dealNextHand();
    });

    document.getElementById('award-pot-btn').addEventListener('click', () => {
      const potEls = [...document.querySelectorAll('.showdown-pot')];
      const selections = [];
      for (const el of potEls) {
        const idx = Number(el.dataset.potIndex);
        selections[idx] = [...el.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value);
      }
      UI.hideManualShowdown();
      this.game.resolveManualShowdown(selections);
    });

    document.getElementById('log-toggle').addEventListener('click', () => {
      document.getElementById('log-panel').classList.toggle('hidden');
    });
    document.getElementById('log-close').addEventListener('click', () => {
      document.getElementById('log-panel').classList.add('hidden');
    });

    document.getElementById('fold-btn').addEventListener('click', () => this.humanAct('fold'));
    document.getElementById('check-call-btn').addEventListener('click', () => this.humanAct('call'));
    document.getElementById('raise-btn').addEventListener('click', () => {
      const amount = Number(document.getElementById('raise-input').value);
      this.humanAct(this.currentLegal.toCall > 0 ? 'raise' : 'bet', amount);
    });
    document.getElementById('allin-btn').addEventListener('click', () => {
      if (!this.currentLegal) return;
      if (!this.currentLegal.canRaise) {
        this.humanAct('call');
      } else {
        this.humanAct(this.currentLegal.toCall > 0 ? 'raise' : 'bet', this.currentLegal.maxRaiseTotal);
      }
    });

    const slider = document.getElementById('raise-slider');
    const input = document.getElementById('raise-input');
    slider.addEventListener('input', () => { input.value = slider.value; });
    input.addEventListener('input', () => { slider.value = input.value; });

    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.currentLegal || !this.currentLegal.canRaise || !this.currentBigBlind) return;
        const mult = parseFloat(btn.dataset.bb);
        const target = Math.min(
          Math.max(Math.round(this.currentBigBlind * mult), this.currentLegal.minRaiseTotal),
          this.currentLegal.maxRaiseTotal
        );
        slider.value = target;
        input.value = target;
      });
    });
  },

  leaveTable() {
    if (this.engine === 'online') {
      OnlineApp.leaveGame();
      return;
    }
    this.returnToLobby();
  },

  humanAct(action, amount) {
    if (!this.currentLegal) return;
    if (action === 'call' && this.currentLegal.toCall === 0) action = 'check';
    UI.showActionButtons(false);
    if (this.engine === 'online') {
      Net.send({ type: 'action', action, amount });
      return;
    }
    if (!this.actingHumanId) return;
    this.game.applyAction(this.actingHumanId, action, amount);
  },

  buildPlayers(tableType, config) {
    if (tableType === 'irl') {
      return config.irlPlayers.map((p, i) => ({ id: `p${i}`, name: p.name, isHuman: true, chips: p.chips }));
    }

    const shuffledPersonalities = [...BOT_PERSONALITIES];
    shuffle(shuffledPersonalities);
    const players = [];

    if (tableType === 'mixed') {
      players.push({ id: HUMAN_ID, name: 'You', isHuman: true, chips: config.startingChips });
    }
    if (tableType === 'mixed' || tableType === 'bots') {
      const names = pickBotNames(config.botCount);
      for (let i = 0; i < config.botCount; i++) {
        const personality = shuffledPersonalities[i % shuffledPersonalities.length];
        players.push({
          id: `bot-${i}`,
          name: names[i],
          isHuman: false,
          chips: config.startingChips,
          personality,
        });
      }
    }
    return players;
  },

  beginGame(tableType, mode, config) {
    this.showScreen('table');

    this.engine = 'local';
    this.tableType = tableType;
    const players = this.buildPlayers(tableType, config);
    this.perspectiveId = tableType === 'mixed' ? HUMAN_ID : null;
    this.actingHumanId = null;

    this.game = new PokerGame({
      mode,
      players,
      cardsIRL: tableType === 'irl',
      onEvent: (type, payload) => this.handleEvent(type, payload),
    });

    document.body.classList.toggle('irl-mode', tableType === 'irl');
    document.getElementById('action-buttons').classList.toggle('spectating', tableType === 'bots');

    UI.clearLog();
    UI.hideResult();
    UI.hideGameOver();
    UI.showRebuy(false);
    this.dealNextHand();
  },

  showScreen(name) {
    document.getElementById('setup-screen').classList.toggle('hidden', name !== 'setup');
    document.getElementById('lobby-screen').classList.toggle('hidden', name !== 'lobby');
    document.getElementById('table-screen').classList.toggle('hidden', name !== 'table');
    document.getElementById('solver-screen').classList.toggle('hidden', name !== 'solver');
  },

  returnToLobby() {
    clearTimeout(this.botTimer);
    clearTimeout(this.autoAdvanceTimer);
    this.game = null;
    document.body.classList.remove('irl-mode');
    this.showScreen('setup');
  },

  rebuyBustedBots() {
    if (this.game.mode !== 'cash') return;
    for (const p of this.game.players) {
      if (!p.isHuman && p.chips <= 0) {
        p.chips = this.startingChips;
        p.busted = false;
      }
    }
  },

  dealNextHand() {
    if (!this.game || this.game.gameOver) return;
    this.rebuyBustedBots();

    if (this.tableType === 'bots') {
      UI.clearLog();
      this.game.startHand();
      return;
    }

    if (this.tableType === 'irl') {
      const busted = this.game.players.filter((p) => p.busted);
      if (busted.length > 0 && this.game.mode === 'cash') {
        UI.showRebuy(true, busted.map((p) => p.name));
        return;
      }
      UI.clearLog();
      this.game.startHand();
      return;
    }

    const human = this.game.players.find((p) => p.isHuman);
    if (human.chips <= 0 && !human.busted) human.busted = true;
    if (human.busted) {
      if (this.game.mode === 'cash') {
        UI.showRebuy(true, [human.name]);
      } else {
        this.endTournamentForHuman();
      }
      return;
    }

    UI.clearLog();
    this.game.startHand();
  },

  endTournamentForHuman() {
    const remaining = this.game.players.filter((p) => !p.busted).length;
    const place = remaining + 1;
    this.game.gameOver = true;
    UI.showGameOver(`You busted out in <strong>${this.ordinal(place)} place</strong>. Better luck next time!`);
  },

  ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  },

  syncTable(options) {
    const revealIds = this.perspectiveId ? [this.perspectiveId] : [];
    UI.renderSeats(this.game, { centerId: this.perspectiveId, revealIds, ...options });
    UI.renderCommunity(this.game.board);
    UI.renderPot(this.game.potTotal());
    UI.setHUD({
      mode: this.game.mode,
      blinds: this.game.blinds,
      level: this.game.tournamentLevel,
      handNumber: this.game.handNumber,
      handsPerLevel: 4,
    });
  },

  playerName(id) {
    const p = this.game.players.find((pl) => pl.id === id);
    return p ? p.name : id;
  },

  handleEvent(type, payload) {
    const game = this.game;
    switch (type) {
      case 'handStart': {
        UI.hideResult();
        UI.collectBetChips();
        UI.renderStreet('Preflop');
        this.syncTable({});
        UI.log(`— Hand #${payload.handNumber} — blinds ${payload.blinds.small}/${payload.blinds.big} —`);
        break;
      }
      case 'blindsPosted': {
        UI.log(`${this.playerName(payload.sb)} posts small blind ${payload.blinds.small}`);
        UI.log(`${this.playerName(payload.bb)} posts big blind ${payload.blinds.big}`);
        this.syncTable({});
        UI.renderBetChips(game, { centerId: this.perspectiveId });
        break;
      }
      case 'street': {
        const labels = { flop: 'Flop', turn: 'Turn', river: 'River', runout: 'Board' };
        UI.collectBetChips();
        UI.renderStreet(labels[payload.street] || '');
        UI.log(`— ${labels[payload.street] || payload.street} —`);
        this.syncTable({});
        break;
      }
      case 'action': {
        const name = this.playerName(payload.playerId);
        if (payload.action === 'fold') UI.log(`${name} folds`);
        else if (payload.action === 'check') UI.log(`${name} checks`);
        else if (payload.action === 'call') UI.log(`${name} calls ${payload.amount}`);
        else if (payload.action === 'bet') UI.log(`${name} bets ${payload.total}`);
        else if (payload.action === 'raise') UI.log(`${name} raises to ${payload.total}`);
        this.syncTable({ activePlayerId: payload.playerId });
        UI.renderBetChips(game, { centerId: this.perspectiveId });
        break;
      }
      case 'actionOn': {
        this.onActionOn(payload.playerId);
        break;
      }
      case 'handResult': {
        this.onHandResult(payload);
        break;
      }
      case 'manualShowdown': {
        this.onManualShowdown(payload);
        break;
      }
      case 'handEnd': {
        break;
      }
      case 'gameOver': {
        clearTimeout(this.botTimer);
        clearTimeout(this.autoAdvanceTimer);
        const winner = payload.winner;
        const winnerName = winner ? this.playerName(winner.id) : null;
        if (!winnerName) break;
        if (this.tableType === 'mixed') {
          UI.showGameOver(
            winner.isHuman
              ? 'You won the tournament! 🏆'
              : `${winnerName} wins the tournament. Better luck next time!`
          );
        } else {
          UI.showGameOver(`${winnerName} wins the tournament! 🏆`);
        }
        break;
      }
      default:
        break;
    }
  },

  onActionOn(playerId) {
    const game = this.game;
    const player = game.players.find((p) => p.id === playerId);

    if (player.isHuman) {
      this.syncTable({ activePlayerId: playerId });
      UI.startTurnTimer(playerId, 25000); // cosmetic only in local play, no enforcement
      this.actingHumanId = playerId;
      this.currentLegal = game.legalActions();
      this.currentBigBlind = game.blinds.big;
      UI.configureActions(this.currentLegal);
      UI.showActionButtons(true);
      return;
    }

    this.syncTable({ activePlayerId: playerId });
    UI.showActionButtons(false);
    const delay = 550 + Math.random() * 900;
    UI.startTurnTimer(playerId, delay);
    UI.setThinking(playerId, true);
    this.botTimer = setTimeout(() => {
      if (!this.game || this.game !== game) return;
      const legal = game.legalActions();
      const board = game.board;
      const opponentsInHand = game.contendersRemaining().length - 1;
      const decision = decideBotAction(player, player.holeCards, board, {
        toCall: legal.toCall,
        pot: legal.pot,
        currentBet: game.currentBet,
        minRaiseTotal: legal.minRaiseTotal,
        maxRaiseTotal: legal.maxRaiseTotal,
        canCheck: legal.canCheck,
        street: game.street,
        opponentsInHand: Math.max(0, opponentsInHand),
        tendencies: game.tableTendencies(playerId),
        position: game.positionFor(playerId),
        bigBlind: game.blinds.big,
      });

      if (decision.action === 'fold' && legal.canCheck) {
        game.applyAction(playerId, 'check');
      } else if (decision.action === 'check' || decision.action === 'call') {
        game.applyAction(playerId, legal.canCheck ? 'check' : 'call');
      } else if (decision.action === 'fold') {
        game.applyAction(playerId, 'fold');
      } else if (decision.action === 'bet' || decision.action === 'raise') {
        const total = Math.min(Math.max(legal.minRaiseTotal, decision.amount), legal.maxRaiseTotal);
        game.applyAction(playerId, legal.toCall > 0 ? 'raise' : 'bet', total);
      }
    }, delay);
  },

  onManualShowdown(payload) {
    clearTimeout(this.botTimer);
    UI.showActionButtons(false);
    UI.clearTurnTimer();
    UI.collectBetChips();
    UI.log('— Showdown — reveal hands at the table and pick the winner(s) below —');
    this.syncTable({});

    const pots = payload.pots
      .map((pot, index) => ({
        index,
        amount: pot.amount,
        players: pot.eligible.map((id) => ({ id, name: this.playerName(id) })),
      }))
      .filter((pot) => pot.amount > 0);
    UI.showManualShowdown(pots);
  },

  onHandResult(payload) {
    clearTimeout(this.botTimer);
    UI.showActionButtons(false);
    UI.clearTurnTimer();
    UI.collectBetChips();
    const revealAll = !payload.byFold;

    if (payload.showdownHands) {
      for (const entry of payload.showdownHands) {
        const cardsStr = entry.holeCards.map((c) => `${rankLabel(c.rank)}${suitSymbol(c.suit)}`).join(' ');
        UI.log(`${this.playerName(entry.playerId)} shows ${cardsStr} — ${entry.hand}`);
      }
    }

    let text;
    if (payload.winners.length === 1) {
      const w = payload.winners[0];
      const suffix = w.hand ? ` with ${w.hand}` : (payload.byFold ? ' (others folded)' : '');
      text = `<strong>${this.playerName(w.playerId)}</strong> wins ${w.amount.toLocaleString()}${suffix}`;
    } else {
      text = payload.winners
        .map((w) => `<strong>${this.playerName(w.playerId)}</strong> wins ${w.amount.toLocaleString()}${w.hand ? ` with ${w.hand}` : ''}`)
        .join('<br/>');
    }
    for (const w of payload.winners) {
      UI.log(`${this.playerName(w.playerId)} wins ${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
    }

    this.syncTable({
      revealAll,
      showdownHands: payload.showdownHands,
      winnerIds: payload.winners.map((w) => w.playerId),
    });
    UI.showResult(text);

    if (this.tableType === 'bots' && this.game && !this.game.gameOver) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = setTimeout(() => {
        if (!this.game || this.game.gameOver) return;
        UI.hideResult();
        this.dealNextHand();
      }, 3500);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
