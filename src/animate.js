// animate.js — playback of the walker simulation as colored edge trails.
// Visual style mirrors graph_walks.py: each walker's only on-screen mark is
// the edge it just traversed; on each step the old edge fades directionally
// toward the shared node while the new edge draws toward the next node.

import { computeStubLen } from './render.js';

// Walker palette — matches ManimGL's `WALKER_COLS` so colors line up with
// the existing MP4s.
export const WALKER_COLS = [
  '#fff860',  // YELLOW
  '#83c167',  // GREEN_C
  '#ff862f',  // ORANGE
  '#5cd0b3',  // TEAL
  '#d147bd',  // PINK
  '#f0ac5f',  // GOLD
  '#c55f73',  // MAROON_B
  '#a67ab0',  // PURPLE_B
  '#58c4dd',  // BLUE_C
  '#cd9575',  // LIGHT_BROWN
];

const TRANSITION_DT = 0.25;  // seconds per step at 1× speed (matches Manim)

function lerp(p1, p2, t) {
  return { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
}

export class Player {
  constructor({ graph, simResult, startNode, drawScene, onTick }) {
    this.graph = graph;
    this.sim = simResult;
    this.startNode = startNode;
    this.draw = drawScene;     // draw(state) — repaints the pane
    this.onTick = onTick;      // called every frame with current t for UI updates

    this.T = simResult.T;
    this.t = 0;                // last fully-applied step
    this.tProgress = 0;        // 0..1 fraction of next transition
    this.speed = 1;
    this.playing = false;
    this.rafId = null;

    this.walkerState = new Map();   // wid → { color, from, to }
    this.fadingTrails = new Map();  // wid → { color, from, to } (one step of fade-out)

    // Index wrap edges by normalized "min-max" key so we can detect them
    // during animation regardless of traversal direction.
    this.edgeWrap = new Map();
    for (const e of graph.edges) {
      if (e.wrap) {
        const lo = Math.min(e.u, e.v), hi = Math.max(e.u, e.v);
        this.edgeWrap.set(`${lo}-${hi}`, e.wrap);
      }
    }
    this.stubLen = computeStubLen(graph.positions, graph.N, 'playback');

    this._resetWalkers();
  }

  // For a node `node`, return the point at the far end of the stub on the
  // wrap-side facing `partner`. 'h' wraps push the leftmost node further left
  // and the rightmost node further right; 'v' similarly along y.
  _stubFar(node, partner, wrap) {
    const pNode = this.graph.positions[node];
    const pPartner = this.graph.positions[partner];
    if (wrap === 'h') {
      // node's stub points AWAY from partner along x
      const dir = pNode.x < pPartner.x ? -1 : +1;
      return { x: pNode.x + dir * this.stubLen, y: pNode.y };
    }
    // 'v'
    const dir = pNode.y < pPartner.y ? -1 : +1;
    return { x: pNode.x, y: pNode.y + dir * this.stubLen };
  }

  _wrapTypeBetween(u, v) {
    const lo = Math.min(u, v), hi = Math.max(u, v);
    return this.edgeWrap.get(`${lo}-${hi}`) || null;
  }

  _resetWalkers() {
    this.walkerState.clear();
    this.fadingTrails.clear();
    this.walkerState.set(0, {
      color: WALKER_COLS[0],
      from: null,
      to: this.startNode,
    });
  }

  // Apply step t's events (moves, kills, spawns) to walkerState.
  _applyStep(t) {
    const ev = this.sim.events[t - 1];
    // Clear last step's fading trails (they had their fade-out chance).
    this.fadingTrails.clear();
    // Moves.
    for (const m of ev.moves) {
      const w = this.walkerState.get(m.wid);
      if (w) { w.from = m.from; w.to = m.to; }
    }
    // Kills — move into fadingTrails for one more step's fade-out.
    for (const wid of ev.killed) {
      const w = this.walkerState.get(wid);
      if (w) {
        this.fadingTrails.set(wid, { color: w.color, from: w.from, to: w.to });
        this.walkerState.delete(wid);
      }
    }
    // Spawns.
    for (const sp of ev.spawned) {
      this.walkerState.set(sp.wid, {
        color: WALKER_COLS[sp.wid % WALKER_COLS.length],
        from: null,
        to: sp.from,
      });
    }
  }

  // Build the list of trail segments to draw on the current frame.
  _buildTrails() {
    const pos = this.graph.positions;
    const trails = [];

    // Are we mid-transition? If so, peek at events[t] (= step t+1) for moves.
    const nextStep = this.t + 1;
    const inTransition = nextStep <= this.T && this.tProgress > 0 && this.tProgress < 1;
    let moveMap = null;
    if (inTransition) {
      moveMap = new Map();
      for (const m of this.sim.events[nextStep - 1].moves) {
        moveMap.set(m.wid, m);
      }
    }

    for (const [wid, w] of this.walkerState) {
      const move = moveMap?.get(wid);
      const pCur = pos[w.to];
      if (move) {
        // ── Old edge fade ──
        if (w.from != null) {
          const oldWrap = this._wrapTypeBetween(w.from, w.to);
          if (oldWrap) {
            // Old wrap edge — both stubs shrink toward their anchor nodes.
            const srcFar = this._stubFar(w.from, w.to, oldWrap);
            const dstFar = this._stubFar(w.to, w.from, oldWrap);
            const k = 1 - this.tProgress;
            trails.push({ a: pos[w.from], b: lerp(pos[w.from], srcFar, k), color: w.color });
            trails.push({ a: pCur,         b: lerp(pCur, dstFar, k),         color: w.color });
          } else {
            // Old normal edge — collapse from prev toward shared node.
            trails.push({ a: lerp(pos[w.from], pCur, this.tProgress), b: pCur, color: w.color });
          }
        }
        // ── New edge draw ──
        const newWrap = this._wrapTypeBetween(w.to, move.to);
        const pNew = pos[move.to];
        if (newWrap) {
          // Two-phase wrap fill: source stub first, then destination stub.
          const srcFar = this._stubFar(w.to, move.to, newWrap);
          const dstFar = this._stubFar(move.to, w.to, newWrap);
          if (this.tProgress < 0.5) {
            const k = this.tProgress * 2;
            trails.push({ a: pCur, b: lerp(pCur, srcFar, k), color: w.color });
          } else {
            const k = (this.tProgress - 0.5) * 2;
            trails.push({ a: pCur,   b: srcFar,                      color: w.color });
            trails.push({ a: dstFar, b: lerp(dstFar, pNew, k),        color: w.color });
          }
        } else {
          trails.push({ a: pCur, b: lerp(pCur, pNew, this.tProgress), color: w.color });
        }
      } else if (w.from != null) {
        // Static between-step: full edge from from → to.
        const wrap = this._wrapTypeBetween(w.from, w.to);
        if (wrap) {
          const srcFar = this._stubFar(w.from, w.to, wrap);
          const dstFar = this._stubFar(w.to, w.from, wrap);
          trails.push({ a: pos[w.from], b: srcFar, color: w.color });
          trails.push({ a: pos[w.to],   b: dstFar, color: w.color });
        } else {
          trails.push({ a: pos[w.from], b: pCur, color: w.color });
        }
      }
      // (Newly spawned with from=null and no move yet → no segment to draw.)
    }

    // Fading kill trails: collapse over the course of the upcoming step.
    for (const [, ft] of this.fadingTrails) {
      if (ft.from == null) continue;
      const wrap = this._wrapTypeBetween(ft.from, ft.to);
      if (wrap) {
        const srcFar = this._stubFar(ft.from, ft.to, wrap);
        const dstFar = this._stubFar(ft.to, ft.from, wrap);
        const k = 1 - this.tProgress;
        trails.push({ a: pos[ft.from], b: lerp(pos[ft.from], srcFar, k), color: ft.color });
        trails.push({ a: pos[ft.to],   b: lerp(pos[ft.to],   dstFar, k), color: ft.color });
      } else {
        const a = lerp(pos[ft.from], pos[ft.to], this.tProgress);
        trails.push({ a, b: pos[ft.to], color: ft.color });
      }
    }

    return trails;
  }

  _drawFrame() {
    this.draw({ trails: this._buildTrails(), t: this.t, playing: this.playing });
    if (this.onTick) {
      this.onTick({
        t: this.t,
        tProgress: this.tProgress,
        T: this.T,
        playing: this.playing,
      });
    }
  }

  // requestAnimationFrame loop
  _tick(now) {
    if (!this.playing) return;
    const dtMs = now - this._lastFrameMs;
    this._lastFrameMs = now;
    const dtSec = dtMs / 1000;
    // Advance progress: each step takes TRANSITION_DT / speed seconds.
    this.tProgress += (dtSec * this.speed) / TRANSITION_DT;
    while (this.tProgress >= 1 && this.t < this.T) {
      this.tProgress -= 1;
      this.t += 1;
      this._applyStep(this.t);
    }
    if (this.t >= this.T) {
      this.tProgress = 0;
      this.playing = false;
    }
    this._drawFrame();
    if (this.playing) this.rafId = requestAnimationFrame((n) => this._tick(n));
  }

  // ── public controls ──
  play() {
    if (this.playing || this.t >= this.T) return;
    this.playing = true;
    this._lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame((n) => this._tick(n));
  }

  pause() {
    this.playing = false;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this._drawFrame();
  }

  setSpeed(s) {
    this.speed = s;
  }

  replay() {
    this.pause();
    this.t = 0;
    this.tProgress = 0;
    this._resetWalkers();
    this._drawFrame();
    this.play();
  }

  jumpToEnd() {
    this.pause();
    while (this.t < this.T) {
      this.t += 1;
      this._applyStep(this.t);
    }
    this.tProgress = 0;
    this._drawFrame();
  }

  // Seek to a specific step. For backward jumps we rewind to t=0 and replay;
  // for forward jumps we step from the current state. Either way the result
  // is the exact state at end-of-step targetT, with tProgress reset.
  seekTo(targetT) {
    const wasPlaying = this.playing;
    this.pause();
    targetT = Math.max(0, Math.min(this.T, Math.floor(targetT)));
    if (targetT < this.t) {
      this._resetWalkers();
      this.t = 0;
    }
    while (this.t < targetT) {
      this.t += 1;
      this._applyStep(this.t);
    }
    this.tProgress = 0;
    this._drawFrame();
    if (wasPlaying && targetT < this.T) this.play();
  }

  destroy() {
    this.pause();
  }
}
