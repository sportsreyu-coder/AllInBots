// Bot AI: combo-percentile preflop ranges + postflop Monte Carlo equity,
// decided against real breakeven math (pot odds, bluff-frequency formulas),
// combined with a per-bot personality that colors sizing and mix frequency
// rather than replacing the math.
//
// Each personality carries an `adaptivity` (0-1): how much it leans into
// tendencies read off the table (see adaptedPersonality() below) on top of
// its baseline dials, and a `mixNoise` multiplier on decision randomness —
// archetypes like the GTO Nerd look more "mixed strategy", tight ones like
// Rock/Nit look more deterministic. `id` is never shown in the UI — display
// names are assigned separately via pickBotNames() so a bot's play style
// isn't visible from its name.
const BOT_PERSONALITIES = [
  { id: 'nit', aggression: 0.18, tightness: 0.85, bluff: 0.02, adaptivity: 0.15, mixNoise: 0.6 },
  { id: 'callingStation', aggression: 0.15, tightness: 0.22, bluff: 0.03, adaptivity: 0.2, mixNoise: 0.8 },
  { id: 'volatileShover', aggression: 0.88, tightness: 0.32, bluff: 0.3, adaptivity: 0.7, mixNoise: 1.1 },
  { id: 'gtoNerd', aggression: 0.5, tightness: 0.55, bluff: 0.18, adaptivity: 0.08, mixNoise: 1.4 },
  { id: 'grinder', aggression: 0.42, tightness: 0.6, bluff: 0.1, adaptivity: 0.55, mixNoise: 0.9 },
  { id: 'maniac', aggression: 0.85, tightness: 0.25, bluff: 0.28, adaptivity: 0.4, mixNoise: 1.2 },
  { id: 'rock', aggression: 0.12, tightness: 0.78, bluff: 0.02, adaptivity: 0.1, mixNoise: 0.5 },
  { id: 'wildcard', aggression: 0.6, tightness: 0.38, bluff: 0.2, adaptivity: 0.45, mixNoise: 1.3 },
];

// Generic display names, unrelated to personality, so a seat's name never
// hints at how that bot plays.
const BOT_DISPLAY_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Sam', 'Drew',
  'Jamie', 'Avery', 'Quinn', 'Reese', 'Skyler', 'Rowan', 'Emerson', 'Finley',
  'Harper', 'Kendall', 'Logan', 'Parker', 'Peyton', 'Sawyer', 'Blair', 'Dakota',
];

function pickBotNames(count) {
  const pool = [...BOT_DISPLAY_NAMES];
  shuffle(pool);
  const names = [];
  for (let i = 0; i < count; i++) names.push(pool[i % pool.length]);
  return names;
}

function chenScore(c1, c2) {
  const high = c1.rank >= c2.rank ? c1 : c2;
  const low = c1.rank >= c2.rank ? c2 : c1;
  let score;
  if (high.rank === low.rank) {
    score = Math.max(5, high.rank * (high.rank >= 8 ? 1.6 : 1.3));
  } else {
    const points = { 14: 10, 13: 8, 12: 7, 11: 6 };
    score = points[high.rank] || high.rank / 2;
  }
  if (c1.suit === c2.suit && high.rank !== low.rank) score += 2;
  const gap = high.rank - low.rank - 1;
  if (high.rank !== low.rank) {
    if (gap === 0) score += 1;
    else if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else score -= 5;
    if (gap <= 1 && high.rank <= 12) score += 1;
  }
  return Math.max(0, Math.ceil(score));
}

// Maps a Chen score (roughly 0-20) to a 0..1 "premium" estimate. Kept around
// for js/solver.js, which ranks the 169 starting hands by this same score.
function preflopStrength(c1, c2) {
  const score = chenScore(c1, c2);
  return Math.max(0.02, Math.min(0.97, score / 20));
}

