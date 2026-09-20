// Preflop range solver — pure computation, no DOM.
//
// What makes this different from a static GTO range chart: nothing here is
// looked up from a precomputed table. Every cell is derived live, per
// request, from four table-context inputs (players at the table, cash vs.
// tournament, stack depth, and a bluff-frequency dial the user controls
// directly) using the same Chen-formula hand-strength estimate the bots
// use (js/bot.js). Most range tools hand you a fixed GTO bluff ratio; here
// you set the target bluff frequency and the solver picks *which* hands
// fill it — favoring blockers (Ax/Kx) and backdoor equity (suited
// connectors) over the rest of the fold pile.
//
// This is a heuristic teaching tool, not a certified game-theory solve: no
// full game tree, no exact ICM payout model. It's built for directional
// answers ("what changes when the table shrinks, stacks go short, or I
// dial up my bluff frequency"), not for solved equilibrium frequencies.

const SOLVER_RANKS = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
const TOTAL_COMBOS = 1326; // 52 choose 2

function buildHandGrid() {
  const hands = [];
  for (let a = 0; a < SOLVER_RANKS.length; a++) {
    for (let b = a; b < SOLVER_RANKS.length; b++) {
      const hi = SOLVER_RANKS[a];
      const lo = SOLVER_RANKS[b];
      const isPair = a === b;
      if (isPair) {
        hands.push(makeHand(hi, lo, false, true));
      } else {
        hands.push(makeHand(hi, lo, true, false));  // suited
        hands.push(makeHand(hi, lo, false, false)); // offsuit
      }
    }
  }
  return hands;
}

function makeHand(hi, lo, suited, isPair) {
  const c1 = { rank: hi, suit: 's' };
  const c2 = { rank: lo, suit: suited || isPair ? 's' : 'h' };
  const label = isPair
    ? `${rankLabel(hi)}${rankLabel(lo)}`
    : `${rankLabel(hi)}${rankLabel(lo)}${suited ? 's' : 'o'}`;
  const combos = isPair ? 6 : suited ? 4 : 12;
  const gap = isPair ? 0 : hi - lo - 1;
  const strength = preflopStrength(c1, c2);

  // Blockers to premium value hands (AA/AK/KK etc.) make a hand a better
  // bluff: it's less likely the opponent holds the hand you're repping
  // against, and more likely they hold something that folds.
  const blockerScore = (hi === 14 ? 3 : 0) + (lo === 14 ? 3 : 0) + (hi === 13 ? 1.2 : 0) + (lo === 13 ? 1.2 : 0);
  const connectivityScore = isPair ? 0 : Math.max(0, 4 - gap) * (suited ? 1 : 0.4);
  const bluffScore = blockerScore + connectivityScore + (suited ? 1.5 : 0);

  return {
    label, hi, lo, suited, isPair, gap, combos, strength, blockerScore, bluffScore,
  };
}

const SOLVER_HANDS = buildHandGrid();

// Roughly how many players are still left to act behind a given position,
// scaled to table size — the single biggest lever on how wide an opening
// range should be.
function playersLeftToAct(position, players) {
  const behind = Math.max(0, players - 2);
  switch (position) {
    case 'early': return behind;
    case 'middle': return Math.ceil(behind / 2);
    case 'late': return Math.min(behind, 2);
    case 'button': return 1;
    case 'sb': return 1;
    case 'bb': return 0;
    default: return Math.ceil(behind / 2);
  }
}

function baseOpenPercent(players, position) {
  const left = playersLeftToAct(position, players);
  const base = 100 / (1 + left * 0.9);
  const tableFactor = 1 - (players - 2) * 0.025;
  let pct = base * tableFactor;
  if (position === 'sb') pct *= 0.8;   // first in, but out of position postflop
  if (position === 'bb') pct *= 1.25;  // already invested, getting a walk
  return Math.max(5, Math.min(100, pct));
}

