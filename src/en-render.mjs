// Rendering engine for the English asset recreations.
//
// Two halves:
//   eraseText()  - remove the baked Japanese from a palette-index canvas, leaving
//                  the plate/frame/gradient byte-identical everywhere else
//   drawText()   - lay English down in the asset's own colours and a chosen style
//
// Everything works on palette indices (0..15) because that is what can be written
// back into 4bpp GBA tiles without loss.
import { FACES, glyphSize, textWidth } from './en-fonts.mjs';

// ---------------------------------------------------------------- helpers ---
const histOf = (idx, W, box) => {
  const h = new Map();
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const c = idx[y * W + x];
      h.set(c, (h.get(c) || 0) + 1);
    }
  }
  return h;
};
const modal = (h, skip = new Set()) => {
  let best = -1, n = -1;
  for (const [c, k] of h) {
    if (skip.has(c)) continue;
    if (k > n) { n = k; best = c; }
  }
  return best;
};
const modalNonZero = (h) => modal(h, new Set([0]));

// Fill every pixel of `mask` with a plausible background colour by growing
// known background inward (8-connected modal-neighbour dilation). This keeps
// solid fills, bars and capsules intact even when the text covers most of them,
// which a per-row modal cannot do.
function inpaintFill(grid, W, H, box, mask) {
  const filled = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (!mask[p]) filled[p] = 1;
  const todo = [];
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    if (mask[y * W + x]) todo.push([x, y]);
  }
  const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  let queue = todo;
  for (let guard = 0; queue.length && guard < 512; guard++) {
    const next = [];
    for (const [x, y] of queue) {
      const m = new Map();
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (!filled[q]) continue;
        m.set(grid[q], (m.get(grid[q]) || 0) + 1);
      }
      if (!m.size) { next.push([x, y]); continue; }
      let best = -1, bn = -1;
      for (const [c, n] of m) if (n > bn) { bn = n; best = c; }
      grid[y * W + x] = best;
      filled[y * W + x] = 1;
    }
    if (next.length === queue.length) break;
    queue = next;
  }
  return queue.length;
}