// All 169 starting-hand buckets ranked by Chen score and turned into a
// combo-weighted percentile (1 = AA, 0 = worst hand) — this is what lets a
// bot reason in terms of "top X% of hands", the same way real opening-range
// charts are built, instead of a raw score/20 that doesn't correspond to any
// actual share of the combo pool.
const HAND_PERCENTILES = (() => {
  const ranks = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const buckets = [];
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i; j < ranks.length; j++) {
      const hi = ranks[i];
      const lo = ranks[j];
      if (i === j) {
        buckets.push({ hi, lo, suited: false, isPair: true, combos: 6 });
      } else {
        buckets.push({ hi, lo, suited: true, isPair: false, combos: 4 });
        buckets.push({ hi, lo, suited: false, isPair: false, combos: 12 });
      }
    }
  }
  for (const b of buckets) {
    const c1 = { rank: b.hi, suit: 's' };
    const c2 = { rank: b.lo, suit: b.suited || b.isPair ? 's' : 'h' };
    b.strength = chenScore(c1, c2);
  }
  buckets.sort((a, b) => b.strength - a.strength);
  const total = buckets.reduce((sum, b) => sum + b.combos, 0); // 1326
  const map = new Map();
  let cum = 0;
  for (const b of buckets) {
    // Combo-weighted midpoint percentile: a hand's percentile is the share
    // of combos at least as strong as it, counting itself as spread evenly
    // across its own combo block rather than all-or-nothing.
    const percentile = 1 - (cum + b.combos / 2) / total;
    map.set(`${b.hi}-${b.lo}-${b.suited}-${b.isPair}`, percentile);
    cum += b.combos;
  }
  return map;
})();

function handPercentile(c1, c2) {
  const hi = Math.max(c1.rank, c2.rank);
  const lo = Math.min(c1.rank, c2.rank);
  const isPair = hi === lo;
  const suited = !isPair && c1.suit === c2.suit;
  const key = `${hi}-${lo}-${suited}-${isPair}`;
  return HAND_PERCENTILES.has(key) ? HAND_PERCENTILES.get(key) : 0.5;
}

// Roughly how wide a reasonable opening range is for a seat, as a fraction
// 0..1 of all hands by combo weight — tighter the earlier the position and
// the more players are left to act behind it, wider on the button, same
// shape standard opening-range charts use. Mirrors js/solver.js's
// baseOpenPercent() so a bot's real-hand frequencies match what the
// in-app solver teaches, just folded into a 0..1 fraction here.
function openRangeFraction(position, playersInHand) {
  const behind = Math.max(0, playersInHand - 2);
  const leftToAct = {
    early: behind,
    middle: Math.ceil(behind / 2),
    late: Math.min(behind, 2),
    button: 1,
    sb: 1,
    bb: 0,
  }[position];
  const left = leftToAct === undefined ? Math.ceil(behind / 2) : leftToAct;
  const base = 1 / (1 + left * 0.9);
  const tableFactor = 1 - (playersInHand - 2) * 0.025;
  let frac = base * tableFactor;
  if (position === 'sb') frac *= 0.8;
  if (position === 'bb') frac *= 1.3;
  return Math.max(0.04, Math.min(1, frac));
}

function buildRemainingDeck(known) {
  const knownKeys = new Set(known.map(cardKey));
  return makeDeck().filter((c) => !knownKeys.has(cardKey(c)));
}

// Monte Carlo equity estimate for holeCards vs `opponents` random hands, given board.
function estimateEquity(holeCards, board, opponents, iterations = 200) {
  if (opponents <= 0) return 1;
  const known = [...holeCards, ...board];
  const remaining = buildRemainingDeck(known);
  const cardsNeeded = 5 - board.length;
  let wins = 0;
  let ties = 0;

  for (let i = 0; i < iterations; i++) {
    const pool = remaining.slice();
    shuffle(pool);
    let idx = 0;
    const fullBoard = board.concat(pool.slice(idx, idx + cardsNeeded));
    idx += cardsNeeded;
    const myScore = evaluateBest([...holeCards, ...fullBoard]).score;

    let bestOpp = null;
    let tie = false;
    for (let o = 0; o < opponents; o++) {
      const oppHole = pool.slice(idx, idx + 2);
      idx += 2;
      const oppScore = evaluateBest([...oppHole, ...fullBoard]).score;
      if (!bestOpp || compareScores(oppScore, bestOpp) > 0) {
        bestOpp = oppScore;
        tie = false;
      } else if (compareScores(oppScore, bestOpp) === 0) {
        tie = true;
      }
    }
    const cmp = compareScores(myScore, bestOpp);
    if (cmp > 0) wins++;
    else if (cmp === 0) ties++;
  }
  return (wins + ties * 0.5) / iterations;
}

