// Core Texas Hold'em game engine: betting rounds, side pots, hand resolution.
// Emits events via `onEvent(type, payload)` so the UI layer can render/log without
// the engine knowing anything about the DOM.

const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];

const TOURNAMENT_BLIND_LEVELS = [
  { small: 10, big: 20 },
  { small: 15, big: 30 },
  { small: 25, big: 50 },
  { small: 50, big: 100 },
  { small: 75, big: 150 },
  { small: 100, big: 200 },
  { small: 150, big: 300 },
  { small: 200, big: 400 },
  { small: 300, big: 600 },
  { small: 400, big: 800 },
];
const HANDS_PER_LEVEL = 4;

class PokerGame {
  constructor(config) {
    this.mode = config.mode; // 'cash' | 'tournament'
    this.onEvent = config.onEvent || (() => {});
    this.players = config.players; // [{id,name,isHuman,chips,personality}]
    this.dealerIndex = 0;
    this.handNumber = 0;
    this.cashBlinds = { small: 10, big: 20 };
    this.tournamentLevel = 0;
    this.deck = null;
    this.board = [];
    this.pots = [];
    this.street = 'preflop';
    this.gameOver = false;
  }

  get blinds() {
    if (this.mode === 'tournament') {
      const idx = Math.min(this.tournamentLevel, TOURNAMENT_BLIND_LEVELS.length - 1);
      return TOURNAMENT_BLIND_LEVELS[idx];
    }
    return this.cashBlinds;
  }

  activePlayers() {
    return this.players.filter((p) => p.chips > 0 || p.inHandChips > 0);
  }

  eligiblePlayers() {
    return this.players.filter((p) => p.chips > 0);
  }

  startHand() {
    this.handNumber += 1;
    if (this.mode === 'tournament') {
      this.tournamentLevel = Math.floor((this.handNumber - 1) / HANDS_PER_LEVEL);
      this.tournamentLevel = Math.min(this.tournamentLevel, TOURNAMENT_BLIND_LEVELS.length - 1);
    }

    const seats = this.eligiblePlayers();
    if (seats.length < 2) {
      this.gameOver = true;
      this.onEvent('gameOver', { winner: seats[0] || null });
      return;
    }

    this.deck = new Deck();
    this.board = [];
    this.street = 'preflop';
    for (const p of this.players) {
      p.holeCards = [];
      p.folded = p.chips <= 0;
      p.allIn = false;
      p.betThisStreet = 0;
      p.totalContributed = 0;
      p.sittingOut = p.chips <= 0;
    }

    this.dealerIndex = this.handNumber === 1
      ? this.nextActiveIndexFrom(this.dealerIndex, true)
      : this.nextActiveIndexFrom(this.dealerIndex + 1, true);
    const order = this.seatOrderFrom(this.dealerIndex);
    for (const p of order) {
      p.holeCards = this.deck.drawMany(2);
    }

    this.onEvent('handStart', {
      handNumber: this.handNumber,
      blinds: this.blinds,
      dealer: this.players[this.dealerIndex].id,
    });

    this.postBlindsAndStart();
  }

  seatOrderFrom(startIdx) {
    const n = this.players.length;
    const order = [];
    for (let i = 0; i < n; i++) {
      const p = this.players[(startIdx + i) % n];
      if (!p.sittingOut) order.push(p);
    }
    return order;
  }

  nextActiveIndexFrom(idx, includeSelfIfEligible) {
    const n = this.players.length;
    const start = includeSelfIfEligible ? idx : idx + 1;
    let i = ((start % n) + n) % n;
    for (let steps = 0; steps < n; steps++) {
      const p = this.players[i];
      if (p.chips > 0) return i;
      i = (i + 1) % n;
    }
    return idx;
  }

  postBlindsAndStart() {
    const contenders = this.seatOrderFrom(this.dealerIndex);
    this.pots = [{ amount: 0, eligible: new Set(contenders.map((p) => p.id)) }];

    let sbPlayer, bbPlayer;
    if (contenders.length === 2) {
      sbPlayer = contenders[0];
      bbPlayer = contenders[1];
    } else {
      sbPlayer = contenders[1];
      bbPlayer = contenders[2];
    }
    this.postBlind(sbPlayer, this.blinds.small);
    this.postBlind(bbPlayer, this.blinds.big);

    this.currentBet = this.blinds.big;
    this.minRaise = this.blinds.big;
    this.lastAggressorId = bbPlayer.id;

    const startIdx = contenders.length === 2
      ? this.players.indexOf(sbPlayer)
      : (this.players.indexOf(bbPlayer) + 1) % this.players.length;
    this.resetToActSet();
    this.onEvent('blindsPosted', { sb: sbPlayer.id, bb: bbPlayer.id, blinds: this.blinds });

    this.actingIndex = this.nextToAct(startIdx);
    if (this.actingIndex === -1) {
      this.endStreet();
      return;
    }
    this.onEvent('actionOn', { playerId: this.currentActor().id });
  }

