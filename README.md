# Random Walks on Graphs — Playground

An interactive web playground for the **Duplicate-If-Late** and **Create-If-Late**
random walk algorithms on graphs with adversarial ("Pac-Man") nodes.

## What it does

- Choose a graph: grid, toroidal grid (with wrap-around stubs), or random
  Erdős–Rényi `G(n, p)`. Or upload your own as GraphML.
- Pick adversarial nodes (manually or randomly with a seed), a starting node
  (manually, randomly, or farthest from adversaries), an algorithm and its
  threshold, and a number of time steps.
- Click **Simulate** to see:
  - the walker-count vs. time plot (bottom right),
  - a per-step animation of walker trails on the graph (top right), with
    play / pause / replay / jump-to-end / speed / scrubbable progress bar.
- Export:
  - the **graph** as GraphML (round-trip importable),
  - the **plot** as PNG (high-resolution),
  - the **data** as CSV (`t, walker_count` per row),
  - a **Manim render package** as a `.zip` — a faithful copy of the source
    `graph_walks.py` / `graph_walks_create.py` with your scenario hardcoded,
    renders a publication-quality MP4 locally.

## Running locally

Static site — any HTTP server works. Simplest:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000/>.

## Code layout

| File / dir | Purpose |
|---|---|
| `index.html`     | Single-page UI |
| `styles.css`     | Dark theme |
| `src/main.js`    | UI wiring + validation + state |
| `src/graph.js`   | Grid / toroidal / Erdős–Rényi generators + seeded PRNG |
| `src/graphml.js` | GraphML import / export |
| `src/render.js`  | Canvas drawing (graph view + walker trails) |
| `src/sim.js`     | JS port of both algorithms |
| `src/animate.js` | Playback engine with seek-to-t scrubbing |
| `src/plot.js`    | Walker-count chart |
| `src/export.js`  | Code generation + download triggers |
| `src/zip.js`     | Minimal stored-only ZIP encoder |
| `templates/`     | Manim render scripts + README for the export zip |