// Nudges a personality's core dials toward exploiting observed table
// tendencies (see PokerGame.tableTendencies), scaled by how willing this
// archetype is to adapt. adaptivity 0 = plays its baseline no matter what
// (the GTO Nerd barely moves); adaptivity near 1 leans hard into reads (the
// Volatile Shover swings a lot). This is deliberately light-touch — a bot
// picking up on the table, not a full exploitative solver.
function adaptedPersonality(personality, tendencies) {
  const adapt = personality.adaptivity || 0;
  if (!tendencies || adapt <= 0) {
    return { aggression: personality.aggression, tightness: personality.tightness, bluff: personality.bluff };
  }

  const foldSkew = tendencies.avgFoldToRaise - 0.5; // + = table folds a lot to raises
  const looseSkew = tendencies.avgVpip - 0.5;        // + = table plays loose preflop
  const stationy = tendencies.avgFoldToRaise < 0.35 && tendencies.avgVpip > 0.55;

  let bluffAdj = foldSkew * 0.4 * adapt;
  if (stationy) bluffAdj -= 0.15 * adapt; // calling stations punish bluffs -- cut them hard
  const aggroAdj = foldSkew * 0.3 * adapt;
  const tightAdj = -looseSkew * 0.15 * adapt;

  return {
    bluff: Math.max(0, Math.min(0.6, personality.bluff + bluffAdj)),
    aggression: Math.max(0.05, Math.min(0.95, personality.aggression + aggroAdj)),
    tightness: Math.max(0.1, Math.min(0.9, personality.tightness + tightAdj)),
  };
}

// Standard breakeven fold-frequency a (semi-)bluff needs to show a profit:
// risking `risk` chips into a pot of `pot`, with `equity` chance to still
// win if called anyway. Solves f*pot + (1-f)*(equity*(pot+2*risk)-risk) = 0
// for f; at equity=0 this collapses to the textbook risk/(risk+pot)
// pure-bluff formula.
function breakevenFoldFrequency(pot, risk, equity) {
  if (risk <= 0) return 0;
  const numerator = risk - equity * (pot + 2 * risk);
  return Math.max(0, Math.min(1, numerator / (pot + risk)));
}

// Preflop: percentile-and-position-based continuing range, with a logistic
// mix near the threshold (real ranges fray at the edge instead of being a
// hard wall) and a raise-frequency that scales with how far above the
// threshold the hand sits.
function decidePreflop(style, holeCards, ctx) {
  const { aggression, tightness, bluff } = style;
  const percentile = handPercentile(holeCards[0], holeCards[1]); // 1 = AA
  const position = ctx.position || 'middle';
  const playersInHand = Math.max(2, (ctx.opponentsInHand || 1) + 1);
  const bigBlind = ctx.bigBlind || 20;
  const isOpenOpportunity = ctx.currentBet <= bigBlind;

  let continueFrac = openRangeFraction(position, playersInHand) * (1.3 - tightness * 0.6);
  if (!isOpenOpportunity) {
    // Facing a real raise rather than just the blind: only hands that can
    // stand a raise continue, tighter still the bigger that raise was.
    const raiseSizeFrac = ctx.pot > 0 ? Math.min(1.5, ctx.toCall / Math.max(1, ctx.pot)) : 0.6;
    continueFrac *= Math.max(0.2, 0.65 - raiseSizeFrac * 0.25);
  }
  continueFrac *= 1 + bluff * 0.5; // bluffier personalities flat/open a touch wider
  continueFrac = Math.max(0.03, Math.min(1, continueFrac));

  const threshold = 1 - continueFrac;
  // Logistic mix around the cutoff instead of a hard fold/continue wall.
  const edge = (percentile - threshold) / 0.06;
  const continueChance = 1 / (1 + Math.exp(-edge * 4));
  if (Math.random() >= continueChance) {
    return ctx.toCall === 0 ? { action: 'check' } : { action: 'fold' };
  }

  const valueRaiseChance = Math.min(0.95, Math.max(0.05, (percentile - threshold) * 3 + aggression * 0.3));
  const wantsToRaise = ctx.maxRaiseTotal > ctx.currentBet && Math.random() < valueRaiseChance;
  if (wantsToRaise) {
    const sizeFrac = isOpenOpportunity ? (0.55 + aggression * 0.35) : (0.75 + aggression * 0.5);
    const total = Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round((ctx.pot + ctx.toCall) * sizeFrac));
    return { action: ctx.toCall > 0 ? 'raise' : 'bet', amount: Math.min(total, ctx.maxRaiseTotal) };
  }
  return ctx.toCall === 0 ? { action: 'check' } : { action: 'call' };
}

