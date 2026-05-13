"""
Manim render of the Create-If-Late animation — auto-generated.

Generated:        {{DATE}}
Graph topology:   {{TOPOLOGY_DESC}}
Scenario:         N = {{N}}, # Pac-Mans = {{NUM_ADV}}, T = {{T}},
                  A = {{A}}, P_CREATE = {{P_CREATE}}

This script is a faithful copy of graph_walks_create.py with the graph,
adversaries, and starting node hardcoded to the scenario configured on the
playground. Edit SEED (or any of the tunable parameters at the top) and
re-render for a different sample.

Toroidal-graph note: wrap-around edges (3rd tuple element 'h' or 'v') are
drawn as short dashed stubs at the boundary, and a walker crossing such an
edge animates in two phases — exit one side, enter the other — instead of
slicing across the graph.

Render:
    manimgl render_manimgl_cil.py CreateIfLateScene -w
    manimgl render_manimgl_cil.py CreateIfLateScene -w --hd      # 1080p60
    manimgl render_manimgl_cil.py CreateIfLateScene -w --uhd     # 4K
"""

from manimlib import *
import numpy as np
import random
from collections import defaultdict, deque


# ── tunable parameters (edit then re-render) ──
SEED          = {{SEED}}
T             = {{T}}
A             = {{A}}
P_CREATE      = {{P_CREATE}}
TRANSITION_DT = 0.25

# ── scenario (hardcoded from the playground) ──
N           = {{N}}
EDGES       = [{{EDGES_PY}}]      # (u, v, wrap); wrap in {None, 'h', 'v'}
ADVERSARIES = {{ADV_PY}}
START_NODE  = {{START_NODE_PY}}


# ── headless pre-simulation: predict peak walker count for axis sizing ──
def predict_peak_walkers(seed):
    rng = random.Random(seed)
    adj = {i: [] for i in range(N)}
    for e in EDGES:
        u, v = e[0], e[1]
        adj[u].append(v); adj[v].append(u)
    advs = set(ADVERSARIES)
    walkers = [{"node": START_NODE}]
    node_counter = [0] * N
    peak = 1
    for _ in range(1, T + 1):
        for w in walkers:
            nbrs = adj[w["node"]]
            w["node"] = rng.choice(nbrs) if nbrs else w["node"]
        walkers = [w for w in walkers if w["node"] not in advs]
        for i in range(N):
            node_counter[i] += 1
        for w in walkers:
            node_counter[w["node"]] = 0
        for i in range(N):
            if i not in advs and node_counter[i] > A:
                if rng.random() < P_CREATE:
                    walkers.append({"node": i})
                    node_counter[i] = 0
        peak = max(peak, len(walkers))
    return peak


# ── colors ──
NODE_COL    = GREY_C
ADV_COL     = RED
EDGE_COL    = GREY_D
WALKER_COLS = [YELLOW, GREEN_C, ORANGE, TEAL, PINK, GOLD, MAROON_B,
               PURPLE_B, BLUE_C, LIGHT_BROWN]
PLOT_W_COL  = GREEN_C

KILL_COL  = RED
BIRTH_COL = GREEN_B