// --------------------------------------------------------------- erasing ---
// modes:
//   holes   - text is enclosed by the plate face. Flood the border of the box
//             through everything that is not the face colour; whatever stays
//             unreachable is glyph ink. Frame, bevel and shadow are untouched.
//   recolor - text is drawn in a known set of ink colours. The holes it leaves
//             are filled by growing the surrounding background inward, so bars,
//             capsules and starbursts survive intact.
//   flat    - uniform background: paint the whole box with `bg`.
//
// `ink` lists the glyph colours; `bg` lists the background colours instead (the
// ink is then everything that is not background).
export function eraseText(idx, W, H, box, mode, opts = {}) {
  const { x0, y0, x1, y1 } = box;
  const mask = new Uint8Array(W * H);
  const bg = new Uint8Array(W * H).fill(255);
  const h = histOf(idx, W, box);
  const face = opts.face ?? modalNonZero(h);
  const bgSet = new Set(opts.bg ?? []);
  const inkSet = new Set(opts.ink ?? []);
  const isInk = (c) => (bgSet.size ? !bgSet.has(c) : inkSet.has(c));
  let erased = 0;

  const setBg = (x, y, c) => {
    bg[y * W + x] = c;
    idx[y * W + x] = c;
    mask[y * W + x] = 1;
    erased++;
  };

  if (mode === 'flat') {
    const c = opts.bg0 ?? modalNonZero(h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setBg(x, y, c);
    return { mask, bg, bbox: opts.bbox ?? null, face: c, erased, inkSet, bgColours: new Set([c]) };
  }

  if (mode === 'recolor') {
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!isInk(idx[y * W + x])) continue;
      mask[y * W + x] = 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const bgColours = bgSet.size
      ? new Set(bgSet)
      : new Set([...new Set(idx)].filter((c) => !inkSet.has(c)));
    if (maxX < 0) return { mask, bg, bbox: null, face, erased, inkSet, bgColours };
    const leftover = inpaintFill(idx, W, H, box, mask);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      bg[p] = idx[p];
      erased++;
    }
    return {
      mask, bg, bbox: { minX, maxX, minY, maxY }, face, erased, inkSet, bgColours,
      leftover,
    };
  }

  if (mode === 'frame') {
    // For pills and bursts whose Japanese actually touches the frame, colour
    // matching cannot separate text from frame. Instead: flood the *frame* in
    // from its outer edge, then everything inside the box that is not the body
    // colour and not part of that flood is text.
    const body = opts.body;
    const rimColours = new Set(opts.rimColours ?? []);
    const frameColours = new Set(opts.frameColours ?? []);
    const frame = new Uint8Array(W * H);
    const stack = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = idx[y * W + x];
      if (!rimColours.has(c)) continue;
      let edge = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { edge = true; break; }
        if (idx[ny * W + nx] === 0) { edge = true; break; }
      }
      if (edge) stack.push([x, y]);
    }
    while (stack.length) {
      const [x, y] = stack.pop();
      const p = y * W + x;
      if (frame[p]) continue;
      if (!frameColours.has(idx[p])) continue;
      frame[p] = 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        stack.push([nx, ny]);
      }
    }
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      const c = idx[p];
      if (frame[p] || c === 0 || c === body) continue;
      mask[p] = 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return { mask, bg, bbox: null, face: body, erased, inkSet, bgColours: new Set([body]) };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      bg[p] = body;
      idx[p] = body;
      erased++;
    }
    return { mask, bg, bbox: { minX, maxX, minY, maxY }, face: body, erased, inkSet, bgColours: new Set([body]) };
  }

  if (mode === 'rows') {
    // The bar family draws white text that spills above and below a horizontal
    // bar, so the background differs per row (black above, bar colour on it).
    // Each row is rebuilt from the modal non-ink colour of that same row, unless
    // the asset supplies `bgRows` because its own border shares the ink colour
    // and the modal would therefore pick the wrong background.
    const rowBg = new Array(H).fill(0);
    const forced = opts.bgRows ?? null;
    let last = null;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = y0; y <= y1; y++) {
      const m = new Map();
      for (let x = x0; x <= x1; x++) {
        const c = idx[y * W + x];
        if (isInk(c)) continue;
        m.set(c, (m.get(c) || 0) + 1);
      }
      rowBg[y] = forced ? forced[y] : (m.size ? modal(m) : (last ?? 0));
      last = rowBg[y];
      for (let x = x0; x <= x1; x++) {
        if (!isInk(idx[y * W + x])) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { mask, bg, bbox: null, face, erased, inkSet, bgColours: new Set() };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      if (!isInk(idx[p])) continue;
      mask[p] = 1;
    }
    // A kana's drop shadow is the same colour as the bar's own shadow, so it is
    // picked up only where it actually touches the glyph.
    const extra = new Set(opts.dilateInk ?? []);
    if (extra.size) {
      for (let pass = 0; pass < (opts.dilatePasses ?? 1); pass++) {
        const add = [];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const p = y * W + x;
          if (mask[p] || !extra.has(idx[p])) continue;
          let touch = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
            if (mask[ny * W + nx]) { touch = true; break; }
          }
          if (touch) add.push(p);
        }
        for (const p of add) mask[p] = 1;
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      if (!mask[p]) continue;
      setBg(x, y, rowBg[y]);
    }
    return {
      mask, bg, bbox: { minX, maxX, minY, maxY }, face, erased, inkSet,
      bgColours: new Set(rowBg.slice(y0, y1 + 1)),
    };
  }

  // holes
  const clip = opts.clip ?? { x0, y0, x1, y1 };
  const outside = new Uint8Array(W * H);
  const stack = [];
  for (let x = x0; x <= x1; x++) { stack.push([x, y0], [x, y1]); }
  for (let y = y0; y <= y1; y++) { stack.push([x0, y], [x1, y]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < x0 || y < y0 || x > x1 || y > y1) continue;
    const p = y * W + x;
    if (outside[p] || idx[p] === face) continue;
    outside[p] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  const inClip = (x, y) => x >= clip.x0 && x <= clip.x1 && y >= clip.y0 && y <= clip.y1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = y * W + x;
    if (idx[p] === face || outside[p] || !inClip(x, y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = y * W + x;
    if (idx[p] === face || outside[p] || !inClip(x, y)) continue;
    setBg(x, y, face);
  }
  return { mask, bg, bbox: { minX, maxX, minY, maxY }, face, erased, inkSet, bgColours: new Set([face]) };
}

// Bounding box of pixels that differ from their row background, inside `box`.
// Used when the exact kana extent is needed for centring.
export function contentBBox(idx, W, H, box, bgFn) {
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
    if (idx[y * W + x] === bgFn(x, y)) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------- drawing ---
// Build the glyph mask for `text` at (tx,ty). `scale` pixel-doubles (or triples)
// the letterform, which is how the large comic/starburst lettering is matched.
export function glyphMask(face, text, tx, ty, tracking, scale = 1, slant = 0) {
  const { w, h } = glyphSize(face);
  const pts = [];
  let x = tx;
  for (const ch of text) {
    const g = face[ch] ?? face[' '];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      if (g[r][c] !== '#') continue;
      // Italic shear: the top of every glyph leans right relative to its base,
      // the way the Japanese comic lettering does. `slant` is a fraction of the
      // glyph height, so 0.2 shifts the top row by 20% of the height.
      const shear = slant ? Math.round((h - 1 - r) * slant * scale) : 0;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        pts.push([x + c * scale + sx + shear, ty + r * scale + sy]);
      }
    }
    x += w * scale + tracking;
  }
  return pts;
}

