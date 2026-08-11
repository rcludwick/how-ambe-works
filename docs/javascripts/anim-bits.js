/* ===========================================================================
   anim-bits.js — slug "bits"
   ---------------------------------------------------------------------------
   The frame-bit dissector. Draws one real, hardware-captured D-STAR voice
   frame as 72 individual bit cells, steps through the whole clip, and shows
   where the 72 bits per 20 ms sit in the 4800 bit/s air budget.

   Mount point:  <div data-anim="bits"></div>

   Data read (precomputed; this file performs no AMBE analysis of any kind):
     assets/data/frames.json   frames[].hex — the 72 channel bits the
                               AMBE-3000 emitted per 20 ms, MSB first
                               (SCHEMA.md, "MEASURED").

   Controls:
     Play / Pause          steps frames at 10 fps (half real time)
     ◀ / ▶                 single-frame step
     Frame slider          scrub, arrow-key steppable
     Colour toggle         bit value  |  change rate
     Flash changes         ring the bits that flipped since the last frame
     Bit grid              hover, tap, or Tab in and use the arrow keys to
                           inspect one bit

   HONESTY NOTE — read before "improving" this figure.
   The assignment of D-STAR's 72 voice bits to codec fields (fundamental,
   voicing, gain, spectral amplitudes, FEC) is NOT published: not in the JARL
   D-STAR system specification, and not in any expired patent. US 5,870,405
   additionally states the codewords are interleaved with a minimum separation
   of 6 bits, so contiguous coloured "fields" would be wrong even if the
   assignment were known. This figure therefore colours bits by what was
   actually measured — their value, and how often each position changes — and
   states the field layout as not publicly documented. Do not invent one.

   MIT licensed (see LICENSE-MIT).
   ======================================================================== */

import {
  mount,
  setupCanvas,
  clearCanvas,
  crisp,
  createLoop,
  createTransport,
  loadJSON,
  getTheme,
  onThemeChange,
  prefersReducedMotion,
} from "./anim-core.js";

const SLUG = "bits";
const DATA = "assets/data/frames.json";

/* Frame arithmetic from the JARL D-STAR system specification (Ch. 4). */
const VOICE_BITS = 72; // AMBE with FEC, per 20 ms  -> 3600 bit/s
const DATA_BITS = 24; // data slot, per 20 ms       -> 1200 bit/s
const PARAM_BITS = 48; // vocoder parameters         -> 2400 bit/s
const FEC_BITS = 24; // error correction           -> 1200 bit/s
const FRAME_MS = 20;
const PLAY_FPS = 10; // half real time, so the bits are readable

const UNDOCUMENTED =
  "Which codec field this bit belongs to is not publicly documented. " +
  "The JARL specification gives the rates, not the bit map, and US 5,870,405 " +
  "interleaves the codewords across the frame.";

/* ---------------------------------------------------------------------------
 * Scoped CSS. Tokens only — no hard-coded colours.
 * ------------------------------------------------------------------------ */

const CSS = `
/* --anim-aspect is set from JS in fitFrame(): the grid has a natural height
   that depends on how wide the cells end up, which a media query cannot see. */
[data-anim="${SLUG}"] .anim-figure__frame { --anim-aspect: 16 / 10; }
[data-anim="${SLUG}"] .anim-figure__canvas { cursor: crosshair; touch-action: pan-y; }
[data-anim="${SLUG}"] .anim-figure__canvas:focus-visible {
  outline: none;
  box-shadow: var(--ambe-focus-ring);
}
[data-anim="${SLUG}"] .anim-legend__item[hidden] { display: none; }
[data-anim="${SLUG}"] .bits-inspect {
  background-color: var(--ambe-sunken);
  border: 1px solid var(--ambe-hairline);
  border-radius: var(--ambe-radius-md);
  display: grid;
  gap: 0.2rem;
  margin-top: 0.6rem;
  padding: 0.55rem 0.7rem;
  min-height: 4.4rem;
}
[data-anim="${SLUG}"] .bits-inspect__head {
  color: var(--ambe-text);
  font-family: var(--ambe-font-mono);
  font-size: 0.64rem;
  font-variant-numeric: tabular-nums;
}
[data-anim="${SLUG}"] .bits-inspect__meta {
  color: var(--ambe-text-3);
  font-size: 0.6rem;
  font-variant-numeric: tabular-nums;
}
[data-anim="${SLUG}"] .bits-inspect__note {
  color: var(--ambe-text-4);
  font-size: 0.6rem;
  line-height: 1.5;
}
[data-anim="${SLUG}"] .bits-inspect__note b {
  color: var(--ambe-accent-warm);
  font-weight: 550;
}
`;

