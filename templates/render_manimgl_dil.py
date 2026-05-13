"""
Manim render of the Duplicate-If-Late animation — auto-generated.

Generated:        {{DATE}}
Graph topology:   {{TOPOLOGY_DESC}}
Scenario:         N = {{N}}, # Pac-Mans = {{NUM_ADV}}, T = {{T}}, A = {{A}}

This script is a faithful copy of graph_walks.py with the graph, adversaries,
and starting node hardcoded to the scenario configured on the playground.
Edit SEED (or any of the tunable parameters at the top) and re-render for a
different sample.

Toroidal-graph note: wrap-around edges (3rd tuple element 'h' or 'v') are
drawn as short dashed stubs at the boundary, and a walker crossing such an
edge animates in two phases — exit one side, enter the other — instead of
slicing across the graph.

Render:
    manimgl render_manimgl_dil.py RandomWalksScene -w
    manimgl render_manimgl_dil.py RandomWalksScene -w --hd      # 1080p60
    manimgl render_manimgl_dil.py RandomWalksScene -w --uhd     # 4K
"""

from manimlib import *
import numpy as np
import random
from collections import defaultdict, deque


# ── tunable parameters (edit then re-render) ──
SEED          = {{SEED}}
T             = {{T}}
A             = {{A}}
TRANSITION_DT = 0.25

# ── scenario (hardcoded from the playground) ──
N           = {{N}}
EDGES       = [{{EDGES_PY}}]      # (u, v, wrap); wrap in {None, 'h', 'v'}
ADVERSARIES = {{ADV_PY}}
START_NODE  = {{START_NODE_PY}}


# ── headless pre-simulation to predict peak walker count + end time ──
def predict_peak_and_endtime(seed):
    rng = random.Random(seed)
    adj = {i: [] for i in range(N)}
    for e in EDGES:
        u, v = e[0], e[1]
        adj[u].append(v); adj[v].append(u)
    advs = set(ADVERSARIES)
    walkers = [{"node": START_NODE, "counter": 0}]
    peak = 1
    end_t = T
    for t in range(1, T + 1):
        for w in walkers:
            nbrs = adj[w["node"]]
            w["node"] = rng.choice(nbrs) if nbrs else w["node"]
            w["counter"] += 1
        walkers = [w for w in walkers if w["node"] not in advs]
        n2w = defaultdict(list)
        for i, w in enumerate(walkers):
            n2w[w["node"]].append(i)
        for n, idxs in n2w.items():
            if len(idxs) >= 2:
                for i in idxs:
                    walkers[i]["counter"] = 0
        new_w = []
        for w in walkers:
            if w["counter"] > A:
                new_w.append({"node": w["node"], "counter": 0})
                w["counter"] = 0
        walkers.extend(new_w)
        peak = max(peak, len(walkers))
        if not walkers:
            end_t = t
            break
    return peak, end_t


# ── colors ──
NODE_COL    = GREY_C
ADV_COL     = RED
EDGE_COL    = GREY_D
WALKER_COLS = [YELLOW, GREEN_C, ORANGE, TEAL, PINK, GOLD, MAROON_B,
               PURPLE_B, BLUE_C, LIGHT_BROWN]
PLOT_W_COL  = GREEN_C

KILL_COL  = RED
MEET_COL  = YELLOW
BIRTH_COL = GREEN_B


