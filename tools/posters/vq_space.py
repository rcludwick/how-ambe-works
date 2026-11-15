"""Fallback image for vq-space (ch09): docs/assets/posters/vq-space.png.

Two views of the figure's last step, side by side, each an axonometric
view of the cube at the Corner preset (yaw -35, pitch 22). Left: the
6-bit scalar grid, with its empty cubes as hollow rings. Right: the
codebook trained from that grid, every entry used. The dots are the
figure's own synthetic cloud: this file ports the seeded generator and the
quantizers of docs/javascripts/lib/vq.js, with the same constants, and
stores coordinates as float32 as the JS does, so the counts printed here
are the counts the live figure reads out.

Generic vector quantisation on synthetic dots; no AMBE table, dimension or
bit allocation appears here.
"""

from __future__ import annotations

import math
from array import array
from pathlib import Path

CLOUD_SEED = 0x20260810
CLOUD_SIZE = 1200
CENTRES = [(-0.42, -0.18), (0.08, 0.32), (0.4, -0.28)]
SPREAD = 0.13
MASK = 0xFFFFFFFF

RHO = 0.9
ANGLE = 45
DIMS = 3
BITS = 6
YAW, PITCH = -35.0, 22.0
CATS = 8

# The 3D view's axis labels (axisLabels() in anim-vq-space-3d.js): text, point,
# anchor (Pillow: l/m/r, middle), and whether it is an end value.
AXIS_LABELS = [
    ("first number", (0, 1.14, -1.14), "mm", False),
    ("-1", (-0.75, 1.14, -1.14), "mm", True),
    ("1", (0.75, 1.14, -1.14), "mm", True),
    ("second number", (1.12, 0, 1.12), "lm", False),
    ("-1", (1.12, -0.75, 1.12), "lm", True),
    ("1", (1.12, 0.75, 1.12), "lm", True),
    ("third number", (1.12, 1.12, 0), "lm", False),
    ("-1", (1.12, 1.12, -0.75), "lm", True),
    ("1", (1.12, 1.12, 0.75), "lm", True),
]


def mulberry32(seed: int):
    a = seed & MASK

    def imul(x: int, y: int) -> int:
        return (x * y) & MASK

    def random() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & MASK
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & MASK) ^ t
        return ((t ^ (t >> 14)) & MASK) / 4294967296

    return random


def gaussian(random):
    def draw() -> float:
        r = math.sqrt(-2 * math.log(1 - random()))
        return r * math.cos(2 * math.pi * random())

    return draw