// Checked to (or first to act with no bet in front): bet for value at a
// frequency that climbs smoothly with equity, plus a separate bluff-bet
// gate driven by the breakeven fold-frequency formula rather than a flat
// personality dial.
function decideWhenCheckedTo(style, equity, ctx) {
  const { aggression, bluff } = style;
  const pot = ctx.pot;
  if (!(ctx.maxRaiseTotal > ctx.currentBet)) return { action: 'check' };

  const valueBetChance = Math.min(0.95, Math.max(0, (equity - 0.52) * 2.4 + aggression * 0.25));

  const sizeFrac = 0.4 + aggression * 0.5;
  const betSize = Math.max(1, Math.round(pot * sizeFrac));
  const requiredFoldFreq = breakevenFoldFrequency(pot, betSize, equity);
  const perceivedFoldEquity = ctx.tendencies ? Math.max(0.1, Math.min(0.85, 1 - ctx.tendencies.avgVpip)) : 0.5;
  const margin = perceivedFoldEquity - requiredFoldFreq;
  const bluffBetChance = margin > 0 ? Math.min(0.7, margin * 1.8 * (0.3 + bluff * 2.2)) : 0;

  if (Math.random() < valueBetChance || Math.random() < bluffBetChance) {
    const total = Math.max(ctx.minRaiseTotal, ctx.currentBet + betSize);
    return { action: 'bet', amount: Math.min(total, ctx.maxRaiseTotal) };
  }
  return { action: 'check' };
}

// Facing a bet: compare true equity to the pot odds required to call. Below
// that bar, only a raise can be correct, and then only if the breakeven
// fold-frequency math backs it; above it, always at least call, and raise
// for value at a frequency that scales with the size of the edge.
function decideFacingBet(style, equity, ctx) {
  const { aggression, tightness, bluff } = style;
  const pot = ctx.pot;
  const toCall = ctx.toCall;
  const requiredEquityToCall = (toCall / (pot + toCall)) * (1 + (tightness - 0.5) * 0.3);
  const canRaise = ctx.maxRaiseTotal > ctx.currentBet;
  const ourBetThisStreet = ctx.currentBet - toCall;

  if (equity < requiredEquityToCall) {
    if (!canRaise) return { action: 'fold' };
    const raiseTotal = Math.min(
      ctx.maxRaiseTotal,
      Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round((pot + toCall) * (0.6 + aggression * 0.5)))
    );
    const risk = raiseTotal - ourBetThisStreet;
    const requiredFoldFreq = breakevenFoldFrequency(pot, risk, equity);
    const perceivedFoldEquity = ctx.tendencies ? Math.max(0.15, Math.min(0.85, ctx.tendencies.avgFoldToRaise)) : 0.45;
    const margin = perceivedFoldEquity - requiredFoldFreq;
    const bluffRaiseChance = margin > 0 ? Math.min(0.8, margin * 2 * (0.35 + bluff * 2 + aggression * 0.3)) : 0;
    if (Math.random() < bluffRaiseChance) {
      return { action: 'raise', amount: raiseTotal };
    }
    return { action: 'fold' };
  }

  const edge = equity - requiredEquityToCall;
  const valueRaiseChance = canRaise ? Math.min(0.9, Math.max(0, (edge - 0.08) * 1.8 + aggression * 0.25)) : 0;
  if (Math.random() < valueRaiseChance) {
    const raiseTotal = Math.min(
      ctx.maxRaiseTotal,
      Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round((pot + toCall) * (0.55 + aggression * 0.5)))
    );
    return { action: 'raise', amount: raiseTotal };
  }
  return { action: 'call' };
}

// Decide a bot action. All bet-sized amounts are expressed as a TOTAL target for the
// player's betThisStreet (matching PokerGame.legalActions() / applyAction() semantics),
// not as an incremental chip amount.
// ctx = { toCall, pot, currentBet, minRaiseTotal, maxRaiseTotal, canCheck, street,
//         opponentsInHand, tendencies, position, bigBlind }
function decideBotAction(bot, holeCards, board, ctx) {
  const personality = bot.personality;
  const style = adaptedPersonality(personality, ctx.tendencies);

  if (board.length === 0) {
    return decidePreflop(style, holeCards, ctx);
  }

  const rawEquity = estimateEquity(holeCards, board, ctx.opponentsInHand, 150);
  // mixNoise jitters the *stylistic* mixing around the softer frequencies
  // (how often to bet/raise near the margin) without touching the hard
  // pot-odds gate below, so the core math stays honest while archetypes
  // still look more or less "mixed strategy".
  const noise = (Math.random() - 0.5) * 0.08 * (personality.mixNoise || 1);
  const equity = Math.max(0, Math.min(1, rawEquity + noise));

  if (ctx.toCall === 0) {
    return decideWhenCheckedTo(style, equity, ctx);
  }
  return decideFacingBet(style, equity, ctx);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BOT_PERSONALITIES, BOT_DISPLAY_NAMES, pickBotNames,
    chenScore, preflopStrength, handPercentile, openRangeFraction,
    estimateEquity, adaptedPersonality, breakevenFoldFrequency, decideBotAction,
  };
}
