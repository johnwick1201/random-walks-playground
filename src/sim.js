// sim.js — JS ports of Duplicate-If-Late and Create-If-Late.
// Mirrors graph_walks.py / graph_walks_create.py step-for-step so that
// the downloadable Python code can be a faithful reimplementation.

import { mkRng } from './graph.js';

// Returns:
//   walkerCount[t]   — walker population at end of step t, for t in [0, T]
//   events[t-1]      — { moves: [{wid, from, to}], killed: [wid], spawned: [{wid, from, source}] }
//                      Recorded so the animation can replay each step.
//   peak             — peak walker count across the run
//   extinctAt        — t at which population went extinct, or null if it survived
export function simulate({ N, adj, adversaries, startNode, algorithm, threshold, pcreate, T, seed }) {
  const rng = mkRng(seed);
  const advs = adversaries;
  let nextWid = 0;
  const makeWalker = (node) => ({ wid: nextWid++, node, counter: 0 });

  let walkers = [makeWalker(startNode)];
  const walkerCount = [1];      // index by t (t=0 has 1 walker)
  const events = [];            // events[t-1] = step t's record
  const nodeCounter = algorithm === 'cil' ? new Array(N).fill(0) : null;
  let peak = 1;
  let extinctAt = null;

  for (let t = 1; t <= T; t++) {
    const stepEvents = { moves: [], killed: [], spawned: [] };

    // 1. Move
    for (const w of walkers) {
      const nbrs = adj[w.node];
      const from = w.node;
      const to = nbrs.length > 0
        ? nbrs[Math.floor(rng() * nbrs.length)]
        : w.node;
      w.node = to;
      if (algorithm === 'dil') w.counter += 1;
      stepEvents.moves.push({ wid: w.wid, from, to });
    }

    // 2. Kill walkers that landed on an adversary
    const survivors = [];
    for (const w of walkers) {
      if (advs.has(w.node)) stepEvents.killed.push(w.wid);
      else survivors.push(w);
    }
    walkers = survivors;

    if (algorithm === 'dil') {
      // 3. Meeting: if two or more walkers share a node, reset all their counters.
      const byNode = new Map();
      for (const w of walkers) {
        if (!byNode.has(w.node)) byNode.set(w.node, []);
        byNode.get(w.node).push(w);
      }
      for (const ws of byNode.values()) {
        if (ws.length >= 2) for (const w of ws) w.counter = 0;
      }
      // 4. Duplicate any walker whose counter exceeds the threshold.
      const newW = [];
      for (const w of walkers) {
        if (w.counter > threshold) {
          const nw = makeWalker(w.node);
          newW.push(nw);
          w.counter = 0;
          stepEvents.spawned.push({ wid: nw.wid, from: w.node, source: 'duplicate' });
        }
      }
      walkers = walkers.concat(newW);
    } else if (algorithm === 'cil') {
      // 3. Tick every node's counter.
      for (let i = 0; i < N; i++) nodeCounter[i] += 1;
      // 4. Reset counters at nodes occupied by walkers (they were "visited").
      for (const w of walkers) nodeCounter[w.node] = 0;
      // 5. Probabilistic creation at non-adversary nodes whose counter > threshold.
      const newW = [];
      for (let i = 0; i < N; i++) {
        if (advs.has(i)) continue;
        if (nodeCounter[i] > threshold && rng() < pcreate) {
          const nw = makeWalker(i);
          newW.push(nw);
          nodeCounter[i] = 0;
          stepEvents.spawned.push({ wid: nw.wid, from: i, source: 'create' });
        }
      }
      walkers = walkers.concat(newW);
    }

    events.push(stepEvents);
    walkerCount.push(walkers.length);
    peak = Math.max(peak, walkers.length);

    // Only DIL can go permanently extinct. CIL can resurrect from node-counter
    // creations even after every walker dies, so we must NOT stop simulating
    // when CIL hits zero — otherwise the plot lies (stays at 0 instead of
    // showing the population coming back).
    if (algorithm === 'dil' && walkers.length === 0 && extinctAt == null) {
      extinctAt = t;
      for (let s = t + 1; s <= T; s++) {
        walkerCount.push(0);
        events.push({ moves: [], killed: [], spawned: [] });
      }
      break;
    }
  }

  return { walkerCount, events, peak, extinctAt, T };
}