export function scaledWidth(face, text, tracking, scale = 1) {
  const { w } = glyphSize(face);
  const n = [...text].length;
  return n * (w * scale + tracking) - tracking;
}

const key = (x, y) => x + ',' + y;

// styles:
//   hollow     1px ring only, interior stays background  (YES/NO plates)
//   fill       filled + 1px outline
//   shadow     filled + 1px outline + offset drop shadow
//   bevel      filled, with a light top/left edge and a dark bottom/right edge
//   outline3   3px ring only (thick hollow)
export function drawText(idx, W, H, spec) {
  const {
    text, face, tracking = 1, style = 'fill', scale = 1, dilate = 0, slant = 0,
    fill = 15, outline = 1, shadow = null, shadowDX = 1, shadowDY = 1,
    highlight = null, dark = null,
    outlineWidth = 2, hatch = null, hatchSpacing = 4, hatchSpacing2 = 8,
    cx = null, top = null, left = null, right = null, maxW = null,
    allowShrink = true,
  } = spec;

  const { w: gw, h: gh0 } = glyphSize(face);
  const gh = gh0 * scale;
  const shearW = slant ? Math.round((gh0 - 1) * slant * scale) : 0;
  let track = tracking;
  let tw = scaledWidth(face, text, track, scale) + dilate * 2 + shearW;
  if (maxW != null && tw > maxW && allowShrink) {
    while (tw > maxW && track > -(gw * scale) + 1) {
      track--;
      tw = scaledWidth(face, text, track, scale) + dilate * 2 + shearW;
    }
  }
  // `right` is the right edge of the finished ink including the outline, so the
  // glyph box stops one pixel short of it.
  const tx = right != null ? right - tw
    : left != null ? left : Math.round(cx - tw / 2);
  const ty = top != null ? top : 0;

  let pts = glyphMask(face, text, tx + dilate, ty + dilate, track, scale, slant);
  if (dilate > 0) {
    let cur = new Set(pts.map(([x, y]) => key(x, y)));
    for (let i = 0; i < dilate; i++) {
      const next = new Set(cur);
      for (const k of cur) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) next.add(key(x + dx, y + dy));
      }
      cur = next;
    }
    pts = [...cur].map((k) => k.split(',').map(Number));
  }
  const inside = new Set(pts.map(([x, y]) => key(x, y)));
  const written = new Uint8Array(W * H);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    idx[y * W + x] = c;
    written[y * W + x] = 1;
  };
  const ring = new Set();
  for (const [x, y] of pts) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      if (!inside.has(k)) ring.add(k);
    }
  }
  const ringPts = [...ring].map((k) => k.split(',').map(Number));

  if (style === 'shadow') {
    for (const [x, y] of pts) put(x + shadowDX, y + shadowDY, shadow);
    for (const [x, y] of ringPts) put(x + shadowDX, y + shadowDY, shadow);
  }
  if (style === 'hollow') {
    for (const [x, y] of ringPts) put(x, y, outline);
    return { tx, ty, tw, th: gh, track, written };
  }
  if (style === 'outline3') {
    let cur = new Set(inside);
    for (let i = 0; i < 2; i++) {
      const next = new Set(cur);
      for (const k of cur) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) next.add(key(x + dx, y + dy));
      }
      for (const k of next) if (!cur.has(k)) {
        const [x, y] = k.split(',').map(Number);
        put(x, y, outline);
      }
      cur = next;
    }
    return { tx, ty, tw, th: gh, track, written };
  }
  if (style === 'bevel') {
    for (const [x, y] of ringPts) put(x, y, outline);
    for (const [x, y] of pts) put(x, y, fill);
    for (const [x, y] of pts) {
      if (!inside.has(key(x, y - 1)) || !inside.has(key(x - 1, y))) put(x, y, highlight ?? fill);
      else if (!inside.has(key(x, y + 1)) || !inside.has(key(x + 1, y))) put(x, y, dark ?? fill);
    }
    return { tx, ty, tw, th: gh, track, written };
  }
  if (style === 'crosshatch') {
    // Architectural display lettering: a heavy solid outline around a glyph whose
    // interior is filled with diagonal hatching lines, like a pen sketch on a
    // blueprint. The outline is grown `outlineWidth` pixels so the letterform
    // still reads as a bold structural shape, then the hatch is clipped to the
    // glyph body. A second, sparser direction crosses the first to give the
    // "cross-hatch" texture the title cards use.
    let cur = new Set(inside);
    for (let i = 0; i < outlineWidth; i++) {
      const next = new Set(cur);
      for (const k of cur) {
        const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) next.add(key(x + dx, y + dy));
      }
      for (const k of next) {
        if (cur.has(k)) continue;
        const [x, y] = k.split(',').map(Number);
        put(x, y, outline);
      }
      cur = next;
    }
    for (const [x, y] of pts) put(x, y, fill);
    const mod = (v, m) => ((v % m) + m) % m;
    for (const [x, y] of pts) {
      const a = mod(x + y, hatchSpacing) === 0;
      const b = hatchSpacing2 ? mod(x - y, hatchSpacing2) === 0 : false;
      if (a || b) put(x, y, hatch ?? fill);
    }
    return { tx, ty, tw, th: gh, track, written };
  }
  // fill / shadow
  if (outline != null) for (const [x, y] of ringPts) put(x, y, outline);
  for (const [x, y] of pts) put(x, y, fill);
  return { tx, ty, tw, th: gh, track, written };
}