  // Players who still owe an action before the current betting round can close.
  resetToActSet(excludeId) {
    this.toAct = new Set(
      this.players
        .filter((p) => !p.sittingOut && !p.folded && !p.allIn && p.id !== excludeId)
        .map((p) => p.id)
    );
  }

  postBlind(player, amount) {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.betThisStreet += actual;
    player.totalContributed += actual;
    this.pots[0].amount += actual;
    if (player.chips === 0) player.allIn = true;
  }

  currentActor() {
    return this.players[this.actingIndex];
  }

  nextToAct(fromIdx) {
    const n = this.players.length;
    let i = ((fromIdx % n) + n) % n;
    for (let steps = 0; steps < n; steps++) {
      const p = this.players[i];
      if (!p.sittingOut && !p.folded && !p.allIn) return i;
      i = (i + 1) % n;
    }
    return -1;
  }

  contendersRemaining() {
    return this.players.filter((p) => !p.sittingOut && !p.folded);
  }

  legalActions() {
    const p = this.currentActor();
    const toCall = this.currentBet - p.betThisStreet;
    const canCheck = toCall <= 0;
    const maxRaiseTotal = p.chips + p.betThisStreet;
    return {
      toCall: Math.max(0, toCall),
      canCheck,
      canRaise: p.chips > toCall,
      minRaiseTotal: Math.min(this.currentBet + this.minRaise, maxRaiseTotal),
      maxRaiseTotal,
      pot: this.potTotal(),
    };
  }

  potTotal() {
    return this.pots.reduce((sum, pot) => sum + pot.amount, 0);
  }

  applyAction(playerId, action, amount) {
    const p = this.players.find((pl) => pl.id === playerId);
    if (!p || p !== this.currentActor()) return false;
    const toCall = this.currentBet - p.betThisStreet;

    if (action === 'fold') {
      p.folded = true;
      this.toAct.delete(playerId);
      this.onEvent('action', { playerId, action: 'fold' });
    } else if (action === 'check') {
      if (toCall > 0) return false;
      this.toAct.delete(playerId);
      this.onEvent('action', { playerId, action: 'check' });
    } else if (action === 'call') {
      const pay = Math.min(toCall, p.chips);
      p.chips -= pay;
      p.betThisStreet += pay;
      p.totalContributed += pay;
      this.pots[0].amount += pay;
      if (p.chips === 0) p.allIn = true;
      this.toAct.delete(playerId);
      this.onEvent('action', { playerId, action: 'call', amount: pay });
    } else if (action === 'bet' || action === 'raise') {
      const totalTarget = Math.min(amount, p.chips + p.betThisStreet);
      const raiseSize = totalTarget - this.currentBet;
      const pay = totalTarget - p.betThisStreet;
      p.chips -= pay;
      p.betThisStreet = totalTarget;
      p.totalContributed += pay;
      this.pots[0].amount += pay;
      const reopens = raiseSize > 0;
      if (reopens) this.minRaise = Math.max(this.minRaise, raiseSize);
      this.currentBet = Math.max(this.currentBet, totalTarget);
      this.lastAggressorId = p.id;
      if (p.chips === 0) p.allIn = true;
      if (reopens) {
        this.resetToActSet(playerId);
      } else {
        this.toAct.delete(playerId);
      }
      this.onEvent('action', { playerId, action, amount: pay, total: totalTarget });
    } else {
      return false;
    }

    this.advance();
    return true;
  }

  advance() {
    const remaining = this.contendersRemaining();
    if (remaining.length <= 1) {
      this.finishHandByFold(remaining[0]);
      return;
    }

    const bettingClosed = this.toAct.size === 0;
    if (!bettingClosed) {
      this.actingIndex = this.nextToAct(this.actingIndex + 1);
      if (this.actingIndex === -1) {
        this.endStreet();
        return;
      }
      this.onEvent('actionOn', { playerId: this.currentActor().id });
      return;
    }
    this.endStreet();
  }

