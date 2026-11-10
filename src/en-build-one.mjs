// Build one asset's English recreation in memory. Shared by the batch builder and
// the comparison-sheet generator so both always see exactly the same pixels.
import {
  loadAsset, writeBackParts, writeBackTilemap, assembleFromParts, compositeScreen,
} from './asset-canvas.mjs';
import { eraseText, drawText, fitFace, fitText } from './en-render.mjs';
import { FACES, glyphSize, textWidth } from './en-fonts.mjs';
import { ASSETS } from './en-styles.mjs';

const same = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export function buildOne(hex) {
  const cfg = ASSETS[hex];
  if (!cfg) throw new Error('no config for ' + hex);
  const asset = loadAsset(parseInt(hex, 16));
  if (!asset) return { ok: false, reason: 'no graphic' };

  const { W, H } = asset;
  const grid = new Uint8Array(asset.idx);
  const before = new Uint8Array(asset.idx);
  const drawMask = new Uint8Array(W * H);

  if (cfg.passthrough) {
    let wb = null, roundtrip = 'n/a';
    if (asset.mode === 'parts') {
      wb = writeBackParts(asset, grid);
      roundtrip = same(assembleFromParts(wb.tiles, asset.parts).idx, grid) ? 'ok' : 'FAIL';
    } else if (asset.mode === 'tilemap') {
      wb = writeBackTilemap(asset, grid);
      roundtrip = same(compositeScreen(wb.tiles, wb.map ?? asset.map).idx, grid) ? 'ok' : 'FAIL';
    }
    return {
      ok: true, hex, id: parseInt(hex, 16), mode: asset.mode, W, H,
      grid, before, placements: [],
      er: { mask: new Uint8Array(W * H), erased: 0 },
      box: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 },
      text: cfg.text,
      changedInside: 0, changedOutside: 0, structural: 0, bad: [],
      conflicts: 0, roundtrip,
      style: 'passthrough',
    };
  }

  // A config is either one erase region plus one or more lines, or a list of
  // independent regions (`items`) for assets whose text sits in separate plates
  // that need their own erase mode (e.g. the five keycaps of a d-pad).
  const regions = cfg.items ?? [cfg];
  const erMaskAll = new Uint8Array(W * H);
  const boxes = [];
  let erasedTotal = 0, firstEr = null;
  const placements = [];

  for (const reg of regions) {
    const e = reg.erase;
    const box = e.box ?? { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
    const er = eraseText(grid, W, H, box, e.mode, {
      ink: e.ink, face: e.face, bg: e.bg, bg0: e.bg0, clip: e.clip,
      body: e.body, rimColours: e.rimColours, frameColours: e.frameColours,
      dilateInk: e.dilateInk, dilatePasses: e.dilatePasses, bgRows: e.bgRows, bbox: e.bbox,
    });
    if (!er.bbox) return { ok: false, reason: 'no ink found' };
    for (let p = 0; p < W * H; p++) if (er.mask[p]) erMaskAll[p] = 1;
    erasedTotal += er.erased;
    boxes.push(box);
    if (!firstEr) firstEr = er;

    const draws = [];
    if (reg.lines) {
      // Each line needs its own erase bbox so it can be centred on the row it
      // replaces. A line may name its rows outright; otherwise the bbox is split
      // into equal bands (or, for the common two-line case, at `splitRows`).
      const n = reg.lines.length;
      const bands = reg.lines.map((line, i) => {
        if (line.rows) return { minY: line.rows[0], maxY: line.rows[1] };
        if (n === 2) {
          const split = reg.splitRows ?? Math.round((er.bbox.minY + er.bbox.maxY) / 2);
          return i === 0 ? { minY: er.bbox.minY, maxY: split } : { minY: split + 1, maxY: er.bbox.maxY };
        }
        const h = (er.bbox.maxY - er.bbox.minY + 1) / n;
        return {
          minY: Math.round(er.bbox.minY + i * h),
          maxY: Math.round(er.bbox.minY + (i + 1) * h) - 1,
        };
      });
      reg.lines.forEach((line, i) => {
        let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
        for (let y = bands[i].minY; y <= bands[i].maxY; y++) {
          for (let x = er.bbox.minX; x <= er.bbox.maxX; x++) {
            const p = y * W + x;
            if (!er.mask[p]) continue;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        draws.push({ spec: { ...line.draw, text: line.text }, bbox: { minX, maxX, minY, maxY } });
      });
    } else {
      draws.push({ spec: { ...reg.draw, text: reg.text }, bbox: er.bbox });
    }

    for (const d of draws) {
      const { spec, bbox } = d;
      const scale = spec.scale ?? 1;
      // The ROM's own font is case-less (all kana) and the hand-designed faces
      // only carry A-Z, so every recreation is set in capitals.
      const text = spec.text.toUpperCase();
      let faceName = spec.face;
      let track = spec.tracking ?? 1;
      if (spec.maxW != null) {
        const fit = fitText(spec.faces ?? [spec.face, 'COND7', 'COND6'], text, spec.maxW, {
          scale, tracking: track, minTrack: spec.minTrack ?? 2,
        });
        faceName = fit.name;
        track = fit.tracking;
      }
      const face = FACES[faceName];
      const { h: gh0 } = glyphSize(face);
      const gh = gh0 * scale;
      const cx = spec.cx ?? (bbox.minX + bbox.maxX) / 2;
      let top = spec.top;
      if (top == null) {
        top = spec.valign === 'top'
          ? bbox.minY
          : bbox.minY + Math.round(((bbox.maxY - bbox.minY + 1) - gh) / 2);
      }
      const placed = drawText(grid, W, H, { ...spec, text, face, cx, top, tracking: track });
      for (let p = 0; p < W * H; p++) if (placed.written[p]) drawMask[p] = 1;
      placements.push({ ...placed, face: faceName, text, scale });
    }
  }

  // Flat rectangles painted after the lettering. Used for the few assets whose
  // original art contains a non-text element that has to be redrawn by hand
  // (e.g. the boxed L shoulder-button key on the BACK label).
  for (const r of cfg.rects ?? []) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      grid[y * W + x] = r.c;
      drawMask[y * W + x] = 1;
    }
  }

  // Strict invariant: a pixel may change only if the erase stage claimed it or
  // the text renderer wrote it. Anything else is structural damage to the plate.
  let structural = 0, changedInside = 0, changedOutside = 0;
  const bad = [];
  for (let p = 0; p < W * H; p++) {
    if (before[p] === grid[p]) continue;
    const x = p % W, y = Math.floor(p / W);
    const inBox = boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    if (inBox) changedInside++; else changedOutside++;
    if (!erMaskAll[p] && !drawMask[p]) {
      structural++;
      if (bad.length < 8) bad.push(`(${x},${y}) ${before[p].toString(16)}->${grid[p].toString(16)}`);
    }
  }

  let wb = null, roundtrip = 'n/a';
  if (asset.mode === 'parts') {
    wb = writeBackParts(asset, grid);
    roundtrip = same(assembleFromParts(wb.tiles, asset.parts).idx, grid) ? 'ok' : 'FAIL';
  } else if (asset.mode === 'tilemap') {
    wb = writeBackTilemap(asset, grid);
    roundtrip = same(compositeScreen(wb.tiles, wb.map ?? asset.map).idx, grid) ? 'ok' : 'FAIL';
  }

  return {
    ok: true, hex, id: parseInt(hex, 16), mode: asset.mode, W, H,
    grid, before, placements,
    er: { ...firstEr, mask: erMaskAll, erased: erasedTotal },
    box: boxes[0],
    text: cfg.text ?? cfg.lines?.map((l) => l.text) ?? cfg.items?.map((i) => i.text ?? i.lines?.map((l) => l.text)),
    changedInside, changedOutside, structural, bad,
    conflicts: wb ? wb.conflicts : null, roundtrip,
    style: cfg.draw?.style ?? cfg.items?.[0]?.draw?.style ?? 'lines',
  };
}
