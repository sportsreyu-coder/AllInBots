// 7-card hand evaluator. Returns a comparable score: higher array (lexicographic) wins.
// Score format: [handClass, tiebreak1, tiebreak2, ...]
// handClass: 8 straight flush, 7 quads, 6 full house, 5 flush, 4 straight,
//            3 trips, 2 two pair, 1 pair, 0 high card

const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

function combinations(arr, k) {
  const results = [];
  const combo = [];
  function go(start) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      go(i + 1);
      combo.pop();
    }
  }
  go(0);
  return results;
}

function evaluate5(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([rank, count]) => ({ rank: Number(rank), count }))
    .sort((a, b) => (b.count - a.count) || (b.rank - a.rank));

  let straightHigh = null;
  const uniqueRanks = [...new Set(ranks)];
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      straightHigh = uniqueRanks[0];
    } else if (uniqueRanks.join(',') === '14,5,4,3,2') {
      straightHigh = 5; // wheel: A-2-3-4-5, plays as 5-high
    }
  }

  if (straightHigh && isFlush) return [8, straightHigh];
  if (groups[0].count === 4) {
    const kicker = groups[1].rank;
    return [7, groups[0].rank, kicker];
  }
  if (groups[0].count === 3 && groups[1].count === 2) {
    return [6, groups[0].rank, groups[1].rank];
  }
  if (isFlush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].count === 3) {
    const kickers = groups.slice(1).map((g) => g.rank).sort((a, b) => b - a);
    return [3, groups[0].rank, ...kickers];
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairRanks = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
    const kicker = groups[2].rank;
    return [2, ...pairRanks, kicker];
  }
  if (groups[0].count === 2) {
    const kickers = groups.slice(1).map((g) => g.rank).sort((a, b) => b - a);
    return [1, groups[0].rank, ...kickers];
  }
  return [0, ...ranks];
}

function compareScores(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Evaluates the best 5-card hand out of 5-7 cards.
function evaluateBest(cards) {
  if (cards.length < 5) throw new Error('Need at least 5 cards');
  let best = null;
  let bestCombo = null;
  for (const combo of combinations(cards, 5)) {
    const score = evaluate5(combo);
    if (!best || compareScores(score, best) > 0) {
      best = score;
      bestCombo = combo;
    }
  }
  return { score: best, cards: bestCombo, name: HAND_NAMES[best[0]] };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HAND_NAMES, evaluate5, compareScores, evaluateBest };
}