class RandomWalksScene(Scene):
    def construct(self):
        TRANS_DT = TRANSITION_DT
        STEP_DT  = 0.10

        random.seed(SEED)
        np.random.seed(SEED)

        self.camera.background_rgba = [0, 0, 0, 1]

        # ── grid layout (floor(sqrt(N)) cols, matches playground) ──
        cols = max(1, int(N ** 0.5))
        full_rows = N // cols
        partial = N % cols
        rows = full_rows + (1 if partial > 0 else 0)
        graph_center = LEFT * 3.4 + DOWN * 0.2
        max_extent = 4.6
        spacing = min(0.85, max_extent / max(rows - 1, cols - 1, 1))
        positions = {}
        for i in range(N):
            r = i // cols
            c = i % cols
            x = (c - (cols - 1) / 2) * spacing
            y = ((rows - 1) / 2 - r) * spacing
            positions[i] = graph_center + np.array([x, y, 0])

        node_radius          = max(0.04, min(0.15, spacing * 0.18))
        edge_highlight_width = max(2.5, min(5.5, spacing * 7.0))
        stub_len             = spacing * 0.6     # length of each boundary stub

        # ── helper: unit direction for a wrap-stub at `node` (pointing away
        #    from its wrap-partner `partner`) ──
        def stub_dir(node, wrap, partner):
            if wrap == 'h':
                # 'h': lower-col node's stub points -x, higher-col +x
                return np.array([-1.0, 0, 0]) if (node % cols) < (partner % cols) \
                    else np.array([1.0, 0, 0])
            # 'v': lower-row (visually top, in Manim larger y) stub goes +y;
            # higher-row (bottom) goes -y.
            return np.array([0, 1.0, 0]) if (node // cols) < (partner // cols) \
                else np.array([0, -1.0, 0])

        # ── graph (hardcoded) ──
        edges = EDGES
        adj = {i: [] for i in range(N)}
        for u, v, _w in edges:
            adj[u].append(v)
            adj[v].append(u)
        # Index wrap edges (by the canonical low-high tuple) so we can detect
        # them during the per-walker traversal animation.
        wrap_lookup = {}
        for u, v, w in edges:
            if w is not None:
                lo, hi = min(u, v), max(u, v)
                wrap_lookup[(lo, hi)] = w

        def get_wrap(u, v):
            lo, hi = min(u, v), max(u, v)
            return wrap_lookup.get((lo, hi))

        adversaries = set(ADVERSARIES)
        B = len(adversaries)

        # ── title (two-line: heading + descriptive parameter labels) ──
        title_main = TexText("Duplicate If Late Algorithm",
                             color=WHITE).scale(0.55)
        title_params = TexText(
            f"$N = {N}$,\\quad "
            f"\\#\\,of Pac-Mans $= {B}$,\\quad "
            f"Threshold for Duplication $= {A}$",
            color=GREY_B,
        ).scale(0.36)
        title_grp = VGroup(title_main, title_params).arrange(DOWN, buff=0.08)
        title_grp.to_edge(UP, buff=0.12)
        self.add(title_grp)

        # ── opening sequence ──

        # Step 1: nodes
        node_dots = {}
        for i in range(N):
            d = Dot(positions[i], radius=node_radius)
            d.set_fill(NODE_COL, opacity=0.9)
            d.set_stroke(width=0)
            node_dots[i] = d
        self.play(FadeIn(VGroup(*node_dots.values())), run_time=1.0)
        self.wait(0.4)

        # Step 2: edges — normal as Lines, wrap as a pair of dashed stubs
        edge_visuals = []
        for u, v, w in edges:
            if w is None:
                line = Line(positions[u], positions[v],
                            stroke_width=1.6, color=WHITE, stroke_opacity=0.90)
                edge_visuals.append(line)
            else:
                end_u = positions[u] + stub_dir(u, w, v) * stub_len
                end_v = positions[v] + stub_dir(v, w, u) * stub_len
                stub_u = DashedLine(positions[u], end_u, dash_length=0.06,
                                    stroke_width=1.6, color=WHITE, stroke_opacity=0.90)
                stub_v = DashedLine(positions[v], end_v, dash_length=0.06,
                                    stroke_width=1.6, color=WHITE, stroke_opacity=0.90)
                edge_visuals.extend([stub_u, stub_v])
        edge_lines_grp = VGroup(*edge_visuals)
        self.play(ShowCreation(edge_lines_grp), run_time=1.6)
        self.wait(0.4)

        # Step 3: adversaries morph red
        adv_transforms = []
        for i in adversaries:
            target = Dot(positions[i], radius=node_radius * 1.6)
            target.set_fill(ADV_COL, opacity=1.0)
            target.set_stroke(width=0)
            adv_transforms.append(Transform(node_dots[i], target))
        if adv_transforms:
            self.play(*adv_transforms, run_time=1.0)
        self.wait(0.5)

        # Step 4: dim edges (including wrap stubs) to a backdrop
        self.play(
            edge_lines_grp.animate.set_stroke(
                color=EDGE_COL, opacity=0.30, width=0.8),
            run_time=1.2,
        )
        self.wait(0.3)

        # ── HUD ──
        time_grp = VGroup(
            Tex("t = ", color=WHITE),
            Integer(0, color=WHITE),
        ).arrange(RIGHT, buff=0.08).scale(0.7).to_corner(UL, buff=0.4)
        self.add(time_grp)

        wcount_grp = VGroup(
            TexText("walkers: ", color=WHITE),
            Integer(1, color=WHITE),
        ).arrange(RIGHT, buff=0.08).scale(0.5)
        wcount_grp.next_to(time_grp, DOWN, aligned_edge=LEFT, buff=0.15)
        self.add(wcount_grp)

        # ── plot ──
        peak_walkers, x_max = predict_peak_and_endtime(SEED)
        y_max  = max(5, int(np.ceil(peak_walkers * 1.1)))
        y_step = max(1, y_max // 5)
        plot_x_step = max(10, x_max // 5)

        axes = Axes(
            x_range=[0, x_max, plot_x_step],
            y_range=[0, y_max, y_step],
            width=5.0,
            height=4.5,
            axis_config={"stroke_width": 1.5, "color": GREY_B},
        ).move_to(RIGHT * 3.8 + DOWN * 0.4)
        axes.add_coordinate_labels(font_size=18)
        x_label = Tex("t", color=GREY_B).scale(0.55).next_to(
            axes.x_axis.get_end(), DR, buff=0.20)
        y_label = TexText("\\#\\,walkers", color=GREY_B).scale(0.45).next_to(
            axes.y_axis.get_end(), UL, buff=0.05)
        plot_title = TexText("Walker count over time", color=WHITE).scale(0.5)
        plot_title.next_to(axes, UP, buff=0.12)

        self.play(
            ShowCreation(axes),
            Write(x_label), Write(y_label), Write(plot_title),
            run_time=1.0,
        )

        plot_pts = [(0, 1)]
        plot_line = VMobject(stroke_color=PLOT_W_COL, stroke_width=2.5)
        plot_line.set_points_as_corners([axes.c2p(0, 1), axes.c2p(0.001, 1)])
        self.add(plot_line)

        def refresh_plots():
            pts = [axes.c2p(t_, c_) for t_, c_ in plot_pts]
            if len(pts) < 2:
                pts = pts + pts
            plot_line.set_points_as_corners(pts)

        # ── walker state ──
        walkers = {}
        next_wid = [0]
        next_color_idx = [0]

        def get_next_color():
            c = WALKER_COLS[next_color_idx[0] % len(WALKER_COLS)]
            next_color_idx[0] += 1
            return c

        def make_walker(node, color=None):
            wid = next_wid[0]; next_wid[0] += 1
            if color is None:
                color = get_next_color()
            return {
                "wid": wid, "node": node, "prev_node": None,
                "color": color, "counter": 0,
                # edge_highlight: list of (line_mobject, anchor_point) tuples.
                # Single entry for normal edges; two for wrap edges. Uniform
                # fade-out handling: each line collapses toward its anchor.
                "edge_highlight": None,
            }

        start_node = START_NODE
        first_walker = make_walker(start_node)
        walkers[first_walker["wid"]] = first_walker
        self.play(
            Flash(positions[start_node], color=first_walker["color"],
                  line_length=0.32, num_lines=14, flash_radius=0.40),
            run_time=0.6,
        )
        self.wait(0.3)

        first_kill_done = [False]
        first_dup_done  = [False]

        def show_rule_with_action(text, color, action_anims,
                                  action_run_time=1.0,
                                  pre_hold=0.6, post_hold=1.4):
            rule_text = TexText(text, color=color).scale(0.50)
            rule_text.to_edge(DOWN, buff=0.6)
            box = SurroundingRectangle(rule_text, color=color,
                                       buff=0.20, stroke_width=2.5)
            self.play(Write(rule_text), ShowCreation(box), run_time=0.8)
            self.wait(pre_hold)
            if action_anims:
                self.play(*action_anims, run_time=action_run_time)
            self.wait(post_hold)
            self.play(FadeOut(rule_text), FadeOut(box), run_time=0.4)

        # ── helper: build the per-walker move animation. Normal moves use a
        # single ShowCreation Line. Wrap moves use an AnimationGroup that
        # plays source-stub then dest-stub sequentially within TRANS_DT. The
        # returned `edge_pieces` is a list of (line_mobject, anchor_point)
        # tuples that the NEXT step's fade routine consumes uniformly. ──
        def build_move_animation(w):
            p_cur = positions[w["node"]]
            p_new = positions[w["_new_node"]]
            wrap = get_wrap(w["node"], w["_new_node"])
            if wrap is None:
                new_edge = Line(p_cur, p_new,
                                stroke_width=edge_highlight_width,
                                stroke_opacity=0.85)
                new_edge.set_color(w["color"])
                return ShowCreation(new_edge), [(new_edge, p_new)]
            # Wrap: build two stubs and sequence them within one animation.
            u_far = p_cur + stub_dir(w["node"], wrap, w["_new_node"]) * stub_len
            v_far = p_new + stub_dir(w["_new_node"], wrap, w["node"]) * stub_len
            u_stub = Line(p_cur, u_far,
                          stroke_width=edge_highlight_width,
                          stroke_opacity=0.85)
            u_stub.set_color(w["color"])
            v_stub = Line(v_far, p_new,
                          stroke_width=edge_highlight_width,
                          stroke_opacity=0.85)
            v_stub.set_color(w["color"])
            anim = AnimationGroup(
                ShowCreation(u_stub),
                ShowCreation(v_stub),
                lag_ratio=1.0,
            )
            return anim, [(u_stub, p_cur), (v_stub, p_new)]

        # ── helper: fade-out targets for one walker's old edge pieces. Each
        # piece collapses to a zero-length line at its anchor point, matching
        # the directional fade convention for normal edges (and giving the
        # symmetric "stubs retract to their anchors" effect for wrap edges). ──
        def fade_anims_for(pieces, color):
            anims = []
            for line, anchor in pieces:
                target = Line(anchor, anchor + np.array([0.0001, 0, 0]))
                target.set_stroke(width=edge_highlight_width, opacity=0)
                target.set_color(color)
                anims.append(Transform(line, target))
            return anims

        # ── simulation loop ──
        for t in range(1, T + 1):
            # 1. PLAN
            for w in walkers.values():
                nbrs = adj[w["node"]]
                w["_new_node"] = random.choice(nbrs) if nbrs else w["node"]
                w["counter"] += 1

            # 2. ANIMATE TRANSITION
            transition_anims = []
            old_pieces_to_remove = []
            new_edges_pending = []
            for w in walkers.values():
                if w["edge_highlight"] is not None:
                    transition_anims.extend(fade_anims_for(w["edge_highlight"], w["color"]))
                    old_pieces_to_remove.extend(p[0] for p in w["edge_highlight"])
                move_anim, new_pieces = build_move_animation(w)
                transition_anims.append(move_anim)
                new_edges_pending.append((w, new_pieces))

            if transition_anims:
                self.play(*transition_anims, run_time=TRANS_DT)

            for piece in old_pieces_to_remove:
                self.remove(piece)

            # 3. APPLY MOVES
            for w in walkers.values():
                w["prev_node"] = w["node"]
                w["node"] = w["_new_node"]
                del w["_new_node"]
            for w, new_pieces in new_edges_pending:
                w["edge_highlight"] = new_pieces

            # 4. KILLS
            killed_wids = [wid for wid, w in walkers.items() if w["node"] in adversaries]
            killed_nodes = [walkers[wid]["node"] for wid in killed_wids]

            if killed_wids:
                killed_edges_to_remove = []

                def build_kill_anims(line_length, num_lines, flash_radius):
                    anims = []
                    for wid in killed_wids:
                        w = walkers[wid]
                        pieces = w.get("edge_highlight")
                        if pieces:
                            anims.extend(fade_anims_for(pieces, w["color"]))
                            killed_edges_to_remove.extend(p[0] for p in pieces)
                    flashes = [Flash(positions[n], color=KILL_COL,
                                     line_length=line_length,
                                     num_lines=num_lines,
                                     flash_radius=flash_radius)
                               for n in killed_nodes]
                    return anims + flashes

                if not first_kill_done[0]:
                    first_kill_done[0] = True
                    self.wait(0.4)
                    show_rule_with_action(
                        "Adversary kills any random walk incident upon it",
                        color=KILL_COL,
                        action_anims=build_kill_anims(0.32, 14, 0.45),
                        action_run_time=1.0,
                    )
                else:
                    self.play(*build_kill_anims(0.20, 10, 0.30),
                              run_time=0.4)

                for piece in killed_edges_to_remove:
                    self.remove(piece)
                for wid in killed_wids:
                    walkers.pop(wid, None)

            # 5. MEETINGS — silent: just reset counters
            node_to_w = defaultdict(list)
            for wid, w in walkers.items():
                node_to_w[w["node"]].append(wid)
            for n, wlist in node_to_w.items():
                if len(wlist) >= 2:
                    for wid in wlist:
                        walkers[wid]["counter"] = 0

            # 6. DUPLICATIONS
            dup_wids = [wid for wid, w in walkers.items() if w["counter"] > A]
            new_walkers_to_add = {}

            if dup_wids:
                if not first_dup_done[0]:
                    first_dup_done[0] = True
                    flash_anims = [Flash(positions[walkers[wid]["node"]],
                                         color=BIRTH_COL,
                                         line_length=0.32, num_lines=14,
                                         flash_radius=0.45)
                                   for wid in dup_wids]
                    for wid in dup_wids:
                        w = walkers[wid]
                        new_w = make_walker(w["node"])
                        new_walkers_to_add[new_w["wid"]] = new_w
                        w["counter"] = 0
                    show_rule_with_action(
                        "If it has been long since two walkers have crossed paths, they duplicate",
                        color=BIRTH_COL,
                        action_anims=flash_anims,
                        action_run_time=0.9,
                    )
                else:
                    flash_anims = [Flash(positions[walkers[wid]["node"]],
                                         color=BIRTH_COL,
                                         line_length=0.22, num_lines=10,
                                         flash_radius=0.35)
                                   for wid in dup_wids]
                    for wid in dup_wids:
                        w = walkers[wid]
                        new_w = make_walker(w["node"])
                        new_walkers_to_add[new_w["wid"]] = new_w
                        w["counter"] = 0
                    self.play(*flash_anims, run_time=0.4)
            walkers.update(new_walkers_to_add)

            # 7. UPDATE PLOT + HUD
            plot_pts.append((t, len(walkers)))
            refresh_plots()
            time_grp[1].set_value(t)
            wcount_grp[1].set_value(len(walkers))

            # 8. SETTLE
            self.wait(STEP_DT)

            if not walkers:
                ext_text = TexText("Population extinct", color=RED).scale(0.55)
                ext_text.to_edge(DOWN, buff=0.6)
                ext_box = SurroundingRectangle(
                    ext_text, color=RED, buff=0.20, stroke_width=2.5)
                self.play(Write(ext_text), ShowCreation(ext_box), run_time=0.8)
                self.wait(2.0)
                break

        self.wait(2.0)
