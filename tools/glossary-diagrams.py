#!/usr/bin/env python3
"""Draw the glossary's small diagrams as inline SVG.

Each diagram sits in a page of PAGES (the glossary, and a few chapters) between
`<!-- diagram: NAME -->` and `<!-- end diagram -->`. This script rewrites
what is between the markers, so edit the drawing here, not in the page.
The SVGs use classes styled in extra.css (.gloss-diagram), so they follow
the light and dark themes and print in ink.

    uv run python tools/glossary-diagrams.py          # rewrite the page
    uv run python tools/glossary-diagrams.py --check  # fail if out of date
"""

from __future__ import annotations

import html
import math
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
PAGES = [DOCS / "18-glossary.md", DOCS / "02-fourier-and-the-dft.md", DOCS / "03-windows-and-frames.md", DOCS / "04-phase.md"]
W, H = 640, 200


def path(points: list[tuple[float, float]]) -> str:
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)


def line(points, cls="gd-a"):
    return f'<path class="{cls}" d="{path(points)}"/>'


def text(x, y, s, cls="gd-label", anchor="start"):
    return f'<text class="{cls}" x="{x:.0f}" y="{y:.0f}" text-anchor="{anchor}">{s}</text>'


def axis(y, x0=40, x1=620):
    return f'<path class="gd-axis" d="M{x0},{y} L{x1},{y}"/>'


def wave(f, x0=40, x1=620, y0=100, amp=60, phase=0.0, n=400, shape=None):
    pts = []
    for i in range(n + 1):
        t = i / n
        v = shape(t) if shape else math.sin(2 * math.pi * f * t + phase)
        pts.append((x0 + (x1 - x0) * t, y0 - amp * v))
    return pts


def voice(t):
    # A pulse-like voiced waveform: a fundamental plus a few harmonics.
    return sum(math.sin(2 * math.pi * 4 * k * t) / k for k in range(1, 6)) / 1.6


def svg(name, label, body, height=H):
    return (
        f'<svg class="gloss-diagram__svg" viewBox="0 0 {W} {height}" role="img" aria-label="{html.escape(label)}">'
        + "".join(body)
        + "</svg>"
    )


def figure(name, label, caption, body, height=H):
    return (
        f'<figure class="gloss-diagram" data-diagram="{name}">\n'
        + svg(name, label, body, height)
        + f"\n<figcaption>{caption}</figcaption>\n</figure>"
    )


# --- the diagrams ----------------------------------------------------------


def pitch_period():
    pts = wave(0, shape=voice)
    # voice() repeats every quarter of the width; mark two neighbouring peaks.
    t0 = max((i / 1000 for i in range(250)), key=voice)
    x_a, x_b = 40 + 580 * t0, 40 + 580 * (t0 + 0.25)
    return figure(
        "pitch-period",
        "A voiced waveform repeating four times, with one repeat marked as the pitch period P.",
        "A vowel repeats. The length of one repeat is the pitch period <i>P</i>, and the number of repeats in a second is <i>f</i><sub>0</sub>.",
        [axis(100), line(pts),
         f'<path class="gd-mark" d="M{x_a:.1f},30 L{x_a:.1f},170 M{x_b:.1f},30 L{x_b:.1f},170"/>',
         f'<path class="gd-b" d="M{x_a:.1f},24 L{x_b:.1f},24"/>',
         text((x_a + x_b) / 2, 18, "one pitch period, <tspan font-style=\"italic\">P</tspan>", "gd-label gd-label--b", "middle")],
    )


def comb(x0, x1, y0, n, height, cls="gd-a"):
    out = []
    for k in range(1, n + 1):
        x = x0 + (x1 - x0) * k / (n + 1)
        out.append(f'<path class="{cls}" d="M{x:.1f},{y0} L{x:.1f},{y0 - height(k):.1f}"/>')
    return out


def harmonic():
    # Left: the pitch's sine wave and the waves two and three times as fast,
    # one per row. Right: the same three as spikes on a spectrum, in the
    # same colours, at f0, 2f0 and 3f0.
    rows = [(1, "gd-a", "gd-label--a", "<tspan font-style=\"italic\">f</tspan>₀", 1.0),
            (2, "gd-b", "gd-label--b", "2<tspan font-style=\"italic\">f</tspan>₀", 0.7),
            (3, "gd-c", "gd-label--c", "3<tspan font-style=\"italic\">f</tspan>₀", 0.5)]
    body = []
    for i, (k, cls, lab, name, amp) in enumerate(rows):
        y0 = 45 + i * 70
        body += [axis(y0, 54, 380), line(wave(2 * k, x0=54, x1=380, y0=y0, amp=26 * amp), cls),
                 text(36, y0 + 5, name, f"gd-label {lab}", "end")]
    base, x0, x1 = 230, 430, 620
    body.append(axis(base, x0, x1))
    for k, cls, lab, name, amp in rows:
        x = x0 + (x1 - x0) * k / 3.6
        body += [f'<path class="{cls} gd-bar" d="M{x:.1f},{base} L{x:.1f},{base - 170 * amp:.1f}"/>',
                 text(x, base + 22, name, f"gd-label {lab}", "middle")]
    body.append(text((x0 + x1) / 2, 18, "spectrum", "gd-label", "middle"))
    body.append(text(210, 270, "time →", "gd-label", "middle"))
    body.append(text((x0 + x1) / 2, 274, "frequency →", "gd-label", "middle"))
    return figure(
        "harmonic",
        "Three sine waves: the pitch f0, and waves exactly two and three times as fast. Beside them, a spectrum with one spike for each, at f0, 2f0 and 3f0.",
        "A harmonic is a sine wave at a whole-number multiple of the pitch. The 2<i>f</i><sub>0</sub> wave fits exactly two cycles into each cycle of <i>f</i><sub>0</sub>. On a spectrum the harmonics are evenly spaced spikes.",
        body, height=285,
    )


def envelope_curve(t):
    return 0.35 + 0.5 * math.exp(-((t - 0.2) / 0.08) ** 2) + 0.35 * math.exp(-((t - 0.55) / 0.1) ** 2)