def cell_category(k: int, dims: int, bits: int) -> int:
    """cellCategory in lib/vq.js: no two touching cells share a colour."""
    m = 2 ** (bits // dims)
    q = []
    rest = k
    for _ in range(dims):
        q.insert(0, rest % m)
        rest //= m
    qx, qy = q[0], q[1]
    qz = q[2] if dims == 3 else 0
    return (2 * qx + 5 * qy + 4 * qz) % CATS


def _clamp(v: float) -> float:
    return max(-1.0, min(1.0, v))


def make_cloud(rho: float, angle_deg: float) -> array:
    g = gaussian(mulberry32(CLOUD_SEED))
    out = array("f", bytes(4 * CLOUD_SIZE * 3))
    th = angle_deg * math.pi / 180
    c, s = math.cos(th), math.sin(th)
    squeeze = 1 - rho
    for i in range(CLOUD_SIZE):
        cx, cy = CENTRES[i % 3]
        x = cx + SPREAD * g()
        y = cy + SPREAD * g()
        n = g()
        along = x * c + y * s
        across = (-x * s + y * c) * squeeze
        qx = along * c - across * s
        qy = along * s + across * c
        out[i * 3] = _clamp(qx)
        out[i * 3 + 1] = _clamp(qy)
        out[i * 3 + 2] = _clamp(0.6 * (qx + qy) * 0.5 + 0.35 * squeeze * n)
    return out


def grid_quantize(pts: array, dims: int, bits: int) -> dict:
    m = 2 ** (bits // dims)
    used = [0] * (m ** dims)
    err = 0.0
    for i in range(CLOUD_SIZE):
        cell = 0
        for j in range(dims):
            v = pts[i * 3 + j]
            q = min(m - 1, math.floor((v + 1) / 2 * m))
            err += (v - (-1 + (2 * q + 1) / m)) ** 2
            cell = cell * m + q
        used[cell] += 1
    return {"mse": err / (CLOUD_SIZE * dims), "cells": m ** dims,
            "empty": sum(1 for u in used if not u), "used": used}


def _dist2(pts: array, dims: int, i: int, cb: array, k: int) -> float:
    d = 0.0
    for j in range(dims):
        e = pts[i * 3 + j] - cb[k * dims + j]
        d += e * e
    return d


def _assign_all(pts: array, dims: int, cb: array, assign: list[int]) -> bool:
    count = len(cb) // dims
    changed = False
    for i in range(CLOUD_SIZE):
        bk, bd = 0, math.inf
        for k in range(count):
            d = _dist2(pts, dims, i, cb, k)
            if d < bd:
                bd, bk = d, k
        if assign[i] != bk:
            assign[i] = bk
            changed = True
    return changed


def grid_codebook(pts: array, dims: int, bits: int) -> dict:
    m = 2 ** (bits // dims)
    count = m ** dims
    cb = array("f", bytes(4 * count * dims))
    for k in range(count):
        rest = k
        for j in range(dims - 1, -1, -1):
            q = rest % m
            rest //= m
            cb[k * dims + j] = -1 + (2 * q + 1) / m
    assign = [0] * CLOUD_SIZE
    _assign_all(pts, dims, cb, assign)
    return {"codebook": cb, "assign": assign}


def lloyd_step(pts: array, dims: int, state: dict) -> bool:
    cb, assign = state["codebook"], state["assign"]
    count = len(cb) // dims
    sums = [0.0] * (count * dims)
    n = [0] * count
    for i in range(CLOUD_SIZE):
        k = assign[i]
        n[k] += 1
        for j in range(dims):
            sums[k * dims + j] += pts[i * 3 + j]
    for k in range(count):
        if n[k]:
            for j in range(dims):
                cb[k * dims + j] = sums[k * dims + j] / n[k]
    taken = [False] * CLOUD_SIZE
    for k in range(count):
        if n[k]:
            continue
        worst, wd = -1, -1.0
        for i in range(CLOUD_SIZE):
            if taken[i]:
                continue
            d = _dist2(pts, dims, i, cb, assign[i])
            if d > wd:
                wd, worst = d, i
        taken[worst] = True
        for j in range(dims):
            cb[k * dims + j] = pts[worst * 3 + j]
    return _assign_all(pts, dims, cb, assign)


def train(pts: array, dims: int, state: dict, max_steps: int = 20) -> int:
    steps = 0
    while steps < max_steps:
        steps += 1
        if not lloyd_step(pts, dims, state):
            break
    return steps


def codebook_stats(pts: array, dims: int, state: dict) -> dict:
    count = len(state["codebook"]) // dims
    n = [0] * count
    err = 0.0
    for i in range(CLOUD_SIZE):
        k = state["assign"][i]
        n[k] += 1
        err += _dist2(pts, dims, i, state["codebook"], k)
    return {"mse": err / (CLOUD_SIZE * dims), "cells": count, "used": sum(1 for c in n if c)}


def _basis(yaw: float, pitch: float):
    """Screen right, screen up and the view direction, for an orthographic
    camera at (yaw, pitch) looking at the origin, as lib/orbit.js places it."""
    y, p = math.radians(yaw), math.radians(pitch)
    back = (math.cos(p) * math.sin(y), math.sin(p), math.cos(p) * math.cos(y))
    right = (back[2], 0.0, -back[0])
    norm = math.hypot(right[0], right[2])
    right = (right[0] / norm, 0.0, right[2] / norm)
    up = (back[1] * right[2] - back[2] * right[1],
          back[2] * right[0] - back[0] * right[2],
          back[0] * right[1] - back[1] * right[0])
    return right, up, back


def draw(poster, data_dir: Path) -> None:
    del data_dir  # synthetic: the poster reads no data file
    pts = make_cloud(RHO, ANGLE)
    grid = grid_quantize(pts, DIMS, BITS)
    start = grid_codebook(pts, DIMS, BITS)
    book = grid_codebook(pts, DIMS, BITS)
    train(pts, DIMS, book)
    stats = codebook_stats(pts, DIMS, book)

    right, up, back = _basis(YAW, PITCH)
    half = 250  # cube half-diagonal fits in a 560 px panel

    def project(centre, p):
        x = sum(a * b for a, b in zip(p, right))
        y = sum(a * b for a, b in zip(p, up))
        return (centre[0] + x * half * 0.62, centre[1] - y * half * 0.62)

    def depth(p):
        return sum(a * b for a, b in zip(p, back))

    corners = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    edges = [(a, b) for a in corners for b in corners
             if a < b and sum(1 for u, v in zip(a, b) if u != v) == 1]
    point = [(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]) for i in range(CLOUD_SIZE)]
    order = sorted(range(CLOUD_SIZE), key=lambda i: depth(point[i]))

    panels = [
        ((310, 380), f"Grid: {grid['empty']} of {grid['cells']} cubes empty", start),
        ((880, 380), f"Codebook: {stats['used']} of {stats['cells']} used", book),
    ]
    for centre, title, state in panels:
        for a, b in edges:
            poster.line([project(centre, a), project(centre, b)], "--ambe-plot-axis", width=1)
        cb = state["codebook"]
        if state is start:
            for k in range(grid["cells"]):
                if grid["used"][k]:
                    continue
                x, y = project(centre, cb[k * 3:k * 3 + 3])
                poster.draw.ellipse((x - 5, y - 5, x + 5, y + 5),
                                    outline=poster.colour("--ambe-plot-muted"), width=2)
        for i in order:
            cat = cell_category(state["assign"][i], DIMS, BITS)
            poster.dot(project(centre, point[i]), 2.2, f"--ambe-cat-{cat + 1}")
        used = set(state["assign"])
        for k in sorted(used, key=lambda k: depth(cb[k * 3:k * 3 + 3])):
            poster.dot(project(centre, cb[k * 3:k * 3 + 3]), 3, "--ambe-plot-ink")
        poster.text((centre[0] - 270, 40), title, 30, "--ambe-text", weight="semibold")
        for text, at, anchor, tick in AXIS_LABELS:
            poster.draw.text(project(centre, at), text, anchor=anchor,
                             font=poster.font(18 if tick else 20),
                             fill=poster.colour("--ambe-text-4" if tick else "--ambe-text-3"))

    poster.rect((40, 664, 168, 696), "--ambe-accent-warm-soft")
    poster.text((50, 666), "synthetic", 22, "--ambe-accent-warm", weight="semibold")
    # The figcaption under the image says where the data comes from.
    poster.text((184, 666), "Dots are coloured by the entry each one is sent as.", 22, "--ambe-text-3")
