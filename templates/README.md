# Random Walks on a Graph — local render

This package renders, on your own machine, a full Manim animation of the
**{{ALGORITHM_LABEL}}** scenario you configured on the playground — the same
opening sequence (nodes fade in, edges draw, adversaries morph red, edges dim
to a backdrop), HUD, in-frame walker-count plot, rule popups, and edge-trail
walker animation as the source MP4s.

This zip ships the **ManimGL** script that matches your existing `graph_walks*.py`
files. To switch algorithms, re-export from the playground with the other
algorithm selected.

## Scenario embedded in this package

| Field | Value |
|---|---|
| Algorithm | {{ALGORITHM_LABEL}} |
| Graph topology | {{TOPOLOGY_DESC}} |
| N (nodes) | {{N}} |
| Edges | {{NUM_EDGES}} |
| Adversary nodes (1-indexed) | {{ADV_HUMAN}} |
| Starting node (1-indexed) | {{START_HUMAN}} |
| Threshold A | {{A}} |
| P_CREATE | {{P_CREATE}} |
| Time steps T | {{T}} |
| Graph seed (unused by replay) | {{SEED}} |

All of these (and a few more knobs) are exposed as variables at the top of
the render script — edit and re-run for a different sample.

## 1. System prerequisites

Manim sits on top of three external tools that pip can't install for you:

| Tool | Purpose |
|---|---|
| **ffmpeg** | encodes the final video |
| **A TeX distribution** | typesets the algorithm title |
| **cairo + pango** (Linux/Mac) | renders text glyphs |

ManimGL also needs a working **OpenGL** stack.

### macOS

```bash
brew install ffmpeg cairo pango
brew install --cask mactex-no-gui      # full TeX; or use basictex if you prefer
```

### Linux (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install ffmpeg libcairo2-dev libpango1.0-dev texlive-full
```

### Windows

1. Install **ffmpeg** ([download](https://www.gyan.dev/ffmpeg/builds/)) and add
   it to your PATH.
2. Install **MiKTeX** ([miktex.org](https://miktex.org/)) — let it install
   missing TeX packages on the fly.
3. Cairo / Pango ship inside the Manim wheel on Windows; no separate install
   needed.

## 2. Python setup

```bash
python -m venv venv
# macOS / Linux:
source venv/bin/activate
# Windows (PowerShell):
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

## 3. Render

### ManimGL

```bash
# Duplicate-If-Late
manimgl render_manimgl_dil.py RandomWalksScene -w           # default quality
manimgl render_manimgl_dil.py RandomWalksScene -w --hd      # 1080p60
manimgl render_manimgl_dil.py RandomWalksScene -w --uhd     # 4K

# Create-If-Late
manimgl render_manimgl_cil.py CreateIfLateScene -w           # default quality
manimgl render_manimgl_cil.py CreateIfLateScene -w --hd      # 1080p60
manimgl render_manimgl_cil.py CreateIfLateScene -w --uhd     # 4K
```

Output lands in `videos/<script>/<resolution>/<SceneName>.mp4`.

**4K renders can take 10× longer than HD** — use the default for tweaking
parameters, switch to `--uhd` for the final cut.

## 4. Tweaking the render

This script is a **replay, not a live simulation.** The exact run you saw in
the browser is baked in as an event log (`EVENT_MOVES` / `EVENT_KILLED` /
`EVENT_SPAWNED`), and the scenario (`N`, `EDGES`, `ADVERSARIES`, `START_NODE`)
is hardcoded to match it. **To change the graph, the adversaries, the
algorithm, or to draw a fresh random sample, re-export from the playground** —
editing those variables here would desync them from the recorded events and
the animation would break.

What you *can* safely edit, at the top of the script:

```python
TRANSITION_DT = 0.25   # seconds per step in the video — the main pacing knob
```

| Variable | Effect of editing |
|---|---|
| `TRANSITION_DT` | Speeds up / slows down the whole animation. The real tunable. |
| `WALKER_COLS`, `NODE_COL`, `ADV_COL`, … | Recolor the render. Purely cosmetic. |
| `A` (and `P_CREATE` on Create-If-Late) | Only changes the text in the on-screen title; the walk itself is fixed by the event log. |
| `PEAK_WALKERS` | Rescales the plot's y-axis. |
| `T` | Lowering it renders fewer steps (truncates the replay). Raising it past the recorded length will error — re-export with a larger T instead. |

`SEED` is carried for reference only; the replay does not use it.

To switch between Duplicate-If-Late and Create-If-Late, re-export from the
playground with the other algorithm selected — each algorithm ships its own
script (`render_manimgl_dil.py` / `render_manimgl_cil.py`).

## 5. Troubleshooting

| Error you see | Likely cause | Fix |
|---|---|---|
| `LaTeX error` / `latex not found` | TeX not installed or not on PATH | Install MacTeX / texlive-full / MiKTeX (Step 1) |
| `ffmpeg not found` | ffmpeg missing | Install ffmpeg (Step 1) |
| `ModuleNotFoundError: No module named 'manim'` | venv not activated, or pip ran in a different Python | `which python` / `where python` to confirm, then re-`pip install -r requirements.txt` |
| `pangocairo error` | Cairo/Pango missing (Linux/macOS) | `brew install cairo pango` or `apt install libcairo2-dev libpango1.0-dev` |
| Video renders but is black | Display server issue (Linux headless) | Add `--write_all` / `-q` flag; ManimGL needs `xvfb-run` if no display |

If something still doesn't work, you can sanity-check the scenario without
Manim at all: the playground's **Data (.csv)** and **Plot (.png)** exports give
you the walker-count trajectory directly, no local render required.

## Files in this package

| File | Purpose |
|---|---|
| `render_manimgl_{{ALGORITHM}}.py` | ManimGL animation script for {{ALGORITHM_LABEL}} |
| `requirements.txt` | Python dependencies |
| `README.md` | this file |