class CreateIfLateScene(Scene):
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
        stub_len             = spacing * 0.6

        # Unit direction for the wrap-stub at `node`, pointing away from `partner`.
        def stub_dir(node, wrap, partner):
            if wrap == 'h':
                return np.array([-1.0, 0, 0]) if (node % cols) < (partner % cols) \
                    else np.array([1.0, 0, 0])
            return np.array([0, 1.0, 0]) if (node // cols) < (partner // cols) \
                else np.array([0, -1.0, 0])

        # ── graph (hardcoded) ──
        edges = EDGES
        adj = {i: [] for i in range(N)}
        for u, v, _w in edges:
            adj[u].append(v)
            adj[v].append(u)
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

        # ── title (heading + 2-line subheading) ──
        title_main = TexText("Create If Late Algorithm",
                             color=WHITE).scale(0.55)
        sub_top = TexText(
            f"$N = {N}$,\\quad \\#\\,of Pac-Mans $= {B}$",
            color=GREY_B,
        ).scale(0.36)
        sub_bot = TexText(
            f"Threshold for Creation $= {A}$,\\quad "
            f"$\\mathbb{{P}}[\\text{{Creation}}\\mid"
            f"\\text{{Threshold Reached}}] = {P_CREATE}$",
            color=GREY_B,
        ).scale(0.36)
        title_grp = VGroup(title_main, sub_top, sub_bot).arrange(
            DOWN, buff=0.07)
        title_grp.to_edge(UP, buff=0.10)
        self.add(title_grp)

        # ── opening sequence (same staged reveal as duplicate-if-late) ──
        node_dots = {}
        for i in range(N):
            d = Dot(positions[i], radius=node_radius)
            d.set_fill(NODE_COL, opacity=0.9)
            d.set_stroke(width=0)
            node_dots[i] = d
        self.play(FadeIn(VGroup(*node_dots.values())), run_time=1.0)
        self.wait(0.4)

        # Edges — wrap edges become two dashed stubs at the boundary.
        edge_visuals = []
        for u, v, w in edges:
            if w is None:
                edge_visuals.append(Line(positions[u], positions[v],
                                         stroke_width=1.6, color=WHITE, stroke_opacity=0.90))
            else:
                end_u = positions[u] + stub_dir(u, w, v) * stub_len
                end_v = positions[v] + stub_dir(v, w, u) * stub_len
                edge_visuals.append(DashedLine(positions[u], end_u, dash_length=0.06,
                                               stroke_width=1.6, color=WHITE, stroke_opacity=0.90))
                edge_visuals.append(DashedLine(positions[v], end_v, dash_length=0.06,
                                               stroke_width=1.6, color=WHITE, stroke_opacity=0.90))
        edge_lines_grp = VGroup(*edge_visuals)
        self.play(ShowCreation(edge_lines_grp), run_time=1.6)
        self.wait(0.4)

        adv_transforms = []
        for i in adversaries:
            target = Dot(positions[i], radius=node_radius * 1.6)
            target.set_fill(ADV_COL, opacity=1.0)
            target.set_stroke(width=0)
            adv_transforms.append(Transform(node_dots[i], target))
        if adv_transforms:
            self.play(*adv_transforms, run_time=1.0)
        self.wait(0.5)

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
        peak_walkers = predict_peak_walkers(SEED)
        y_max  = max(5, int(np.ceil(peak_walkers * 1.1)))
        y_step = max(1, y_max // 5)
        plot_x_step = max(10, T // 5)

        axes = Axes(
            x_range=[0, T, plot_x_step],
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
        plot_title = TexText("Walker count over time",
                             color=WHITE).scale(0.5)
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

        def refresh_plot():
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
                "color": color,
                # list of (line_mobject, anchor_point); 1 entry for normal,
                # 2 entries for wrap edges.
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

        node_counter = [0] * N

        first_kill_done = [False]
        first_create_done = [False]

        def show_rule_with_action(text, color, action_anims,
                                  action_run_time=1.0,
                                  pre_hold=0.6, post_hold=1.4):
            rule_text = TexText(text, color=color).scale(0.48)
            rule_text.to_edge(DOWN, buff=0.55)
            box = SurroundingRectangle(rule_text, color=color,
                                       buff=0.20, stroke_width=2.5)
            self.play(Write(rule_text), ShowCreation(box), run_time=0.8)
            self.wait(pre_hold)
            if action_anims:
                self.play(*action_anims, run_time=action_run_time)
            self.wait(post_hold)
            self.play(FadeOut(rule_text), FadeOut(box), run_time=0.4)

        # Build the per-walker move animation. Normal moves use a single
        # ShowCreation Line; wrap moves use an AnimationGroup that plays
        # source-stub then dest-stub sequentially within TRANS_DT.
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
            u_far = p_cur + stub_dir(w["node"], wrap, w["_new_node"]) * stub_len
            v_far = p_new + stub_dir(w["_new_node"], wrap, w["node"]) * stub_len
            u_stub = Line(p_cur, u_far, stroke_width=edge_highlight_width,
                          stroke_opacity=0.85)
            u_stub.set_color(w["color"])
            v_stub = Line(v_far, p_new, stroke_width=edge_highlight_width,
                          stroke_opacity=0.85)
            v_stub.set_color(w["color"])
            anim = AnimationGroup(
                ShowCreation(u_stub),
                ShowCreation(v_stub),
                lag_ratio=1.0,
            )
            return anim, [(u_stub, p_cur), (v_stub, p_new)]

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
            killed_wids = [wid for wid, w in walkers.items()
                           if w["node"] in adversaries]
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

            # 5. UPDATE NODE COUNTERS
            for i in range(N):
                node_counter[i] += 1
            for w in walkers.values():
                node_counter[w["node"]] = 0

            # 6. CREATIONS
            create_nodes = [
                i for i in range(N)
                if i not in adversaries and node_counter[i] > A
                and random.random() < P_CREATE
            ]

            new_walkers_to_add = {}
            if create_nodes:
                if not first_create_done[0]:
                    first_create_done[0] = True
                    flash_anims = [Flash(positions[i], color=BIRTH_COL,
                                         line_length=0.32, num_lines=14,
                                         flash_radius=0.45)
                                   for i in create_nodes]
                    for i in create_nodes:
                        new_w = make_walker(i)
                        new_walkers_to_add[new_w["wid"]] = new_w
                        node_counter[i] = 0
                    show_rule_with_action(
                        "If a node has not been visited for a long time, "
                        "it spawns a new walker with probability $p$",
                        color=BIRTH_COL,
                        action_anims=flash_anims,
                        action_run_time=0.9,
                    )
                else:
                    flash_anims = [Flash(positions[i], color=BIRTH_COL,
                                         line_length=0.22, num_lines=10,
                                         flash_radius=0.35)
                                   for i in create_nodes]
                    for i in create_nodes:
                        new_w = make_walker(i)
                        new_walkers_to_add[new_w["wid"]] = new_w
                        node_counter[i] = 0
                    self.play(*flash_anims, run_time=0.4)
            walkers.update(new_walkers_to_add)

            # 7. UPDATE PLOT + HUD
            plot_pts.append((t, len(walkers)))
            refresh_plot()
            time_grp[1].set_value(t)
            wcount_grp[1].set_value(len(walkers))

            # 8. SETTLE
            self.wait(STEP_DT)

        self.wait(2.0)