function injectCSS() {
  const id = `anim-${SLUG}-css`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* ---------------------------------------------------------------------------
 * Markup
 * ------------------------------------------------------------------------ */

function buildMarkup(root) {
  root.classList.add("anim-figure");
  root.innerHTML = `
    <div class="anim-figure__head">
      <p class="anim-figure__title">Nine bytes of speech, bit by bit</p>
      <p class="anim-figure__subtitle">Real channel frames off a DVSI AMBE-3000</p>
    </div>

    <div class="anim-figure__frame">
      <canvas class="anim-figure__canvas" tabindex="0"
              aria-label="Grid of the 72 bits of one D-STAR voice frame. Use the arrow keys to move between bits; the description below updates."></canvas>
    </div>

    <div class="bits-inspect" role="status" aria-live="polite">
      <div class="bits-inspect__head" data-ref="head">Hover, tap, or Tab into the grid and use the arrow keys.</div>
      <div class="bits-inspect__meta" data-ref="meta">72 bits every 20 ms — 3600 bit/s of voice.</div>
      <div class="bits-inspect__note" data-ref="note">Bit 0 is the most significant bit of the first byte on the wire.</div>
    </div>

    <ul class="anim-legend">
      <li class="anim-legend__item" data-legend="value"><i class="anim-legend__swatch is-data-1"></i>bit = 1</li>
      <li class="anim-legend__item" data-legend="value"><i class="anim-legend__swatch"></i>bit = 0</li>
      <li class="anim-legend__item" data-legend="rate" hidden><i class="anim-legend__swatch is-data-2"></i>changes often</li>
      <li class="anim-legend__item" data-legend="rate" hidden><i class="anim-legend__swatch"></i>seldom changes</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-3"></i>changed since the previous frame</li>
      <li class="anim-legend__item"><i class="anim-legend__swatch is-data-2"></i>hatched: layout not publicly documented</li>
    </ul>

    <div class="anim-controls">
      <button class="anim-btn anim-btn--play" type="button" aria-pressed="false">Play</button>
      <div class="anim-controls__group">
        <button class="anim-btn" type="button" data-ref="prev" aria-label="Previous frame">&#9664;</button>
        <button class="anim-btn" type="button" data-ref="next" aria-label="Next frame">&#9654;</button>
      </div>
      <label class="anim-field">
        <span class="anim-field__label">Frame</span>
        <input class="anim-range" type="range" min="0" max="0" step="1" value="0"
               aria-label="Frame index">
      </label>
      <output class="anim-readout anim-readout--wide">frame 0</output>
      <div class="anim-toggle-group" role="group" aria-label="Bit colouring">
        <button class="anim-btn" type="button" data-mode="value" aria-pressed="true">Bit value</button>
        <button class="anim-btn" type="button" data-mode="rate" aria-pressed="false">Change rate</button>
      </div>
      <label class="anim-field" style="flex: none">
        <input class="anim-check" type="checkbox" data-ref="flash" checked>
        <span class="anim-field__label">Flash changes</span>
      </label>
    </div>

    <p class="anim-figure__hint">Held on one representative frame because your
      system asks for reduced motion. The slider and the arrow keys still step
      through every frame by hand.</p>

    <figcaption class="anim-figure__caption">
      Every cell is one bit the vocoder chip actually put on the wire. Scrub the
      frame slider and watch how much of the frame turns over in 20 ms; then
      switch to <em>change rate</em> to see that no position is ever still.
      Hover a bit for its byte, its value and how often it flips.
      <strong>The colours are measurements, not a field map</strong> — which of
      these 72 positions carries the fundamental, the voicing bits, the gain or
      the error-correction parity is not publicly documented.
      <span class="anim-figure__source">Source: frames[].hex from
        <code>assets/data/frames.json</code> — 72-bit channel frames captured
        from a DVSI AMBE-3000 (ThumbDV). Frame and rate arithmetic: JARL D-STAR
        system specification. Interleaving and unequal error protection:
        US 5,870,405 (expired).</span>
    </figcaption>
  `;
  return {
    frame: root.querySelector(".anim-figure__frame"),
    canvas: root.querySelector(".anim-figure__canvas"),
    head: root.querySelector('[data-ref="head"]'),
    meta: root.querySelector('[data-ref="meta"]'),
    note: root.querySelector('[data-ref="note"]'),
    prev: root.querySelector('[data-ref="prev"]'),
    next: root.querySelector('[data-ref="next"]'),
    flash: root.querySelector('[data-ref="flash"]'),
    modes: Array.from(root.querySelectorAll("[data-mode]")),
    legend: Array.from(root.querySelectorAll("[data-legend]")),
  };
}

/* ---------------------------------------------------------------------------
 * Data shaping — generic bit bookkeeping over the captured hex strings.
 * ------------------------------------------------------------------------ */

function unpack(frames) {
  const rows = frames.map((f) => {
    const bytes = [];
    for (let b = 0; b < f.hex.length; b += 2) {
      bytes.push(parseInt(f.hex.slice(b, b + 2), 16));
    }
    const bits = new Uint8Array(VOICE_BITS);
    for (let n = 0; n < VOICE_BITS; n += 1) {
      bits[n] = (bytes[n >> 3] >> (7 - (n & 7))) & 1;
    }
    return { i: f.i, t: f.t, hex: f.hex, bytes, bits };
  });

  // How often each position differs from the same position one frame earlier.
  const flips = new Float64Array(VOICE_BITS);
  const changed = rows.map(() => new Uint8Array(VOICE_BITS));
  for (let i = 1; i < rows.length; i += 1) {
    for (let n = 0; n < VOICE_BITS; n += 1) {
      if (rows[i].bits[n] !== rows[i - 1].bits[n]) {
        flips[n] += 1;
        changed[i][n] = 1;
      }
    }
  }
  const transitions = Math.max(1, rows.length - 1);
  const rate = Array.from(flips, (c) => c / transitions);
  const rateMax = Math.max(0.05, ...rate);
  const rateMin = Math.min(...rate);
  // Stretch the observed spread across the whole ramp, or every cell would
  // land in the same narrow band of colour.
  const rateNorm = rate.map((r) =>
    rateMax > rateMin ? (r - rateMin) / (rateMax - rateMin) : 0.5
  );
  const changedCount = changed.map((c) => c.reduce((a, b) => a + b, 0));
  return {
    rows,
    rate,
    rateNorm,
    rateMin,
    rateMax,
    changed,
    changedCount,
    transitions,
  };
}

/* ---------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------ */

const TWO_COL = 720; // canvas width at which the budget panel moves alongside
const PANEL_H = 278; // height the budget panel wants when it sits underneath
const TITLE_H = 26;
const HEADER_H = 14;

function metrics(W) {
  const pad = W < 420 ? 10 : 14;
  const twoCol = W >= TWO_COL;
  const gridW = twoCol ? Math.round((W - pad * 3) * 0.54) : W - pad * 2;
  const labelW = W < 420 ? 34 : 42;
  const hexW = W < 420 ? 34 : 44;
  const gap = W < 420 ? 3 : 4;
  const inner = gridW - labelW - hexW - 10;
  const cell = Math.max(12, Math.min(44, Math.floor((inner - gap * 7) / 8)));
  return { pad, twoCol, gridW, labelW, hexW, gap, cell };
}

/** Height this figure needs at a given width, so the frame's aspect can be
 *  set from JS instead of guessed by a media query. */
function naturalHeight(W) {
  const m = metrics(W);
  if (m.twoCol) return Math.round((W * 9) / 16);
  const gridH = 9 * m.cell + 8 * m.gap;
  return m.pad * 2 + TITLE_H + HEADER_H + gridH + 22 + PANEL_H;
}

function computeLayout(size) {
  const W = size.width;
  const H = size.height;
  const m = metrics(W);
  const { pad, twoCol, gridW, labelW, hexW, gap } = m;

  // Never let the grid outgrow the box: shrink the cells before overflowing.
  const availH =
    H - pad * 2 - TITLE_H - HEADER_H - (twoCol ? 0 : 22 + 120);
  const cell = Math.max(10, Math.min(m.cell, Math.floor((availH - gap * 8) / 9)));

  const gridTop = pad + TITLE_H;
  const headerH = HEADER_H;
  const rows = 9;
  const gridH = rows * cell + (rows - 1) * gap;

  // Centre the grid block when it stands alone, so a wide column does not
  // leave it hugging the left edge.
  const blockW = labelW + cell * 8 + gap * 7 + 10 + hexW;
  const x0 = twoCol ? pad : Math.max(pad, Math.round((W - blockW) / 2));

  const grid = {
    x: x0,
    y: gridTop,
    labelX: x0,
    cellX: x0 + labelW,
    hexX: x0 + labelW + cell * 8 + gap * 7 + 10,
    cell,
    gap,
    headerH,
    width: labelW + cell * 8 + gap * 7 + 10 + hexW,
    height: gridH,
    top: gridTop + headerH,
  };

  const panel = twoCol
    ? {
        x: pad * 2 + gridW,
        y: pad + TITLE_H,
        width: W - (pad * 2 + gridW) - pad,
        height: H - pad * 2 - TITLE_H,
      }
    : {
        x: x0,
        y: grid.top + gridH + 22,
        width: W - x0 * 2,
        height: H - (grid.top + gridH + 22) - pad,
      };

  return { W, H, pad, twoCol, grid, panel };
}

function cellRect(grid, n) {
  const row = n >> 3;
  const col = n & 7;
  return {
    x: grid.cellX + col * (grid.cell + grid.gap),
    y: grid.top + row * (grid.cell + grid.gap),
    w: grid.cell,
    h: grid.cell,
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* Blend two CSS colours numerically. Canvas `fillStyle` does not reliably
   accept `color-mix()`, so parse and interpolate instead. */
const colourCache = new Map();

function parseColour(value) {
  if (colourCache.has(value)) return colourCache.get(value);
  let out = null;
  const s = String(value).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      out = [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
        h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      ];
    } else if (h.length === 6 || h.length === 8) {
      out = [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
        h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      ];
    }
  } else {
    m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (m) {
      const parts = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.every((v) => !Number.isNaN(v))) {
        out = [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
      }
    }
  }
  colourCache.set(value, out);
  return out;
}

function luminance(colour) {
  const c = parseColour(colour);
  if (!c) return 0;
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** Pick whichever of the theme's two extreme inks reads better on `fill`. */
function contrastInk(fill, th) {
  const l = luminance(fill);
  const a = luminance(th.ink);
  const b = luminance(th.plotBg);
  const ratio = (x, y) =>
    (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  return ratio(l, a) >= ratio(l, b) ? th.ink : th.plotBg;
}

function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  const ca = parseColour(a);
  const cb = parseColour(b);
  if (!ca || !cb) return u > 0.5 ? b : a;
  const c = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * u);
  const alpha = ca[3] + (cb[3] - ca[3]) * u;
  return `rgba(${c(0)}, ${c(1)}, ${c(2)}, ${alpha.toFixed(3)})`;
}

/* ---------------------------------------------------------------------------
 * Painting
 * ------------------------------------------------------------------------ */

function paint(ctx, size, model, state) {
  const th = getTheme();
  const L = computeLayout(size);
  clearCanvas(ctx, size, th.plotBg);

  const row = model.rows[state.frame];
  const changed = model.changed[state.frame];
  const flashAge = (performance.now() - state.changeAt) / 420;
  const flash =
    state.flash && !state.reduced ? Math.max(0, 1 - flashAge) : state.flash ? 1 : 0;

  drawGridBlock(ctx, th, L, model, state, row, changed, flash);
  drawPanel(ctx, th, L, model, state, row);
  state.hits = L;
  return L;
}

function drawGridBlock(ctx, th, L, model, state, row, changed, flash) {
  const g = L.grid;

  ctx.save();
  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("One 20 ms voice frame — 72 bits as transmitted", g.x, L.pad + 12);

  // Column header: bit position inside the byte, MSB first.
  ctx.font = `10px ${th.mono}`;
  ctx.fillStyle = th.text4;
  ctx.textAlign = "center";
  for (let c = 0; c < 8; c += 1) {
    const r = cellRect(g, c);
    ctx.fillText(String(c), r.x + r.w / 2, g.top - 4);
  }

  const digit = g.cell >= 20;
  for (let n = 0; n < 72; n += 1) {
    const r = cellRect(g, n);
    const v = row.bits[n];
    let fill;
    if (state.mode === "rate") {
      fill = mix(th.surface2, th.accentCool, model.rateNorm[n]);
    } else {
      fill = v ? th.series[0] : th.surface2;
    }
    roundRect(ctx, r.x, r.y, r.w, r.h, 3);
    ctx.fillStyle = fill;
    ctx.fill();
    if (!v || state.mode === "rate") {
      ctx.strokeStyle = th.hairline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (digit) {
      ctx.font = `600 ${Math.round(g.cell * 0.42)}px ${th.mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle =
        state.mode === "rate" || v ? contrastInk(fill, th) : th.text4;
      ctx.fillText(String(v), r.x + r.w / 2, r.y + r.h / 2 + 0.5);
    }

    if (flash > 0 && changed[n]) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * flash;
      roundRect(ctx, r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3, 4.5);
      ctx.strokeStyle = th.accentWarm;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    if (n === state.selected) {
      roundRect(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 6);
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Byte labels and the hex the chip emitted.
  ctx.textBaseline = "middle";
  for (let b = 0; b < 9; b += 1) {
    const r = cellRect(g, b * 8);
    ctx.font = `10px ${th.mono}`;
    ctx.fillStyle = th.text4;
    ctx.textAlign = "left";
    ctx.fillText(`byte ${b}`, g.labelX, r.y + r.h / 2);
    ctx.fillStyle = th.text3;
    ctx.fillText(
      `0x${row.hex.slice(b * 2, b * 2 + 2)}`,
      g.hexX,
      r.y + r.h / 2
    );
  }
  ctx.restore();
}

function fmtInt(n) {
  return n.toLocaleString("en-US");
}

function drawPanel(ctx, th, L, model, state, row) {
  const p = L.panel;
  if (p.height < 90) return;
  let y = p.y;

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  ctx.font = `600 11px ${th.font}`;
  ctx.fillStyle = th.text2;
  ctx.fillText("Where the bits go", p.x, y + 10);
  y += 24;

  /* --- Bar 1: the 96-bit air frame ---------------------------------- */
  const barH = 20;
  const voiceW = (p.width * VOICE_BITS) / (VOICE_BITS + DATA_BITS);
  roundRect(ctx, p.x, y, voiceW, barH, 3);
  ctx.fillStyle = th.series[0];
  ctx.fill();
  roundRect(ctx, p.x + voiceW + 2, y, p.width - voiceW - 2, barH, 3);
  ctx.fillStyle = th.surface3;
  ctx.fill();

  ctx.font = `600 10px ${th.mono}`;
  ctx.fillStyle = th.plotBg;
  ctx.textAlign = "center";
  ctx.fillText("72 voice", p.x + voiceW / 2, y + barH / 2 + 3.5);
  ctx.fillStyle = th.text3;
  ctx.fillText(
    "24 data",
    p.x + voiceW + 2 + (p.width - voiceW - 2) / 2,
    y + barH / 2 + 3.5
  );
  y += barH + 13;

  ctx.font = `10px ${th.font}`;
  ctx.fillStyle = th.text4;
  ctx.textAlign = "left";
  ctx.fillText("96 bits every 20 ms on the air = 4800 bit/s", p.x, y);
  y += 20;

  /* --- Bar 2: inside the 72 ----------------------------------------- */
  const paramW = (p.width * PARAM_BITS) / VOICE_BITS;
  roundRect(ctx, p.x, y, paramW, barH, 3);
  ctx.fillStyle = th.surface2;
  ctx.fill();
  ctx.strokeStyle = th.accentCool;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Hatch the parameter block: its interior arrangement is not published.
  ctx.save();
  roundRect(ctx, p.x, y, paramW, barH, 3);
  ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = th.accentCool;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = p.x - barH; x < p.x + paramW + barH; x += 7) {
    ctx.moveTo(x, y + barH);
    ctx.lineTo(x + barH, y);
  }
  ctx.stroke();
  ctx.restore();

  const fecW = (p.width * FEC_BITS) / VOICE_BITS - 2;
  roundRect(ctx, p.x + paramW + 2, y, fecW, barH, 3);
  ctx.fillStyle = th.accentWarm;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.font = `600 10px ${th.mono}`;
  ctx.textAlign = "center";
  ctx.fillStyle = th.text2;
  ctx.fillText("48 parameters", p.x + paramW / 2, y + barH / 2 + 3.5);
  ctx.fillStyle = th.plotBg;
  ctx.fillText(
    "24 FEC",
    p.x + paramW + 2 + fecW / 2,
    y + barH / 2 + 3.5
  );
  y += barH + 13;

  ctx.font = `10px ${th.font}`;
  ctx.textAlign = "left";
  ctx.fillStyle = th.text4;
  ctx.fillText("2400 bit/s of vocoder + 1200 bit/s of FEC = 3600 bit/s", p.x, y);
  y += 15;
  ctx.fillStyle = th.accentCool;
  ctx.fillText("hatched: which position holds which field is not", p.x, y);
  y += 13;
  ctx.fillText("publicly documented, and the codewords are interleaved", p.x, y);
  y += 20;

  /* --- Running budget ------------------------------------------------ */
  const shown = state.frame + 1;
  const bits = shown * VOICE_BITS;
  const secs = (shown * FRAME_MS) / 1000;
  ctx.font = `10px ${th.mono}`;
  ctx.fillStyle = th.text3;
  ctx.fillText(
    `${fmtInt(shown)} frames · ${fmtInt(bits)} voice bits · ${secs.toFixed(2)} s`,
    p.x,
    y
  );
  y += 14;
  ctx.fillStyle = th.text2;
  ctx.fillText(
    `${fmtInt(bits)} / ${secs.toFixed(2)} s = 3600 bit/s`,
    p.x,
    y
  );
  y += 22;

  /* --- Activity strip ------------------------------------------------ */
  const stripH = Math.min(46, Math.max(20, p.y + p.height - y - 26));
  if (stripH >= 20) {
    ctx.font = `10px ${th.font}`;
    ctx.fillStyle = th.text4;
    ctx.fillText(
      `Change rate per position, over ${model.transitions} transitions ` +
        `(tallest = ${(model.rateMax * 100).toFixed(0)}%)`,
      p.x,
      y
    );
    y += 8;
    const bw = p.width / 72;
    const base = y + stripH;
    for (let n = 0; n < 72; n += 1) {
      const h = Math.max(1, (model.rateNorm[n]) * stripH);
      ctx.fillStyle =
        n === state.selected
          ? th.ink
          : mix(th.surface3, th.accentCool, model.rateNorm[n]);
      ctx.fillRect(p.x + n * bw, base - h, Math.max(1, bw - 1), h);
    }
    ctx.strokeStyle = th.hairline;
    ctx.beginPath();
    ctx.moveTo(p.x, crisp(base));
    ctx.lineTo(p.x + p.width, crisp(base));
    ctx.stroke();
    ctx.font = `9px ${th.mono}`;
    ctx.fillStyle = th.text4;
    ctx.fillText("bit 0", p.x, base + 11);
    ctx.textAlign = "right";
    ctx.fillText("bit 71", p.x + p.width, base + 11);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------------------
 * Hit testing
 * ------------------------------------------------------------------------ */

function hitTest(L, x, y) {
  const g = L.grid;
  for (let n = 0; n < 72; n += 1) {
    const r = cellRect(g, n);
    if (x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2) {
      return n;
    }
  }
  const p = L.panel;
  if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) {
    const bw = p.width / 72;
    const n = Math.floor((x - p.x) / bw);
    if (n >= 0 && n < 72 && y > p.y + p.height - 70) return n;
  }
  return -1;
}

/* ---------------------------------------------------------------------------
 * Mount
 * ------------------------------------------------------------------------ */

function describe(refs, model, state) {
  const row = model.rows[state.frame];
  const n = state.selected;
  if (n < 0) {
    refs.head.textContent = `Frame ${row.i} · ${row.t.toFixed(2)} s · ${row.hex}`;
    refs.meta.textContent = `${model.changedCount[state.frame]} of 72 bits changed since the previous frame · 72 bits every 20 ms = 3600 bit/s`;
    refs.note.textContent =
      "Hover, tap, or Tab into the grid and use the arrow keys to inspect one bit.";
    return;
  }
  const byte = n >> 3;
  const inByte = n & 7;
  const flipped = model.changed[state.frame][n] === 1;
  refs.head.textContent = `Bit ${n} of 72 = ${row.bits[n]} · byte ${byte}, bit ${inByte} (MSB first) · byte = 0x${row.hex.slice(
    byte * 2,
    byte * 2 + 2
  )}`;
  refs.meta.textContent = `${
    flipped ? "Changed" : "Held"
  } since frame ${row.i - 1 < 0 ? "—" : row.i - 1} · this position changes in ${(
    model.rate[n] * 100
  ).toFixed(0)}% of the ${model.transitions} frame transitions in this clip`;
  refs.note.innerHTML = `<b>Field: not publicly documented.</b> ${UNDOCUMENTED}`;
}

function init(root) {
  injectCSS();
  const refs = buildMarkup(root);
  refs.frame.dataset.state = "loading";

  return loadJSON(DATA).then((data) => {
    delete refs.frame.dataset.state;
    const model = unpack(data.frames);
    const startFrame = Math.min(98, model.rows.length - 1);

    const state = {
      frame: startFrame,
      selected: -1,
      mode: "value",
      flash: true,
      reduced: prefersReducedMotion(),
      changeAt: 0,
      hits: null,
    };

    let loop = null;

    // Give the frame the aspect ratio the content actually needs at this
    // width. Width does not depend on height here, so this converges.
    const fitFrame = (width) => {
      if (!width) return;
      const m = metrics(width);
      const aspect = m.twoCol ? "16 / 9" : `${width} / ${naturalHeight(width)}`;
      if (refs.frame.style.getPropertyValue("--anim-aspect") !== aspect) {
        refs.frame.style.setProperty("--anim-aspect", aspect);
      }
    };

    const handle = setupCanvas(refs.canvas, {
      onResize: (h) => {
        fitFrame(h.width);
        if (loop) loop.render();
      },
    });
    fitFrame(handle.width);

    loop = createLoop(
      () => {
        paint(handle.ctx, handle, model, state);
      },
      { element: root, staticTime: 0, autoplay: !state.reduced }
    );

    const transport = createTransport(root, {
      frames: model.rows.length,
      fps: PLAY_FPS,
      startFrame,
      format: (i) => `frame ${i} · ${(i * 0.02).toFixed(2)} s`,
      onFrame: (i) => {
        state.frame = i;
        state.changeAt = performance.now();
        describe(refs, model, state);
        loop.render();
      },
    });

    /* -- interaction -------------------------------------------------- */
    const select = (n) => {
      if (n === state.selected) return;
      state.selected = n;
      describe(refs, model, state);
      loop.render();
    };

    const localPoint = (event) => {
      const rect = refs.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointer = (event) => {
      if (!state.hits) return;
      const { x, y } = localPoint(event);
      select(hitTest(state.hits, x, y));
    };
    const onLeave = () => select(-1);

    const onKey = (event) => {
      const step =
        event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
          ? 8
          : event.key === "ArrowUp"
          ? -8
          : event.key === "Home"
          ? -1000
          : event.key === "End"
          ? 1000
          : 0;
      if (!step) return;
      event.preventDefault();
      const from = state.selected < 0 ? (step > 0 ? -1 : 72) : state.selected;
      select(Math.max(0, Math.min(71, from + step)));
    };

    refs.canvas.addEventListener("pointermove", onPointer);
    refs.canvas.addEventListener("pointerdown", onPointer);
    refs.canvas.addEventListener("pointerleave", onLeave);
    refs.canvas.addEventListener("keydown", onKey);
    refs.canvas.addEventListener("blur", onLeave);

    const stepFrame = (d) => () =>
      transport.seek(
        (transport.frame() + d + model.rows.length) % model.rows.length
      );
    const onPrev = stepFrame(-1);
    const onNext = stepFrame(1);
    refs.prev.addEventListener("click", onPrev);
    refs.next.addEventListener("click", onNext);

    const onMode = (event) => {
      state.mode = event.currentTarget.dataset.mode;
      for (const b of refs.modes) {
        b.setAttribute(
          "aria-pressed",
          b.dataset.mode === state.mode ? "true" : "false"
        );
      }
      for (const li of refs.legend) li.hidden = li.dataset.legend !== state.mode;
      loop.render();
    };
    for (const b of refs.modes) b.addEventListener("click", onMode);

    const onFlash = () => {
      state.flash = refs.flash.checked;
      loop.render();
    };
    refs.flash.addEventListener("change", onFlash);

    const offTheme = onThemeChange(() => loop.render());

    describe(refs, model, state);
    loop.render();

    return () => {
      offTheme();
      transport.destroy();
      loop.destroy();
      handle.destroy();
      refs.canvas.removeEventListener("pointermove", onPointer);
      refs.canvas.removeEventListener("pointerdown", onPointer);
      refs.canvas.removeEventListener("pointerleave", onLeave);
      refs.canvas.removeEventListener("keydown", onKey);
      refs.canvas.removeEventListener("blur", onLeave);
      refs.prev.removeEventListener("click", onPrev);
      refs.next.removeEventListener("click", onNext);
      for (const b of refs.modes) b.removeEventListener("click", onMode);
      refs.flash.removeEventListener("change", onFlash);
    };
  });
}

mount(`[data-anim="${SLUG}"]`, init);

export { init };