  endStreet() {
    this.buildSidePots();
    const remaining = this.contendersRemaining();
    if (remaining.length <= 1) {
      this.finishHandByFold(remaining[0]);
      return;
    }
    const nonAllIn = remaining.filter((p) => !p.allIn);

    if (this.street === 'river' || nonAllIn.length <= 1) {
      this.runOutRemainingBoardAndShowdown();
      return;
    }

    for (const p of this.players) p.betThisStreet = 0;
    this.currentBet = 0;
    this.minRaise = this.blinds.big;

    if (this.street === 'preflop') {
      this.board.push(...this.deck.drawMany(3));
      this.street = 'flop';
    } else if (this.street === 'flop') {
      this.board.push(...this.deck.drawMany(1));
      this.street = 'turn';
    } else if (this.street === 'turn') {
      this.board.push(...this.deck.drawMany(1));
      this.street = 'river';
    }
    this.onEvent('street', { street: this.street, board: this.board.slice() });

    this.actingIndex = this.nextToAct(this.dealerIndex + 1);
    if (this.actingIndex === -1) {
      this.endStreet();
      return;
    }
    this.resetToActSet();
    this.onEvent('actionOn', { playerId: this.currentActor().id });
  }

  runOutRemainingBoardAndShowdown() {
    while (this.board.length < 5) {
      this.board.push(...this.deck.drawMany(1));
    }
    this.onEvent('street', { street: 'runout', board: this.board.slice() });
    this.showdown();
  }

  buildSidePots() {
    const contributors = this.players.filter((p) => p.totalContributed > 0);
    const levels = [...new Set(contributors.map((p) => p.totalContributed))].sort((a, b) => a - b);
    const pots = [];
    let prevLevel = 0;
    for (const level of levels) {
      const layer = level - prevLevel;
      const payers = contributors.filter((p) => p.totalContributed >= level);
      const amount = layer * payers.length;
      if (amount > 0) {
        const eligible = new Set(
          payers.filter((p) => !p.folded).map((p) => p.id)
        );
        pots.push({ amount, eligible });
      }
      prevLevel = level;
    }
    this.pots = pots.length ? pots : [{ amount: 0, eligible: new Set() }];
  }

  finishHandByFold(winner) {
    this.buildSidePots();
    const total = this.potTotal();
    if (winner) {
      winner.chips += total;
    }
    this.onEvent('handResult', {
      winners: winner ? [{ playerId: winner.id, amount: total, hand: null }] : [],
      board: this.board.slice(),
      byFold: true,
    });
    this.finalizeHand();
  }

  showdown() {
    this.buildSidePots();
    const contenders = this.contendersRemaining();
    const evals = new Map();
    for (const p of contenders) {
      evals.set(p.id, evaluateBest([...p.holeCards, ...this.board]));
    }

    const results = [];
    for (const pot of this.pots) {
      const eligibleIds = [...pot.eligible].filter((id) => evals.has(id));
      if (eligibleIds.length === 0 || pot.amount === 0) continue;
      let bestScore = null;
      let winners = [];
      for (const id of eligibleIds) {
        const ev = evals.get(id);
        const cmp = bestScore ? compareScores(ev.score, bestScore) : 1;
        if (!bestScore || cmp > 0) {
          bestScore = ev.score;
          winners = [id];
        } else if (cmp === 0) {
          winners.push(id);
        }
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      for (const id of winners) {
        const player = this.players.find((p) => p.id === id);
        let amount = share;
        if (remainder > 0) { amount += 1; remainder -= 1; }
        player.chips += amount;
        results.push({ playerId: id, amount, hand: evals.get(id).name });
      }
    }

    this.onEvent('handResult', {
      winners: results,
      board: this.board.slice(),
      showdownHands: contenders.map((p) => ({
        playerId: p.id,
        holeCards: p.holeCards,
        hand: evals.get(p.id).name,
      })),
      byFold: false,
    });
    this.finalizeHand();
  }

  finalizeHand() {
    for (const p of this.players) {
      if (p.chips <= 0) {
        p.busted = true;
      }
    }
    const survivors = this.players.filter((p) => p.chips > 0);
    this.onEvent('handEnd', {
      standings: this.players.map((p) => ({ id: p.id, chips: p.chips, busted: !!p.busted })),
    });
    if (this.mode === 'tournament' && survivors.length <= 1) {
      this.gameOver = true;
      this.onEvent('gameOver', { winner: survivors[0] || null });
    }
  }
}
