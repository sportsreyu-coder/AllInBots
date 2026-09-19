// Wires the setup screen and table screen to the PokerGame engine.

const HUMAN_ID = 'human';

const App = {
  game: null,
  selectedMode: 'cash',
  startingChips: 1500,
  currentLegal: null,
  botTimer: null,

  init() {
    UI.init();
    this.bindSetupScreen();
    this.bindTableScreen();
  },

  bindSetupScreen() {
    const modeButtons = document.querySelectorAll('.mode-btn');
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

    const botCountInput = document.getElementById('bot-count');
    const botCountLabel = document.getElementById('bot-count-label');
    botCountInput.addEventListener('input', () => {
      botCountLabel.textContent = `${botCountInput.value} bots`;
    });

    document.getElementById('start-btn').addEventListener('click', () => {
      const botCount = Number(document.getElementById('bot-count').value);
      this.startingChips = Number(document.getElementById('starting-chips').value);
      this.beginGame(this.selectedMode, botCount, this.startingChips);
    });
  },

  bindTableScreen() {
    document.getElementById('leave-btn').addEventListener('click', () => this.returnToLobby());
    document.getElementById('quit-btn').addEventListener('click', () => this.returnToLobby());
    document.getElementById('restart-btn').addEventListener('click', () => this.returnToLobby());

    document.getElementById('rebuy-btn').addEventListener('click', () => {
      const human = this.game.players.find((p) => p.id === HUMAN_ID);
      human.chips = this.startingChips;
      human.busted = false;
      UI.showRebuy(false);
      this.dealNextHand();
    });

    document.getElementById('next-hand-btn').addEventListener('click', () => {
      UI.hideResult();
      this.dealNextHand();
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
  },

  humanAct(action, amount) {
    if (!this.currentLegal) return;
    if (action === 'call' && this.currentLegal.toCall === 0) action = 'check';
    UI.showActionButtons(false);
    this.game.applyAction(HUMAN_ID, action, amount);
  },

  buildPlayers(botCount, startingChips) {
    const shuffledPersonalities = [...BOT_PERSONALITIES];
    shuffle(shuffledPersonalities);
    const players = [
      { id: HUMAN_ID, name: 'You', isHuman: true, chips: startingChips },
    ];
    for (let i = 0; i < botCount; i++) {
      const personality = shuffledPersonalities[i % shuffledPersonalities.length];
      players.push({
        id: `bot-${i}`,
        name: personality.name,
        isHuman: false,
        chips: startingChips,
        personality,
      });
    }
    return players;
  },

  beginGame(mode, botCount, startingChips) {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('table-screen').classList.remove('hidden');

    const players = this.buildPlayers(botCount, startingChips);
    this.game = new PokerGame({
      mode,
      players,
      onEvent: (type, payload) => this.handleEvent(type, payload),
    });

    UI.clearLog();
    UI.hideResult();
    UI.hideGameOver();
    UI.showRebuy(false);
    this.dealNextHand();
  },

  returnToLobby() {
    clearTimeout(this.botTimer);
    this.game = null;
    document.getElementById('table-screen').classList.add('hidden');
    document.getElementById('setup-screen').classList.remove('hidden');
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
    const human = this.game.players.find((p) => p.id === HUMAN_ID);
    if (human.chips <= 0 && !human.busted) human.busted = true;
    if (human.busted && this.game.mode === 'cash') {
      UI.showRebuy(true);
      return;
    }
    if (human.busted && this.game.mode === 'tournament') {
      this.endTournamentForHuman();
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
    UI.renderSeats(this.game, HUMAN_ID, options);
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
    return p ? (p.isHuman ? 'You' : p.name) : id;
  },

  handleEvent(type, payload) {
    const game = this.game;
    switch (type) {
      case 'handStart': {
        UI.hideResult();
        UI.renderStreet('Preflop');
        this.syncTable({});
        UI.log(`— Hand #${payload.handNumber} — blinds ${payload.blinds.small}/${payload.blinds.big} —`);
        break;
      }
      case 'blindsPosted': {
        UI.log(`${this.playerName(payload.sb)} posts small blind ${payload.blinds.small}`);
        UI.log(`${this.playerName(payload.bb)} posts big blind ${payload.blinds.big}`);
        this.syncTable({});
        break;
      }
      case 'street': {
        const labels = { flop: 'Flop', turn: 'Turn', river: 'River', runout: 'Board' };
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
      case 'handEnd': {
        break;
      }
      case 'gameOver': {
        clearTimeout(this.botTimer);
        const winnerName = payload.winner ? this.playerName(payload.winner.id) : null;
        if (winnerName === 'You') {
          UI.showGameOver('You won the tournament! 🏆');
        } else if (winnerName) {
          UI.showGameOver(`${winnerName} wins the tournament. Better luck next time!`);
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
    this.syncTable({ activePlayerId: playerId });

    if (player.isHuman) {
      this.currentLegal = game.legalActions();
      UI.configureActions(this.currentLegal);
      UI.showActionButtons(true);
      return;
    }

    UI.showActionButtons(false);
    const delay = 550 + Math.random() * 900;
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

  onHandResult(payload) {
    clearTimeout(this.botTimer);
    UI.showActionButtons(false);
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
      text = w.hand
        ? `<strong>${this.playerName(w.playerId)}</strong> wins ${w.amount.toLocaleString()} with ${w.hand}`
        : `<strong>${this.playerName(w.playerId)}</strong> wins ${w.amount.toLocaleString()} (others folded)`;
    } else {
      text = payload.winners
        .map((w) => `<strong>${this.playerName(w.playerId)}</strong> wins ${w.amount.toLocaleString()}${w.hand ? ` with ${w.hand}` : ''}`)
        .join('<br/>');
    }
    for (const w of payload.winners) {
      UI.log(`${this.playerName(w.playerId)} wins ${w.amount}${w.hand ? ` (${w.hand})` : ''}`);
    }

    this.syncTable({ revealAll, showdownHands: payload.showdownHands });
    UI.showResult(text);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
