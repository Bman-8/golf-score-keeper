// Distribute a goal score across holes by stroke index.
// holes: [{par, si}] ; goal: total strokes desired.
// Returns array of {par, si, extra, target}.
function computeTargets(holes, goal) {
  const totalPar = holes.reduce((s, h) => s + h.par, 0);
  const diff = goal - totalPar;
  const n = holes.length;
  const base = Math.trunc(diff / n);
  const rem = Math.abs(diff % n);
  // order holes hardest first (lowest SI); for negative diff remove from easiest first
  const order = holes.map((h, i) => i).sort((a, b) => holes[a].si - holes[b].si);
  if (diff < 0) order.reverse();
  const extra = holes.map(() => base);
  for (let k = 0; k < rem; k++) extra[order[k]] += diff < 0 ? -1 : 1;
  return holes.map((h, i) => ({ par: h.par, si: h.si, extra: extra[i], target: h.par + extra[i] }));
}

if (typeof module !== 'undefined') module.exports = { computeTargets };
