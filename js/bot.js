// Bot AI: preflop heuristic (Chen formula) + postflop Monte Carlo equity estimate,
// combined with pot odds and a per-bot personality to pick an action.
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

// Maps a Chen score (roughly 0-20) to a 0..1 "premium" estimate.
function preflopStrength(c1, c2) {
  const score = chenScore(c1, c2);
  return Math.max(0.02, Math.min(0.97, score / 20));
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

// Decide a bot action. All bet-sized amounts are expressed as a TOTAL target for the
// player's betThisStreet (matching PokerGame.legalActions() / applyAction() semantics),
// not as an incremental chip amount.
// ctx = { toCall, pot, currentBet, minRaiseTotal, maxRaiseTotal, canCheck, street, opponentsInHand, tendencies }
function decideBotAction(bot, holeCards, board, ctx) {
  const personality = bot.personality;
  const { aggression, tightness, bluff } = adaptedPersonality(personality, ctx.tendencies);

  const equity = board.length === 0
    ? preflopStrength(holeCards[0], holeCards[1])
    : estimateEquity(holeCards, board, ctx.opponentsInHand, 150);

  const potOdds = ctx.toCall > 0 ? ctx.toCall / (ctx.pot + ctx.toCall) : 0;
  const randomFactor = (Math.random() - 0.5) * 0.12 * (personality.mixNoise || 1);
  const effectiveEquity = equity + randomFactor;
  const bluffing = Math.random() < bluff && ctx.street !== 'preflop';
  const perceivedEquity = bluffing ? Math.max(effectiveEquity, 0.75) : effectiveEquity;

  const foldThreshold = tightness * 0.55;
  const canPutMoreIn = ctx.maxRaiseTotal > ctx.currentBet;

  if (ctx.toCall === 0) {
    const wantsToBet = perceivedEquity > 0.5 + (1 - aggression) * 0.25 || bluffing;
    if (wantsToBet && canPutMoreIn) {
      const sizeFrac = 0.35 + aggression * 0.55 + Math.random() * 0.15;
      const total = Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round(ctx.pot * sizeFrac));
      return { action: 'bet', amount: Math.min(total, ctx.maxRaiseTotal) };
    }
    return { action: 'check' };
  }

  // Facing a bet.
  if (perceivedEquity + 0.02 < potOdds * (1.05 - aggression * 0.3) && !bluffing) {
    if (perceivedEquity < foldThreshold || perceivedEquity < potOdds) {
      return { action: 'fold' };
    }
  }

  const raiseChance = aggression * (0.25 + perceivedEquity * 0.5);
  if ((perceivedEquity > 0.62 || bluffing) && Math.random() < raiseChance && ctx.maxRaiseTotal > ctx.currentBet) {
    const sizeFrac = 0.5 + aggression * 0.7 + Math.random() * 0.2;
    const total = Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round((ctx.pot + ctx.toCall) * sizeFrac));
    return { action: 'raise', amount: Math.min(total, ctx.maxRaiseTotal) };
  }

  if (perceivedEquity < foldThreshold * 0.6 && ctx.toCall > ctx.pot * 0.6) {
    return { action: 'fold' };
  }

  return { action: 'call' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BOT_PERSONALITIES, BOT_DISPLAY_NAMES, pickBotNames,
    chenScore, preflopStrength, estimateEquity, adaptedPersonality, decideBotAction,
  };
}