def formant():
    # One made-up vowel envelope (solid) with its three peaks named, the
    # harmonics of a 150 Hz voice under it, and a second made-up vowel
    # (dashed) at the same pitch with its peaks elsewhere. Illustrative
    # shapes, not measurements.
    x0, x1, base, top = 80, 620, 200, 40
    hz = lambda f: x0 + (x1 - x0) * f / 4000

    def env(peaks):
        return lambda f: 0.08 + sum(g / (1 + ((f - c) / w) ** 2) for c, w, g in peaks)

    one = env([(600, 160, 0.92), (1150, 200, 0.6), (2500, 260, 0.32)])
    other = env([(300, 120, 0.85), (2200, 220, 0.55), (3000, 260, 0.38)])
    y = lambda v: base - (base - top) * v
    stems = [line([(hz(f), base), (hz(f), y(one(f)))], "gd-a") for f in range(150, 4000, 150)]
    curve = lambda e: [(hz(f), y(e(f))) for f in range(0, 4001, 20)]
    labels = [text(hz(f), y(one(f)) - 10, name, "gd-label gd-label--a", "middle")
              for f, name in ((600, "F1"), (1150, "F2"), (2500, "F3"))]
    xticks = [(hz(f), str(f // 1000)) for f in range(0, 4001, 1000)]
    ticks = []
    for x, s_ in xticks:
        ticks += [line([(x, base), (x, base + 6)], "gd-axis"), text(x, base + 24, s_, "gd-label", "middle")]
    return figure(
        "formant",
        "A spectrum from 0 to 4 kilohertz. Harmonic stems sit under a solid curve with three peaks, labelled F1, F2 and F3. A dashed curve for a second vowel has its peaks at different frequencies.",
        "The solid curve is the spectral envelope of one vowel. Its three peaks are its formants F1, F2 and F3. "
        "The dashed curve is another vowel at the same pitch. Its harmonics fall in the same places, but its peaks do not. "
        "Both curves are illustrative shapes.",
        [axis(base, x0, x1), *ticks, *stems, line(curve(one), "gd-a"), line(curve(other), "gd-b gd-dash"), *labels,
         text(hz(3000), y(other(3000)) - 12, "another vowel", "gd-label gd-label--b", "middle"),
         f'<text class="gd-label" x="30" y="{(base + top) / 2}" text-anchor="middle" transform="rotate(-90 30 {(base + top) / 2})">level</text>',
         text((x0 + x1) / 2, base + 48, "frequency in kHz →", "gd-label", "middle")],
        height=base + 56,
    )


def voiced_unvoiced():
    # Two rows on one time axis: voice() repeats every quarter of the
    # width; the noise below is seeded, so the page never changes on a
    # rebuild.
    import random
    rng = random.Random(7)
    noise = [rng.uniform(-1, 1) for _ in range(301)]
    x0, x1 = 110, 620
    up, down = 70, 180
    voiced = wave(0, x0, x1, up, 40, shape=voice)
    hiss = [(x0 + (x1 - x0) * i / 300, down - 32 * v) for i, v in enumerate(noise)]
    t0 = max((i / 1000 for i in range(250)), key=voice)
    peaks = [line([(x0 + (x1 - x0) * (t0 + k * 0.25), up - 52), (x0 + (x1 - x0) * (t0 + k * 0.25), up + 46)], "gd-mark gd-dash")
             for k in range(4)]
    return figure(
        "voiced-unvoiced",
        "Two waveforms against time. The top one, voiced, is the same pulse repeating at a steady spacing. The bottom one, unvoiced, is random noise with no repeating shape.",
        "Above, voiced speech. The same pulse comes round once every pitch period, marked by the dashed lines. "
        "Below, unvoiced speech. Turbulent air makes random hiss, and no stretch of it repeats.",
        [axis(up, x0, x1), axis(down, x0, x1), *peaks, line(voiced), line(hiss, "gd-b"),
         text(x0 - 14, up + 5, "voiced", "gd-label gd-label--a", "end"),
         text(x0 - 14, down + 5, "unvoiced", "gd-label gd-label--b", "end"),
         text((x0 + x1) / 2, 248, "time →", "gd-label", "middle")],
        height=256,
    )


def spectral_envelope():
    n = 18
    stems = comb(40, 620, 170, n, lambda k: 130 * envelope_curve(k / (n + 1)))
    curve = [(40 + 580 * t, 170 - 130 * envelope_curve(t)) for t in [i / 200 for i in range(201)]]
    return figure(
        "spectral-envelope",
        "Harmonic stems whose tops follow a smooth curve with two peaks, the spectral envelope.",
        "The envelope is the smooth curve over the harmonics' tops. Its peaks are the formants.",
        [axis(170), *stems, line(curve, "gd-b gd-dash"), text(150, 30, "envelope", "gd-label gd-label--b", "middle"),
         text(330, 192, "frequency →", "gd-label", "middle")],
    )


# A 2D graph: amplitude up the side, time along the bottom, zero in the
# middle. GX0..GX1 is the plot's width, GY0 its zero line, GA one unit.
GX0, GX1, GY0, GA, GH = 80, 620, 110, 70, 262


def graph(xticks=(), yticks=((1, "+1"), (0, "0"), (-1, "−1")), x1=GX1, xlabel="time →"):
    out = [f'<path class="gd-grid" d="M{GX0},{GY0 - GA * v:.1f} L{x1},{GY0 - GA * v:.1f}"/>' for v, _ in yticks if v]
    out += [axis(GY0, GX0, x1), f'<path class="gd-axis" d="M{GX0},{GY0 - GA - 20} L{GX0},{GY0 + GA + 20}"/>']
    for v, s in yticks:
        y = GY0 - GA * v
        out += [line([(GX0 - 6, y), (GX0, y)], "gd-axis"), text(GX0 - 10, y + 5, s, "gd-label", "end")]
    for x, s in xticks:
        out += [line([(x, GY0 + GA + 20), (x, GY0 + GA + 26)], "gd-axis"), text(x, GY0 + GA + 44, s, "gd-label", "middle")]
    out.append(f'<text class="gd-label" x="24" y="{GY0}" text-anchor="middle" transform="rotate(-90 24 {GY0})">amplitude</text>')
    # With no tick labels, the axis title moves up into their place.
    out.append(text((GX0 + x1) / 2, GH - 6 if xticks else GY0 + GA + 44, xlabel, "gd-label", "middle"))
    return out


def amplitude():
    # The waves stop short of the right edge, so each one's label can sit
    # on the grid line at its peak height.
    x1, loud, quiet = 500, 1.0, 0.5
    cyc = (x1 - GX0) / 2
    peak = GX0 + cyc / 4
    return figure(
        "amplitude",
        "A graph of two sine waves against time, with the same frequency. One swings up to +1 and down to −1. The other swings only to +0.5 and −0.5.",
        "Two sine waves with the same frequency. The amplitude is how high each one's peaks rise above zero. "
        "The wave with amplitude 0.5 swings half as far, so you hear it about 6 dB quieter.",
        [*graph(yticks=((1, "+1"), (0.5, "+0.5"), (0, "0"), (-0.5, "−0.5"), (-1, "−1")), x1=x1),
         line(wave(2, GX0, x1, GY0, GA * loud)), line(wave(2, GX0, x1, GY0, GA * quiet), "gd-b"),
         line([(peak, GY0), (peak, GY0 - GA * loud)], "gd-a gd-dash"),
         line([(peak + cyc, GY0), (peak + cyc, GY0 - GA * quiet)], "gd-b gd-dash"),
         text(x1 + 12, GY0 - GA * loud + 5, "amplitude 1", "gd-label gd-label--a"),
         text(x1 + 12, GY0 - GA * quiet + 5, "amplitude 0.5", "gd-label gd-label--b")],
        height=GY0 + GA + 52,
    )


def frequency():
    # 20 ms across the graph: the 100 Hz wave makes 2 cycles, the 200 Hz
    # wave 4. One cycle of each is bracketed, above and below the graph.
    ms = lambda t: GX0 + (GX1 - GX0) * t / 20
    xticks = [(ms(t), str(t)) for t in (0, 5, 10, 15, 20)]
    top, bottom = GY0 - GA - 12, GY0 + GA + 12
    return figure(
        "frequency",
        "A graph of two sine waves against time over 20 milliseconds, with the same amplitude. One makes 2 cycles, so its frequency is 100 Hz. The other makes 4 cycles, so its frequency is 200 Hz.",
        "Two sine waves with the same amplitude. In 20 ms the 100 Hz wave makes 2 cycles and the 200 Hz wave makes 4. "
        "Doubling the frequency halves how long each cycle lasts, and you hear it an octave higher.",
        [*graph(xticks, xlabel="time in milliseconds →"), line(wave(2, GX0, GX1, GY0, GA)), line(wave(4, GX0, GX1, GY0, GA), "gd-b"),
         line([(ms(0), top), (ms(10), top)], "gd-a"),
         line([(ms(0), top - 6), (ms(0), top + 6)], "gd-mark"), line([(ms(10), top - 6), (ms(10), top + 6)], "gd-mark"),
         text(ms(10) + 10, top + 5, "100 Hz: one cycle lasts 10 ms", "gd-label gd-label--a"),
         line([(ms(0), bottom), (ms(5), bottom)], "gd-b"),
         line([(ms(0), bottom - 6), (ms(0), bottom + 6)], "gd-mark"), line([(ms(5), bottom - 6), (ms(5), bottom + 6)], "gd-mark"),
         text(ms(5) + 10, bottom + 5, "200 Hz: one cycle lasts 5 ms", "gd-label gd-label--b")],
        height=GH,
    )


def cosine_wave():
    # The waves stop short of the right edge, so each one's name can sit
    # where it ends: the cosine at its peak, the sine at zero.
    x1 = 540
    cyc = (x1 - GX0) / 2
    xticks = [(GX0 + cyc * k / 4, f"{90 * k}°") for k in range(0, 9, 2)]
    return figure(
        "cosine-wave",
        "A graph of a sine wave and a cosine wave against time over two cycles. The sine wave starts at zero and rises. The cosine wave starts at its peak.",
        "A sine wave and a cosine wave with the same amplitude and frequency. The sine wave starts at zero and rises. "
        "The cosine wave starts at its peak, a quarter cycle ahead.",
        [*graph(xticks, x1=x1),
         line(wave(2, GX0, x1, GY0, GA)), line(wave(2, GX0, x1, GY0, GA, phase=math.pi / 2), "gd-b"),
         f'<circle class="gd-dot" cx="{GX0}" cy="{GY0}" r="5"/>',
         f'<circle class="gd-dot gd-dot--b" cx="{GX0}" cy="{GY0 - GA}" r="5"/>',
         text(x1 + 12, GY0 + 5, "sine", "gd-label gd-label--a"),
         text(x1 + 12, GY0 - GA + 5, "cosine", "gd-label gd-label--b")],
        height=GH,
    )


def sinusoid():
    # Three sinusoids, one per row, each with its own three numbers. A
    # positive phase starts the cycle later, as on the sine-wave diagram.
    rows = [(1.0, 2, 0, "gd-a", "gd-label--a", "amplitude 1 · 2 cycles · phase 0°"),
            (0.6, 3, 90, "gd-b", "gd-label--b", "amplitude 0.6 · 3 cycles · phase 90°"),
            (0.85, 1.5, 200, "gd-c", "gd-label--c", "amplitude 0.85 · 1.5 cycles · phase 200°")]
    body, amp = [], 26
    for i, (a, f, ph, cls, lab, name) in enumerate(rows):
        y0 = 56 + i * 84
        body += [axis(y0, GX0, GX1),
                 f'<path class="gd-axis" d="M{GX0},{y0 - amp - 4} L{GX0},{y0 + amp + 4}"/>',
                 line(wave(f, GX0, GX1, y0, amp * a, phase=-math.radians(ph)), cls),
                 text(GX0, y0 - amp - 10, name, f"gd-label {lab}")]
    body.append(text((GX0 + GX1) / 2, 292, "time →", "gd-label", "middle"))
    return figure(
        "sinusoid",
        "Three sinusoids on their own axes. Each has a different amplitude, number of cycles and phase, but all three have the same smooth shape.",
        "Three sinusoids. Each one has its own amplitude, frequency and phase. All three share the same smooth shape.",
        body, height=300,
    )


def phase():
    cyc = (GX1 - GX0) / 2  # two cycles across the graph
    xticks = [(GX0 + cyc * k / 4, f"{90 * k}°") for k in range(9)]
    peak_a, peak_b = GX0 + cyc / 4, GX0 + cyc / 2
    y = GY0 - GA - 12
    return figure(
        "phase",
        "A graph of two sine waves against time, with the same frequency and amplitude. The second wave reaches each peak a quarter cycle, or 90°, after the first.",
        "Two sine waves with the same frequency and amplitude. The time axis counts through the first wave's cycle in degrees, so a full cycle is 360°. "
        "The second wave reaches each peak 90° later, and that offset is its phase.",
        [*graph(xticks), line(wave(2, GX0, GX1, GY0, GA)), line(wave(2, GX0, GX1, GY0, GA, phase=-math.pi / 2), "gd-b"),
         line([(peak_a, y), (peak_b, y)], "gd-b"),
         line([(peak_a, y - 6), (peak_a, y + 6)], "gd-mark"), line([(peak_b, y - 6), (peak_b, y + 6)], "gd-mark"),
         text(peak_b + 10, y + 5, "90° later", "gd-label gd-label--b")],
        height=GH,
    )


def sine_wave():
    # Two cycles of a sine wave, starting at 0 and rising. The marks sit
    # outside the wave: one cycle above it, the amplitude past its end.
    x1 = 540
    cyc = (x1 - GX0) / 2
    bx, top = x1 + 16, 26
    return figure(
        "sine-wave",
        "A graph of a sine wave against time over two cycles. It starts at 0 and rises. One cycle and the amplitude are marked.",
        "A sine wave starts at 0 and rises. Three numbers describe it. The amplitude is how far it swings from zero. "
        "The frequency is how many cycles it makes each second, so one cycle lasts 1 / frequency. "
        "The phase is where the cycle starts, and a sine wave's phase is 0°.",
        [*graph(x1=x1),
         line(wave(2, GX0, x1, GY0, GA)),
         f'<circle class="gd-dot" cx="{GX0}" cy="{GY0}" r="5"/>',
         text(GX0 + 12, GY0 + 24, "starts at 0", "gd-label gd-label--a"),
         line([(GX0, top), (GX0 + cyc, top)], "gd-b"),
         line([(GX0 + cyc, top - 6), (GX0 + cyc, top + 6)], "gd-mark"),
         text(GX0 + cyc / 2, top - 8, "one cycle lasts 1 / frequency", "gd-label gd-label--b", "middle"),
         line([(bx, GY0), (bx, GY0 - GA)], "gd-b"),
         line([(bx - 6, GY0), (bx + 6, GY0)], "gd-mark"),
         line([(bx - 6, GY0 - GA), (bx + 6, GY0 - GA)], "gd-mark"),
         text(bx + 10, GY0 - GA / 2 + 5, "amplitude", "gd-label gd-label--b")],
        height=GY0 + GA + 52,
    )


def bars(x0, x1, y0, values, cls="gd-a"):
    out, n = [], len(values)
    w = (x1 - x0) / n
    for i, v in enumerate(values):
        x = x0 + w * (i + 0.5)
        out.append(f'<path class="{cls} gd-bar" d="M{x:.1f},{y0} L{x:.1f},{y0 - v:.1f}"/>')
    return out


def leakage():
    exact = [0] * 12
    exact[5] = 120
    between = [120 * abs(math.sin(math.pi * 0.5) / (math.pi * (k - 5.5))) for k in range(12)]
    return figure(
        "leakage",
        "Left: a tone that fits the block exactly lands in one DFT bin. Right: a tone between bins spreads into all of them.",
        "A tone that fits the block a whole number of times lands in one bin. Move it halfway between bins and its energy leaks into every bin.",
        [axis(170, 40, 300), axis(170, 360, 620), *bars(40, 300, 170, exact), *bars(360, 620, 170, between, "gd-b"),
         text(170, 192, "whole number of cycles", "gd-label", "middle"), text(490, 192, "half a bin off", "gd-label", "middle")],
    )


def window():
    ts = [i / 200 for i in range(201)]
    rect = [(40 + 580 * t, 40) for t in ts]
    hann = [(40 + 580 * t, 170 - 130 * (0.5 - 0.5 * math.cos(2 * math.pi * t))) for t in ts]
    hamm = [(40 + 580 * t, 170 - 130 * (0.54 - 0.46 * math.cos(2 * math.pi * t))) for t in ts]
    return figure(
        "window",
        "Three window shapes across one block: rectangular stays flat, Hamming tapers almost to zero, Hann tapers to zero.",
        "A window multiplies the block. Rectangular keeps every sample whole. Hann and Hamming fade the edges, so the cut is gentle.",
        [axis(170), line(rect, "gd-c"), line(hamm, "gd-a"), line(hann, "gd-b gd-dash"),
         text(330, 34, "rectangular", "gd-label gd-label--c", "middle"), text(470, 80, "Hamming", "gd-label gd-label--a"),
         text(190, 80, "Hann", "gd-label gd-label--b", "end")],
    )


def frames():
    out = [axis(170)]
    px_per_sample = 580 / 640
    hop, win = 160 * px_per_sample, 255 * px_per_sample
    base = 40 + (win - hop) / 2
    for i in range(4):
        x = base + i * hop
        out.append(f'<path class="gd-mark" d="M{x:.1f},150 L{x:.1f},176"/>')
        if i < 3:
            out.append(text(x + hop / 2, 192, f"frame {i + 1}", "gd-label", "middle"))
    for i, cls in enumerate(["gd-a", "gd-b", "gd-c"]):
        c = base + (i + 0.5) * hop
        x0 = c - win / 2
        pts = [(x0 + win * t, 150 - 100 * (0.54 - 0.46 * math.cos(2 * math.pi * t))) for t in [k / 100 for k in range(101)]]
        out.append(line(pts, cls))
    return figure(
        "frames",
        "Three 20 ms frames in a row, each with a 255-sample Hamming window centred on it that reaches into its neighbours.",
        "Each frame moves on by 160 samples, which is 20 ms. Its window is 255 samples wide, so neighbouring windows overlap.",
        out,
    )


def samples():
    pts = wave(1.5, amp=60)
    dots = []
    for i in range(25):
        t = i / 24
        x, y = 40 + 580 * t, 100 - 60 * math.sin(2 * math.pi * 1.5 * t)
        dots.append(f'<path class="gd-mark" d="M{x:.1f},100 L{x:.1f},{y:.1f}"/><circle class="gd-dot" cx="{x:.1f}" cy="{y:.1f}" r="4"/>')
    return figure(
        "samples",
        "A smooth wave with evenly spaced dots on it, each dot one sample.",
        "The vocoder never sees the smooth wave. It only sees these measurements, 8,000 of them every second.",
        [axis(100), line(pts, "gd-faint"), *dots],
    )


def autocorrelation():
    shift = 0.25  # one pitch period of the voice() waveform
    xs = 40 + 580 * shift
    original = wave(0, y0=60, amp=34, shape=voice)
    copy = [(x, y) for x, y in wave(0, y0=150, amp=34, shape=lambda t: voice(t - shift)) if x >= xs]
    t0 = max((i / 1000 for i in range(250)), key=voice)
    peaks = "".join(
        f'<path class="gd-mark gd-dash" d="M{40 + 580 * (t0 + k * 0.25):.1f},26 L{40 + 580 * (t0 + k * 0.25):.1f},116"/>'
        for k in (1, 2, 3)
    )
    return figure(
        "autocorrelation",
        "A voiced waveform, and below it the same waveform starting one pitch period later. Their peaks line up.",
        "Slide a copy along. When the slide equals one pitch period, every peak meets a peak, and the multiply-and-add sum is at its largest.",
        [axis(60), axis(150, xs), line(original), line(copy, "gd-b"), peaks,
         f'<path class="gd-b" d="M40,190 L{xs:.1f},190"/>', text((40 + xs) / 2, 182, "slide by <tspan font-style=\"italic\">P</tspan>", "gd-label gd-label--b", "middle"),
         text(624, 18, "original", "gd-label gd-label--a", "end"), text(624, 196, "slid copy", "gd-label gd-label--b", "end")],
    )


def quantization():
    pts = wave(1, amp=70)
    steps = []
    levels = 8
    q = lambda v: round((v + 1) / 2 * (levels - 1)) / (levels - 1) * 2 - 1
    n = 48
    prev = None
    for i in range(n + 1):
        t = i / n
        x = 40 + 580 * t
        y = 100 - 70 * q(math.sin(2 * math.pi * t))
        if prev:
            steps.append((x, prev[1]))
        steps.append((x, y))
        prev = (x, y)
    grid = "".join(f'<path class="gd-grid" d="M40,{100 - 70 * (k / (levels - 1) * 2 - 1):.1f} L620,{100 - 70 * (k / (levels - 1) * 2 - 1):.1f}"/>' for k in range(levels))
    return figure(
        "quantization",
        "A smooth wave and the same wave rounded to eight allowed levels, which turns it into a staircase.",
        "With 3 bits there are only 8 allowed levels. Every value snaps to the nearest one, and the gap is the rounding error.",
        [grid, line(pts, "gd-faint"), line(steps, "gd-a")],
    )



# --- spectrograms of speech sounds ----------------------------------------
# Each picture is a short stretch of the female voice (public domain, see
# docs/assets/audio/MANIFEST.md). tools/glossary-spectrograms.py draws the
# PNG behind the plot area from this table; this script draws the axes,
# the bracket and the labels around it, so they follow the theme.

SPEC_X0, SPEC_X1, SPEC_Y0, SPEC_Y1 = 64, 620, 14, 164  # plot area: 4 kHz at the top
SPEC_H = 238

SPECTROGRAMS = {
    "spectrogram-vowel": {
        "clip": "lj-c", "t0": 0.25, "t1": 0.80,
        "marks": [(0.43, 0.63, 'vowel "e"')],
        "label": 'A spectrogram of the word "sells". The vowel in the middle is a stack of evenly spaced bright stripes.',
        "caption": 'The word "sells", spoken. Time runs left to right and frequency bottom to top. '
                   'The vowel "e" is a stack of bright, evenly spaced stripes. Each stripe is one harmonic of the voice.',
    },
    "spectrogram-consonant": {
        "clip": "lj-a", "t0": 2.05, "t1": 2.47,
        "marks": [(2.12, 2.18, '"j"'), (2.28, 2.32, '"m"')],
        "label": 'A spectrogram of the word "jumps". The "j" is a brief smear high in the band. The "m" is a faint low hum.',
        "caption": 'The word "jumps", spoken, with two of its consonants marked. '
                   'The "j" is a short burst of hiss that reaches high in the band. '
                   'The "m" is quiet and low, a hum from the vocal folds with the lips closed. '
                   'The bright stripes between them are the vowel.',
    },
    "spectrogram-fricative": {
        "clip": "lj-a", "t0": 1.12, "t1": 1.50,
        "marks": [(1.23, 1.30, '"f"')],
        "label": 'A spectrogram of the word "fox". The "f" is a faint haze of noise with no stripes, followed by the striped vowel.',
        "caption": 'The word "fox", spoken. The "f" is a faint haze of noise with no stripes in it, because nothing repeats. '
                   'When the vowel starts, the stripes of the harmonics appear.',
    },
    "spectrogram-sibilant": {
        "clip": "lj-c", "t0": 1.05, "t1": 1.50,
        "marks": [(1.13, 1.28, '"sh"')],
        "label": 'A spectrogram of the word "shells". The "sh" is a loud, bright block of noise high in the band.',
        "caption": 'The word "shells", spoken. The "sh" is a loud hiss packed into the top of the band. '
                   'Compare it with the faint "f" of a fricative above.',
    },
    "spectrogram-plosive": {
        "clip": "lj-a", "t0": 3.02, "t1": 3.42,
        "marks": [(3.11, 3.20, '"d"')],
        "label": 'A spectrogram of the word "dog". A short dark gap is followed by a thin bright vertical line, then the striped vowel.',
        "caption": 'The word "dog", spoken. The "d" starts as a short dark gap while the tongue blocks the air. '
                   'Only a low hum gets through, because the vocal folds keep buzzing. '
                   'The thin bright line after it is the pop as the air bursts out. Then the vowel begins.',
    },
}


def spectrogram(name):
    spec = SPECTROGRAMS[name]
    t0, t1 = spec["t0"], spec["t1"]
    tx = lambda t: SPEC_X0 + (SPEC_X1 - SPEC_X0) * (t - t0) / (t1 - t0)
    w, h = SPEC_X1 - SPEC_X0, SPEC_Y1 - SPEC_Y0
    # xlink:href, because the theme sets .href on every [href] element and
    # an SVG image's href is read-only, which throws. The path is relative to
    # the page's .md file; the build adds the ../ for the page's own folder,
    # so it works at the site root and under a subpath.
    body = [f'<image xlink:href="assets/glossary/{name}.png" x="{SPEC_X0}" y="{SPEC_Y0}" '
            f'width="{w}" height="{h}" preserveAspectRatio="none"/>']
    for khz in range(5):
        y = SPEC_Y1 - h * khz / 4
        body.append(f'<path class="gd-axis" d="M{SPEC_X0 - 6},{y:.1f} L{SPEC_X0},{y:.1f}"/>')
        body.append(text(SPEC_X0 - 10, y + 5, f"{khz} kHz" if khz in (0, 4) else str(khz), "gd-label", "end"))
    for a, b, label in spec["marks"]:
        xa, xb = tx(a), tx(b)
        body += [line([(xa, 180), (xb, 180)], "gd-a"),
                 line([(xa, 174), (xa, 186)], "gd-mark"),
                 line([(xb, 174), (xb, 186)], "gd-mark"),
                 text((xa + xb) / 2, 204, label, "gd-label gd-label--a", "middle")]
    # A 100 ms scale bar on its own row, so the reader can judge how long
    # each sound lasts.
    xr = SPEC_X1 - (SPEC_X1 - SPEC_X0) * 0.1 / (t1 - t0)
    body += [line([(xr, 226), (SPEC_X1, 226)], "gd-faint"),
             text(xr - 8, 231, "100 ms", "gd-label", "end")]
    return figure(name, spec["label"], spec["caption"], body, height=SPEC_H)


def probe_test(name, f_test):
    # Chapter 2: a 200 Hz recording, 160 samples at 8 kHz (20 ms), tested
    # by multiplying against a sine at f_test and adding up the products.
    # Three rows: the two waves, each sample's product, the running sum.
    # Both diagrams share the sum's scale, 0 to 80, so they compare.
    n, rate, f_rec = 160, 8000, 200
    x0, x1 = 120, 620
    xs = lambda i: x0 + (x1 - x0) * i / (n - 1)
    rec = [math.sin(2 * math.pi * f_rec * i / rate) for i in range(n)]
    test = [math.sin(2 * math.pi * f_test * i / rate) for i in range(n)]
    prod = [a * b for a, b in zip(rec, test)]
    sums, total = [], 0.0
    for v in prod:
        total += v
        sums.append(total)
    waves_y, prod_y, sum_y, sum_h = 52, 150, 296, 80
    smooth = lambda f: [(x0 + (x1 - x0) * t, waves_y - 34 * math.sin(2 * math.pi * f * 0.02 * t)) for t in (i / 400 for i in range(401))]
    stems = "".join(f'<path class="gd-b" style="stroke-width:1.5" d="M{xs(i):.1f},{prod_y} L{xs(i):.1f},{prod_y - 34 * v:.1f}"/>'
                    for i, v in enumerate(prod))
    running = [(xs(i), sum_y - sum_h * v / 80) for i, v in enumerate(sums)]
    same = f_test == f_rec
    end = sums[-1]
    return figure(
        name,
        f"Three rows against time over 160 samples. Top, a 200 Hz recording and a {f_test} Hz test wave. "
        f"Middle, their product at each sample. Bottom, the running sum of the products, which ends at {end:.0f}.",
        ("The recording and the dashed test wave are both 200 Hz, so they sit right on top of each other. "
         "Every product is positive or zero, and the running sum climbs to 80.") if same else
        ("The dashed test wave is 250 Hz, so it drifts in and out of step with the 200 Hz recording. "
         "The products swing positive and negative, and the running sum rises, falls and ends at 0."),
        [axis(waves_y, x0, x1), line(smooth(f_rec), "gd-a"), line(smooth(f_test), "gd-dash").replace("<path ", '<path style="stroke:var(--ambe-plot-ink);stroke-width:1.5" ', 1),
         axis(prod_y, x0, x1), stems,
         axis(sum_y, x0, x1), line([(x0, sum_y - sum_h), (x1, sum_y - sum_h)], "gd-grid"), line(running, "gd-c"),
         text(x0 - 14, waves_y - 6, "recording", "gd-label gd-label--a", "end"),
         text(x0 - 14, waves_y + 14, f"{f_test} Hz test", "gd-label", "end"),
         text(x0 - 14, prod_y + 5, "products", "gd-label gd-label--b", "end"),
         text(x0 - 14, sum_y - sum_h + 5, "80", "gd-label", "end"),
         text(x0 - 14, sum_y + 5, "0", "gd-label", "end"),
         text(x1, sum_y - sum_h * max(end, 0) / 80 - 10, "running sum", "gd-label gd-label--c", "end"),
         text((x0 + x1) / 2, sum_y + 32, "160 samples in 20 ms →", "gd-label", "middle")],
        height=sum_y + 40,
    )


def dft_db(x):
    # Magnitude of each DFT bin, 0 to N/2, in dB below the loudest bin.
    n = len(x)
    mags = []
    for k in range(n // 2 + 1):
        re_ = sum(v * math.cos(2 * math.pi * k * i / n) for i, v in enumerate(x))
        im_ = sum(v * math.sin(2 * math.pi * k * i / n) for i, v in enumerate(x))
        mags.append(math.hypot(re_, im_))
    top = max(mags)
    return [20 * math.log10(m / top) if m > top * 1e-6 else -120.0 for m in mags]


def leak_spectra():
    # Chapter 3: a cosine cut to 160 samples with no taper, at 6.00 and
    # 6.50 cycles. Stems from the -80 dB floor up to each bin's level.
    n, floor = 160, -80
    x0, x1 = 120, 572
    bx = lambda k: x0 + (x1 - x0) * k / 80
    rows = []
    for row, (cycles, cls, lab, name) in enumerate(((6.0, "gd-a", "gd-label--a", "6.00 cycles"),
                                                     (6.5, "gd-b", "gd-label--b", "6.50 cycles"))):
        base, height = 110 + row * 120, 80
        db = dft_db([math.cos(2 * math.pi * cycles * i / n) for i in range(n)])
        rows += [axis(base, x0, x1), text(x0 - 14, base - height / 2 + 5, name, f"gd-label {lab}", "end"),
                 line([(x0, base - height), (x1, base - height)], "gd-grid"),
                 text(x1 + 4, base - height + 5, "0 dB", "gd-label"), text(x1 + 4, base + 5, "−80", "gd-label")]
        for k, v in enumerate(db):
            if v > floor:
                y = base - height * (v - floor) / -floor
                rows.append(f'<path class="{cls}" style="stroke-width:2" d="M{bx(k):.1f},{base} L{bx(k):.1f},{y:.1f}"/>')
    ticks = []
    for k, label in ((0, "0"), (20, "1"), (40, "2"), (60, "3"), (80, "4")):
        ticks += [line([(bx(k), 230), (bx(k), 236)], "gd-axis"), text(bx(k), 254, label, "gd-label", "middle")]
    return figure(
        "leak-spectra",
        "Two spectra of a tone cut to 20 milliseconds with no taper. At 6.00 cycles there is a single spike at bin 6. At 6.50 cycles there are stems in every bin from 0 to 4 kilohertz.",
        "The same tone cut to one 20 ms block, with no taper. At 6.00 cycles the spectrum is one spike at bin 6. "
        "At 6.50 cycles energy spills into every bin, only 25 to 35 dB below the peak.",
        [*rows, *ticks, text((x0 + x1) / 2, 278, "frequency in kHz →", "gd-label", "middle")],
        height=286,
    )


def tiled_copies():
    # Chapter 3: the DFT treats the 160-sample block as if copies of it ran
    # end to end. Zoomed in on one joint, a quarter of a block either side:
    # at 6.00 cycles the wave runs straight through; at 6.50 it jumps from
    # the bottom of a trough to the top of a crest.
    x0, x1 = 120, 600
    xj = (x0 + x1) / 2
    body = []
    for row, (cycles, cls, lab, name) in enumerate(((6.0, "gd-a", "gd-label--a", "6.00 cycles"),
                                                     (6.5, "gd-b", "gd-label--b", "6.50 cycles"))):
        y0, amp = 70 + row * 120, 36
        before = [(xj + (x1 - x0) * (t - 1) * 2, y0 - amp * math.cos(2 * math.pi * cycles * t))
                  for t in (0.75 + 0.25 * i / 150 for i in range(151))]
        after = [(xj + (x1 - x0) * t * 2, y0 - amp * math.cos(2 * math.pi * cycles * t))
                 for t in (0.25 * i / 150 for i in range(151))]
        body += [axis(y0, x0, x1), text(x0 - 14, y0 + 5, name, f"gd-label {lab}", "end"),
                 line(before + after, cls)]
        if cycles % 1:
            body.append(text(xj + 10, y0 - amp + 4, "jump", "gd-label gd-label--c"))
    body += [line([(xj, 20), (xj, 248)], "gd-mark gd-dash"),
             text(xj - 8, 266, "end of one copy", "gd-label", "end"),
             text(xj + 8, 266, "start of the next", "gd-label")]
    return figure(
        "tiled-copies",
        "Two rows zoomed in on the joint where one copy of a 20 millisecond block meets the next. At 6.00 cycles the wave runs smoothly through the joint. At 6.50 cycles it jumps from the bottom of a trough to the top of a crest.",
        "The DFT treats the block as if copies of it ran end to end. Here is one joint, close up. "
        "At 6.00 cycles each copy ends where the next one starts. "
        "At 6.50 cycles one copy ends at the bottom of a trough, and the next starts at the top of a crest.",
        body,
        height=276,
    )


def window_family():
    # Chapter 3: the three raised-cosine windows over one 160-sample block,
    # weight 0 to 1 up the side, with each window's weight at the ends.
    x0, x1, base, top = 110, 470, 200, 40
    y = lambda w: base - (base - top) * w
    ts = [i / 200 for i in range(201)]
    shape = lambda a: [(x0 + (x1 - x0) * t, y(a - (1 - a) * math.cos(2 * math.pi * t))) for t in ts]
    yt = []
    for w in (0, 0.5, 1):
        yt += [line([(x0 - 6, y(w)), (x0, y(w))], "gd-axis"), text(x0 - 10, y(w) + 5, f"{w:g}", "gd-label", "end")]
    return figure(
        "window-family",
        "A graph of three window shapes across one 160-sample block, weight from 0 to 1. Rectangular stays at 1. Hamming falls to 0.08 at both ends. Hann falls to 0.",
        "The three raised-cosine windows across one block. All three give the middle sample full weight. "
        "They differ at the ends, where rectangular keeps 1.00, Hamming keeps 0.08 and Hann keeps 0.",
        [axis(base, x0, x1), f'<path class="gd-axis" d="M{x0},{base} L{x0},{top - 10}"/>', *yt,
         line([(x0, y(1)), (x1, y(1))], "gd-c"), line(shape(0.54), "gd-a"), line(shape(0.5), "gd-b gd-dash"),
         text(x1 + 10, y(1) + 5, "rectangular 1.00", "gd-label gd-label--c"),
         text(x1 + 10, y(0.08) - 6, "Hamming 0.08", "gd-label gd-label--a"),
         text(x1 + 10, y(0) + 5, "Hann 0", "gd-label gd-label--b"),
         f'<text class="gd-label" x="30" y="{(base + top) / 2}" text-anchor="middle" transform="rotate(-90 30 {(base + top) / 2})">weight</text>',
         text(x0, base + 24, "sample 0", "gd-label", "middle"), text(x1, base + 24, "159", "gd-label", "middle")],
        height=base + 34,
    )


def main_lobe():
    # Chapter 3: a 6.00-cycle cosine, cut with no taper and with Hann,
    # bins 0 to 12 only. Rectangular is one stem; Hann is three, its
    # neighbours 6 dB down.
    n, floor = 160, -60
    x0, x1 = 150, 560
    bx = lambda k: x0 + (x1 - x0) * k / 12
    body = []
    for row, (name, w, cls, lab) in enumerate((("rectangular", lambda i: 1.0, "gd-c", "gd-label--c"),
                                               ("Hann", lambda i: 0.5 - 0.5 * math.cos(2 * math.pi * i / n), "gd-b", "gd-label--b"))):
        base, height = 100 + row * 110, 70
        db = dft_db([w(i) * math.cos(2 * math.pi * 6 * i / n) for i in range(n)])
        body += [axis(base, x0, x1), text(x0 - 14, base - height / 2 + 5, name, f"gd-label {lab}", "end"),
                 line([(x0, base - height), (x1, base - height)], "gd-grid"),
                 text(x1 + 6, base - height + 5, "0 dB", "gd-label"), text(x1 + 6, base + 5, "−60", "gd-label")]
        for k in range(13):
            if db[k] > floor:
                y = base - height * (db[k] - floor) / -floor
                body.append(f'<path class="{cls} gd-bar" d="M{bx(k):.1f},{base} L{bx(k):.1f},{y:.1f}"/>')
    for k in range(0, 13, 2):
        body += [line([(bx(k), 210), (bx(k), 216)], "gd-axis"), text(bx(k), 234, str(k), "gd-label", "middle")]
    return figure(
        "main-lobe",
        "Two spectra of a tone at exactly 6.00 cycles, bins 0 to 12. With no taper there is one stem at bin 6. With a Hann window there are three stems, at bins 5, 6 and 7.",
        "A tone at exactly 6.00 cycles, close up. With no taper it is one stem at bin 6. "
        "The Hann window spreads it over three bins, with bins 5 and 7 each 6 dB down.",
        [*body, text((x0 + x1) / 2, 258, "DFT bin →", "gd-label", "middle")],
        height=266,
    )


def phase_scramble():
    # Chapter 4: ten harmonics of equal amplitude, added with every phase
    # at 0 and again with seeded random phases. Both rows share one scale,
    # so the in-phase pulse towers over the scrambled one. Three periods.
    import random
    rng = random.Random(4)
    phases = [rng.uniform(0, 2 * math.pi) for _ in range(10)]
    x0, x1, n = 130, 620, 600
    rows = (("all at 0°", [0.0] * 10, "gd-a", "gd-label--a", 74),
            ("random phases", phases, "gd-b", "gd-label--b", 190))
    body = []
    for name, ph, cls, lab, y0 in rows:
        pts = []
        for i in range(n + 1):
            t = i / n
            v = sum(math.cos(2 * math.pi * k * 3 * t + ph[k - 1]) for k in range(1, 11)) / 10
            pts.append((x0 + (x1 - x0) * t, y0 - 48 * v))
        body += [axis(y0, x0, x1), line(pts, cls), text(x0 - 14, y0 + 5, name, f"gd-label {lab}", "end")]
    body.append(text((x0 + x1) / 2, 254, "time, three pitch periods →", "gd-label", "middle"))
    return figure(
        "phase-scramble",
        "Two waveforms built from the same ten harmonics with the same amplitudes. With every phase at zero they add up to tall, narrow pulses. With random phases they add up to a low, ragged wave.",
        "The same ten harmonics with the same amplitudes, added two ways. With every phase at 0° the peaks line up into sharp pulses. "
        "With random phases they spread out into a low, ragged wave. The two sound almost the same.",
        body,
        height=262,
    )


def frame_bits():
    # Chapter 4: one 72-bit D-STAR voice frame as 72 cells, 48 for the
    # voice and 24 for error correction. Phase has none.
    x0, w, h, y = 40, 580 / 72, 30, 70
    cells = []
    for i in range(72):
        cls = "gd-a" if i < 48 else "gd-b"
        x = x0 + w * i
        cells.append(f'<rect class="{cls}" x="{x + 1:.1f}" y="{y}" width="{w - 2:.1f}" height="{h}" '
                     f'style="fill:var(--ambe-cat-{1 if i < 48 else 2});stroke:none"/>')
    xv, xf = x0 + w * 48, x0 + w * 72
    brace = lambda a, b, yy, cls: [line([(a, yy), (b, yy)], cls), line([(a, yy - 6), (a, yy + 6)], "gd-mark"),
                                   line([(b, yy - 6), (b, yy + 6)], "gd-mark")]
    return figure(
        "frame-bits",
        "A row of 72 cells, one per bit of a voice frame. The first 48 hold the voice: pitch, voicing and harmonic amplitudes. The last 24 hold error correction. None hold phase.",
        "One 20 ms frame is 72 bits. The voice gets 48 of them, for the pitch, the voicing and the harmonic amplitudes. "
        "Error correction gets the other 24. Phase gets none.",
        [*cells,
         *brace(x0, xv, 50, "gd-a"), text((x0 + xv) / 2, 40, "48 voice bits", "gd-label gd-label--a", "middle"),
         *brace(xv, xf, 50, "gd-b"), text((xv + xf) / 2, 40, "24 FEC bits", "gd-label gd-label--b", "middle"),
         text((x0 + xv) / 2, 130, "pitch, voicing, harmonic amplitudes", "gd-label", "middle"),
         text((xv + xf) / 2, 130, "error correction", "gd-label", "middle"),
         text(x0 + 290, 172, "phase gets 0 bits", "gd-label gd-label--c", "middle")],
        height=186,
    )


def frame_seam():
    # Chapter 4: one harmonic across the boundary between two 20 ms frames,
    # 120 Hz in frame n and 122 Hz in frame n+1, 10 ms either side. Top:
    # frame n+1 restarts at phase 0, so the wave jumps. Bottom: the phase
    # carries on from where frame n left off, so it runs straight through.
    x0, x1 = 150, 620
    xm = (x0 + x1) / 2
    tx = lambda t: xm + (x1 - x0) / 2 * t / 0.010
    ts = [-0.010 + 0.020 * i / 400 for i in range(401)]
    end_n = 2 * math.pi * 120 * 0.020  # frame n's phase at the boundary
    before = lambda t: math.cos(2 * math.pi * 120 * (t + 0.020))
    rows = (("restart at 0", lambda t: math.cos(2 * math.pi * 122 * t), "gd-c", "gd-label--c", 72),
            ("carry phase on", lambda t: math.cos(end_n + 2 * math.pi * 122 * t), "gd-a", "gd-label--a", 196))
    body = []
    for name, after, cls, lab, y0 in rows:
        pts = [(tx(t), y0 - 40 * before(t)) for t in ts if t < 0] + [(tx(t), y0 - 40 * after(t)) for t in [0.0] + [t for t in ts if t > 0]]
        body += [axis(y0, x0, x1), line(pts, cls), text(x0 - 14, y0 + 5, name, f"gd-label {lab}", "end")]
    body += [line([(xm, 18), (xm, 250)], "gd-mark gd-dash"),
             text(xm - 10, 34, "jump", "gd-label gd-label--c", "end"),
             text(xm - 8, 270, "frame n, 120 Hz", "gd-label", "end"),
             text(xm + 8, 270, "frame n+1, 122 Hz", "gd-label")]
    return figure(
        "frame-seam",
        "One harmonic across the boundary between two frames, 120 hertz then 122 hertz. Restarted at phase zero, the wave jumps at the boundary. With its phase carried on, it runs smoothly across.",
        "One harmonic across the boundary between two 20 ms frames. If the decoder restarts frame n+1 at phase 0, the wave jumps at the seam, and you hear a click. "
        "If it carries the phase on from frame n, the wave runs straight through.",
        body,
        height=280,
    )


DIAGRAMS = {
    "sine-wave": sine_wave,
    "pitch-period": pitch_period,
    "harmonic": harmonic,
    "spectral-envelope": spectral_envelope,
    "formant": formant,
    "voiced-unvoiced": voiced_unvoiced,
    "amplitude": amplitude,
    "frequency": frequency,
    "cosine-wave": cosine_wave,
    "sinusoid": sinusoid,
    "phase": phase,
    "leakage": leakage,
    "window": window,
    "frames": frames,
    "samples": samples,
    "autocorrelation": autocorrelation,
    "quantization": quantization,
    "probe-in-step": lambda: probe_test("probe-in-step", 200),
    "probe-out-of-step": lambda: probe_test("probe-out-of-step", 250),
    "leak-spectra": leak_spectra,
    "tiled-copies": tiled_copies,
    "window-family": window_family,
    "main-lobe": main_lobe,
    "phase-scramble": phase_scramble,
    "frame-bits": frame_bits,
    "frame-seam": frame_seam,
    **{name: (lambda n=name: spectrogram(n)) for name in SPECTROGRAMS},
}

MARKER = re.compile(r"(<!-- diagram: ([\w-]+) -->\n)(.*?)(<!-- end diagram -->)", re.S)


def render(page: str) -> str:
    def fill(m: re.Match) -> str:
        name = m.group(2)
        if name not in DIAGRAMS:
            raise SystemExit(f"glossary-diagrams: no diagram named {name}")
        return m.group(1) + DIAGRAMS[name]() + "\n" + m.group(4)

    return MARKER.sub(fill, page)


def main(argv: list[str]) -> int:
    count, stale = 0, []
    for path in PAGES:
        page = path.read_text(encoding="utf-8")
        new = render(page)
        count += len(MARKER.findall(new))
        if new == page:
            continue
        if "--check" in argv:
            stale.append(path.name)
        else:
            path.write_text(new, encoding="utf-8")
    if stale:
        print(f"glossary-diagrams: {', '.join(stale)} out of date; run tools/glossary-diagrams.py")
        return 1
    print(f"glossary-diagrams: {'ok' if '--check' in argv else 'wrote'} ({count} diagrams)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
