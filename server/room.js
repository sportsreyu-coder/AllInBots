// A single online table: a lobby of connected sockets, and once started, an
// authoritative PokerGame instance. Hole cards never leave the server except
// to their owner (or to everyone at a real showdown) — every broadcast is a
// per-viewer snapshot built fresh from the live game state.
const { PokerGame, BOT_PERSONALITIES, decideBotAction, pickBotNames } = require('./engine.js');
const { WebSocket } = require('ws');

const TURN_TIMEOUT_MS = 60000;
const BOT_DELAY_MIN_MS = 550;
const BOT_DELAY_MAX_MS = 900;

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class Room {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.mode = 'cash';
    this.startingChips = 1500;
    this.botFillCount = 0;
    this.players = new Map(); // playerId -> { id, name, ws, connected }
    this.game = null;
    this.started = false;
    this.awaitingNextHand = false;
    this.turnTimer = null;
  }

  get humanPlayers() {
    return [...this.players.values()];
  }

  addPlayer(id, name, ws) {
    this.players.set(id, { id, name, ws, connected: true });
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.hostId === id) {
      const next = this.humanPlayers.find((p) => p.connected) || this.humanPlayers[0];
      this.hostId = next ? next.id : null;
    }
  }

  markDisconnected(id) {
    const p = this.players.get(id);
    if (p) p.connected = false;
    if (this.hostId === id) {
      const next = this.humanPlayers.find((p2) => p2.connected);
      if (next) this.hostId = next.id;
    }
  }

  isEmpty() {
    return this.humanPlayers.every((p) => !p.connected);
  }

  destroy() {
    clearTimeout(this.turnTimer);
  }

  broadcastLobby() {
    this.broadcastRaw({
      type: 'lobby',
      code: this.code,
      hostId: this.hostId,
      mode: this.mode,
      startingChips: this.startingChips,
      botFillCount: this.botFillCount,
      started: this.started,
      players: this.humanPlayers.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    });
  }

  // Connection state (a player going offline/online) doesn't itself fire a
  // game engine event, so once a hand is underway it needs its own push —
  // otherwise other players wouldn't see a disconnect until the next action.
  broadcastPresence() {
    if (!this.game) return;
    const actor = !this.awaitingNextHand && !this.game.gameOver ? this.game.currentActor() : null;
    const activePlayerId = actor ? actor.id : null;
    for (const p of this.humanPlayers) {
      const legal = activePlayerId === p.id ? this.game.legalActions() : null;
      this.send(p.id, {
        type: 'engineEvent',
        event: 'presence',
        payload: {},
        snapshot: this.buildSnapshot(p.id, false, activePlayerId, legal),
      });
    }
  }

  broadcastRaw(msg) {
    const text = JSON.stringify(msg);
    for (const p of this.humanPlayers) {
      if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(text);
    }
  }

  send(playerId, msg) {
    const p = this.players.get(playerId);
    if (p && p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(msg));
  }

  startGame() {
    if (this.started) return;
    const players = this.humanPlayers.map((p) => ({
      id: p.id, name: p.name, isHuman: true, chips: this.startingChips,
    }));
    const personalities = shuffleArray([...BOT_PERSONALITIES]);
    const names = pickBotNames(this.botFillCount);
    for (let i = 0; i < this.botFillCount; i++) {
      const personality = personalities[i % personalities.length];
      players.push({
        id: `bot-${i}`, name: names[i], isHuman: false,
        chips: this.startingChips, personality,
      });
    }

    this.started = true;
    this.game = new PokerGame({
      mode: this.mode,
      players,
      onEvent: (type, payload) => this.handleEvent(type, payload),
    });
    this.broadcastLobby();
    this.awaitingNextHand = true;
    this.dealNextHand();
  }

  dealNextHand() {
    if (!this.game || this.game.gameOver || !this.awaitingNextHand) return;
    for (const p of this.game.players) {
      if (!p.isHuman && this.game.mode === 'cash' && p.chips <= 0) {
        p.chips = this.startingChips;
        p.busted = false;
      }
    }
    this.awaitingNextHand = false;
    this.game.startHand();
  }

  rebuy(playerId) {
    if (!this.game || this.game.mode !== 'cash') return;
    const p = this.game.players.find((pl) => pl.id === playerId && pl.isHuman);
    if (p && p.busted) {
      p.chips = this.startingChips;
      p.busted = false;
    }
  }

  applyAction(playerId, action, amount) {
    // awaitingNextHand guards the window between a hand ending and the next
    // startHand(): currentActor() still points at whoever last acted, so
    // without this a stray or malicious 'action' message in that window
    // would be replayed against already-finished hand state.
    if (!this.game || this.game.gameOver || this.awaitingNextHand) return;
    const actor = this.game.currentActor();
    if (!actor || actor.id !== playerId) return;
    clearTimeout(this.turnTimer);
    this.game.applyAction(playerId, action, amount);
  }

  handleEvent(type, payload) {
    if (type === 'handResult') this.awaitingNextHand = true;

    const revealAll = type === 'handResult' && !payload.byFold;
    let activePlayerId = null;
    if (type === 'actionOn' || type === 'action') activePlayerId = payload.playerId;

    const outPayload = type === 'gameOver' && payload.winner
      ? { winner: { id: payload.winner.id, name: payload.winner.name, isHuman: payload.winner.isHuman } }
      : payload;

    for (const p of this.humanPlayers) {
      const legal = (type === 'actionOn' && payload.playerId === p.id) ? this.game.legalActions() : null;
      this.send(p.id, {
        type: 'engineEvent',
        event: type,
        payload: outPayload,
        snapshot: this.buildSnapshot(p.id, revealAll, activePlayerId, legal),
      });
    }

    if (type === 'actionOn') this.scheduleTurn(payload.playerId);
  }

  scheduleTurn(playerId) {
    clearTimeout(this.turnTimer);
    const game = this.game;
    const player = game.players.find((p) => p.id === playerId);
    if (!player) return;

    if (!player.isHuman) {
      const delay = BOT_DELAY_MIN_MS + Math.random() * (BOT_DELAY_MAX_MS - BOT_DELAY_MIN_MS);
      this.turnTimer = setTimeout(() => this.actBot(playerId), delay);
      return;
    }

    this.turnTimer = setTimeout(() => this.actTimeout(playerId), TURN_TIMEOUT_MS);
  }

  actBot(playerId) {
    const game = this.game;
    if (!game || game.gameOver) return;
    const actor = game.currentActor();
    if (!actor || actor.id !== playerId) return;
    const legal = game.legalActions();
    const opponentsInHand = game.contendersRemaining().length - 1;
    const decision = decideBotAction(actor, actor.holeCards, game.board, {
      toCall: legal.toCall,
      pot: legal.pot,
      currentBet: game.currentBet,
      minRaiseTotal: legal.minRaiseTotal,
      maxRaiseTotal: legal.maxRaiseTotal,
      canCheck: legal.canCheck,
      street: game.street,
      opponentsInHand: Math.max(0, opponentsInHand),
      tendencies: game.tableTendencies(playerId),
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
  }

  // A human who doesn't act within TURN_TIMEOUT_MS is auto-checked/folded so a
  // slow or disconnected player never stalls the table for everyone else.
  actTimeout(playerId) {
    const game = this.game;
    if (!game || game.gameOver) return;
    const actor = game.currentActor();
    if (!actor || actor.id !== playerId) return;
    const legal = game.legalActions();
    game.applyAction(playerId, legal.canCheck ? 'check' : 'fold');
  }

  buildSnapshot(viewerId, revealAll, activePlayerId, legal) {
    const game = this.game;
    return {
      code: this.code,
      hostId: this.hostId,
      mode: game.mode,
      blinds: game.blinds,
      tournamentLevel: game.tournamentLevel,
      handNumber: game.handNumber,
      dealerIndex: game.dealerIndex,
      board: game.board,
      pot: game.potTotal(),
      street: game.street,
      gameOver: game.gameOver,
      you: viewerId,
      activePlayerId,
      legal,
      players: game.players.map((p) => {
        const showCards = p.id === viewerId || revealAll;
        const holeCards = !p.holeCards || p.holeCards.length === 0
          ? []
          : showCards ? p.holeCards : p.holeCards.map(() => ({ hidden: true }));
        return {
          id: p.id,
          name: p.name,
          isHuman: p.isHuman,
          chips: p.chips,
          holeCards,
          folded: !!p.folded,
          busted: !!p.busted,
          allIn: !!p.allIn,
          betThisStreet: p.betThisStreet || 0,
          sittingOut: !!p.sittingOut,
          connected: p.isHuman ? !!this.players.get(p.id)?.connected : true,
        };
      }),
    };
  }
}

module.exports = { Room };