// Tournament chips are worth less than their cash-game face value once
// survival matters (ICM) — this trims marginal hands from the value range,
// more aggressively the shorter the stack.
function icmFactor(gameType, stackBB) {
  if (gameType !== 'tournament') return 1;
  return 1 - Math.min(0.15, 8 / (stackBB + 10));
}

// Short stacks collapse toward push/fold: fold equity makes very wide
// shoves profitable regardless of raw hand strength.
function shortStackWiden(stackBB) {
  if (stackBB >= 20) return 1;
  return 1 + (20 - stackBB) / 14;
}

function sumCombos(hands) {
  return hands.reduce((sum, h) => sum + h.combos, 0);
}

// The main entry point: given the four table-context inputs, returns every
// hand's category (value / speculative / bluff / fold) plus summary stats.
function solveRange({ players, position, gameType, stackBB, bluffFreq }) {
  const shortStack = stackBB < 20;

  let openPct = baseOpenPercent(players, position);
  openPct *= icmFactor(gameType, stackBB);
  if (shortStack) openPct = Math.min(100, openPct * shortStackWiden(stackBB));

  const sorted = SOLVER_HANDS.slice().sort((a, b) => b.strength - a.strength);
  const included = new Set();
  let cum = 0;
  for (const h of sorted) {
    const pctSoFar = (cum / TOTAL_COMBOS) * 100;
    if (pctSoFar >= openPct) break;
    included.add(h.label);
    cum += h.combos;
  }

  // Deep-stacked, non-push/fold spots pull in speculative hands (suited
  // connectors, small/mid pairs) for their implied odds, even below the
  // raw-strength cutoff.
  const speculative = new Set();
  if (!shortStack && stackBB > 40) {
    for (const h of SOLVER_HANDS) {
      if (included.has(h.label)) continue;
      const setMiner = h.isPair && h.hi <= 8;
      const suitedConnector = h.suited && h.gap <= 1 && h.hi <= 12 && h.lo >= 5;
      if (setMiner || suitedConnector) speculative.add(h.label);
    }
  }

  const valueCombos = sumCombos(SOLVER_HANDS.filter((h) => included.has(h.label) || speculative.has(h.label)));
  const targetFreq = Math.max(0, Math.min(0.75, bluffFreq / 100));
  const targetBluffCombos = targetFreq > 0 ? (targetFreq * valueCombos) / (1 - targetFreq) : 0;

  const bluffPool = SOLVER_HANDS
    .filter((h) => !included.has(h.label) && !speculative.has(h.label))
    .sort((a, b) => b.bluffScore - a.bluffScore);

  const bluff = new Set();
  let bluffCombos = 0;
  for (const h of bluffPool) {
    if (bluffCombos >= targetBluffCombos) break;
    bluff.add(h.label);
    bluffCombos += h.combos;
  }

  const totalRangeCombos = valueCombos + bluffCombos;
  const cells = SOLVER_HANDS.map((h) => ({
    label: h.label,
    combos: h.combos,
    category: included.has(h.label) ? 'value'
      : speculative.has(h.label) ? 'speculative'
      : bluff.has(h.label) ? 'bluff'
      : 'fold',
  }));

  return {
    shortStack,
    cells,
    stats: {
      openPct,
      valuePct: (sumCombos(SOLVER_HANDS.filter((h) => included.has(h.label))) / TOTAL_COMBOS) * 100,
      speculativePct: (sumCombos(SOLVER_HANDS.filter((h) => speculative.has(h.label))) / TOTAL_COMBOS) * 100,
      bluffPct: (bluffCombos / TOTAL_COMBOS) * 100,
      totalPct: (totalRangeCombos / TOTAL_COMBOS) * 100,
      achievedBluffFreq: totalRangeCombos > 0 ? (bluffCombos / totalRangeCombos) * 100 : 0,
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SOLVER_HANDS, solveRange, SOLVER_RANKS };
}