// Pick the first face from `prefs` whose width fits `maxW`.
export function fitFace(prefs, text, maxW, tracking, scale = 1) {
  for (const name of prefs) {
    const face = FACES[name];
    if (!face) throw new Error('unknown face ' + name);
    if (scaledWidth(face, text, tracking, scale) <= maxW) return { name, face, tracking };
  }
  const name = prefs[prefs.length - 1];
  return { name, face: FACES[name], tracking };
}

// Choose a face *and* a tracking that make `text` fit `maxW`. Tightening the
// tracking is preferred to switching to a narrower face, because a thinner face
// is a bigger change to the look than 1-2px less air between letters.
export function fitText(prefs, text, maxW, { scale = 1, tracking = 1, minTrack = 2, floor = -3 } = {}) {
  const n = [...text].length;
  const trackFor = (name) => {
    const { w } = glyphSize(FACES[name]);
    const maxFit = Math.floor((maxW - n * w * scale) / Math.max(1, n - 1));
    return Math.min(tracking, maxFit);
  };
  for (const name of prefs) {
    if (!FACES[name]) throw new Error('unknown face ' + name);
    const t = trackFor(name);
    if (t >= Math.min(tracking, minTrack)) return { name, face: FACES[name], tracking: t };
  }
  const name = prefs[prefs.length - 1];
  return { name, face: FACES[name], tracking: Math.max(floor, trackFor(name)) };
}
