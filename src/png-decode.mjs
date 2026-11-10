// Minimal PNG decoder (8-bit, colour types 0 / 2 / 3 / 6, no interlace).
// Returns { w, h, rgb } with a plain RGB buffer.
import fs from 'fs';
import zlib from 'zlib';

export function decodePNG(file) {
  const buf = typeof file === 'string' ? fs.readFileSync(file) : file;
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported (got ' + bitDepth + ')');
  if (interlace) throw new Error('interlaced PNG not supported');
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 3 ? 1 : 0;
  if (!ch) throw new Error('unsupported colour type ' + colorType);
  if (colorType === 3 && !plte) throw new Error('indexed PNG without PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const img = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? img[y * stride + x - ch] : 0;
      const b = y > 0 ? img[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? img[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      img[y * stride + x] = v & 0xff;
    }
  }

  const rgb = Buffer.alloc(w * h * 3);
  const alpha = Buffer.alloc(w * h, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * stride + x * ch, d = (y * w + x) * 3;
    if (colorType === 3) {
      const i = img[o];
      rgb[d] = plte[i * 3]; rgb[d + 1] = plte[i * 3 + 1]; rgb[d + 2] = plte[i * 3 + 2];
      if (trns && i < trns.length) alpha[y * w + x] = trns[i];
    } else if (ch === 1) {
      rgb[d] = rgb[d + 1] = rgb[d + 2] = img[o];
    } else {
      rgb[d] = img[o]; rgb[d + 1] = img[o + 1]; rgb[d + 2] = img[o + 2];
      if (ch === 4) alpha[y * w + x] = img[o + 3];
    }
  }
  return { w, h, rgb, alpha };
}
