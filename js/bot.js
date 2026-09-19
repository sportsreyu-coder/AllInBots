// Bot AI: preflop heuristic (Chen formula) + postflop Monte Carlo equity estimate,
// combined with pot odds and a per-bot personality to pick an action.

const BOT_PERSONALITIES = [
  { name: 'Rock', aggression: 0.15, tightness: 0.72, bluff: 0.03 },
  { name: 'Shark', aggression: 0.55, tightness: 0.55, bluff: 0.14 },
  { name: 'Maniac', aggression: 0.85, tightness: 0.28, bluff: 0.28 },
  { name: 'Calling Station', aggression: 0.2, tightness: 0.3, bluff: 0.02 },
  { name: 'Grinder', aggression: 0.4, tightness: 0.6, bluff: 0.09 },
  { name: 'Wildcard', aggression: 0.65, tightness: 0.4, bluff: 0.2 },
];

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

// Decide a bot action. All bet-sized amounts are expressed as a TOTAL target for the
// player's betThisStreet (matching PokerGame.legalActions() / applyAction() semantics),
// not as an incremental chip amount.
// ctx = { toCall, pot, currentBet, minRaiseTotal, maxRaiseTotal, canCheck, street, opponentsInHand }
function decideBotAction(bot, holeCards, board, ctx) {
  const personality = bot.personality;
  const equity = board.length === 0
    ? preflopStrength(holeCards[0], holeCards[1])
    : estimateEquity(holeCards, board, ctx.opponentsInHand, 150);

  const potOdds = ctx.toCall > 0 ? ctx.toCall / (ctx.pot + ctx.toCall) : 0;
  const randomFactor = (Math.random() - 0.5) * 0.12;
  const effectiveEquity = equity + randomFactor;
  const bluffing = Math.random() < personality.bluff && ctx.street !== 'preflop';
  const perceivedEquity = bluffing ? Math.max(effectiveEquity, 0.75) : effectiveEquity;

  const foldThreshold = personality.tightness * 0.55;
  const canPutMoreIn = ctx.maxRaiseTotal > ctx.currentBet;

  if (ctx.toCall === 0) {
    const wantsToBet = perceivedEquity > 0.5 + (1 - personality.aggression) * 0.25 || bluffing;
    if (wantsToBet && canPutMoreIn) {
      const sizeFrac = 0.35 + personality.aggression * 0.55 + Math.random() * 0.15;
      const total = Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round(ctx.pot * sizeFrac));
      return { action: 'bet', amount: Math.min(total, ctx.maxRaiseTotal) };
    }
    return { action: 'check' };
  }

  // Facing a bet.
  if (perceivedEquity + 0.02 < potOdds * (1.05 - personality.aggression * 0.3) && !bluffing) {
    if (perceivedEquity < foldThreshold || perceivedEquity < potOdds) {
      return { action: 'fold' };
    }
  }

  const raiseChance = personality.aggression * (0.25 + perceivedEquity * 0.5);
  if ((perceivedEquity > 0.62 || bluffing) && Math.random() < raiseChance && ctx.maxRaiseTotal > ctx.currentBet) {
    const sizeFrac = 0.5 + personality.aggression * 0.7 + Math.random() * 0.2;
    const total = Math.max(ctx.minRaiseTotal, ctx.currentBet + Math.round((ctx.pot + ctx.toCall) * sizeFrac));
    return { action: 'raise', amount: Math.min(total, ctx.maxRaiseTotal) };
  }

  if (perceivedEquity < foldThreshold * 0.6 && ctx.toCall > ctx.pot * 0.6) {
    return { action: 'fold' };
  }

  return { action: 'call' };
}
