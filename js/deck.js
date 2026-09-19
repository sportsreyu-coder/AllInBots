// Card, Deck, and hole-card utilities.

const SUITS = ['s', 'h', 'd', 'c'];
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function rankLabel(rank) {
  return RANK_LABELS[rank] || String(rank);
}

function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit];
}

function isRedSuit(suit) {
  return suit === 'h' || suit === 'd';
}

function makeDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANK_ORDER) {
      cards.push({ rank, suit });
    }
  }
  return cards;
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

class Deck {
  constructor() {
    this.cards = shuffle(makeDeck());
  }

  draw() {
    if (this.cards.length === 0) throw new Error('Deck is empty');
    return this.cards.pop();
  }

  drawMany(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.draw());
    return out;
  }
}

function cardKey(card) {
  return `${rankLabel(card.rank)}${card.suit}`;
}
