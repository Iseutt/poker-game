function getCombinations(arr, k) {
  const result = [];
  function bt(start, combo) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      bt(i + 1, combo);
      combo.pop();
    }
  }
  bt(0, []);
  return result;
}

function checkStraight(sortedVals) {
  // Normal straight
  let ok = true;
  for (let i = 0; i < 4; i++) {
    if (sortedVals[i] - sortedVals[i + 1] !== 1) { ok = false; break; }
  }
  if (ok) return true;
  // Wheel: A-2-3-4-5
  if (sortedVals[0] === 14 && sortedVals[1] === 5 && sortedVals[2] === 4 &&
      sortedVals[3] === 3 && sortedVals[4] === 2) return true;
  return false;
}

function makeScore(handType, tiebreakers) {
  let score = handType * Math.pow(15, 5);
  for (let i = 0; i < tiebreakers.length && i < 5; i++) {
    score += tiebreakers[i] * Math.pow(15, 4 - i);
  }
  return score;
}

function evalFive(cards) {
  const sorted = [...cards].sort((a, b) => b.getValue() - a.getValue());
  const vals = sorted.map(c => c.getValue());
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(vals);

  const freq = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const groups = Object.entries(freq)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(e => ({ val: +e[0], cnt: e[1] }));
  const counts = groups.map(g => g.cnt);
  const tiebreakers = groups.map(g => g.val);

  if (isFlush && isStraight) {
    const isRoyal = vals[0] === 14 && vals[1] === 13;
    return { score: makeScore(8, tiebreakers), name: isRoyal ? 'Royal Flush' : 'Straight Flush', cards };
  }
  if (counts[0] === 4) return { score: makeScore(7, tiebreakers), name: 'Four of a Kind', cards };
  if (counts[0] === 3 && counts[1] === 2) return { score: makeScore(6, tiebreakers), name: 'Full House', cards };
  if (isFlush) return { score: makeScore(5, tiebreakers), name: 'Flush', cards };
  if (isStraight) return { score: makeScore(4, tiebreakers), name: 'Straight', cards };
  if (counts[0] === 3) return { score: makeScore(3, tiebreakers), name: 'Three of a Kind', cards };
  if (counts[0] === 2 && counts[1] === 2) return { score: makeScore(2, tiebreakers), name: 'Two Pair', cards };
  if (counts[0] === 2) return { score: makeScore(1, tiebreakers), name: 'One Pair', cards };
  return { score: makeScore(0, tiebreakers), name: 'High Card', cards };
}

function evaluate(holeCards, communityCards) {
  const all = [...holeCards, ...communityCards];
  if (all.length < 5) return null;
  const combos = getCombinations(all, 5);
  let best = null;
  for (const combo of combos) {
    const result = evalFive(combo);
    if (!best || result.score > best.score) best = result;
  }
  return best;
}

module.exports = { evaluate };
