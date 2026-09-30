'use strict';
/* =====================================================================
 * qr.js — giải mã QR/barcode trong ẢNH PNG, 0 dependency ngoài.
 *   - PNG decode thuần (zlib inflate + unfilter) -> RGBA
 *   - jsQR (vendored, MIT) đọc ma trận QR
 * Chỉ hỗ trợ PNG không interlaced (screenshot / ảnh QR thường là vậy).
 * ===================================================================== */
const zlib = require('node:zlib');
const jsQRmod = require('./jsQR.js');
const jsQR = jsQRmod && jsQRmod.default ? jsQRmod.default : jsQRmod;

function pngToRGBA(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
    if (len > buf.length) break;
  }
  if (!w || !h || interlace) return null;
  if (w * h > 40000000) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: 128 * 1024 * 1024 }); }
  catch { return null; }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!channels) return null;
  const bytesPP = Math.max(1, Math.ceil((bitDepth * channels) / 8)); /* byte/pixel cho unfilter */
  const stride = Math.ceil((w * channels * bitDepth) / 8);
  if (raw.length < (stride + 1) * h) return null;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const o = y * stride, po = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPP ? out[o + x - bytesPP] : 0;
      const b = y > 0 ? out[po + x] : 0;
      const c = (x >= bytesPP && y > 0) ? out[po + x - bytesPP] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[o + x] = v & 0xff;
    }
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  const maxBit = (1 << bitDepth) - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 255;
      if (bitDepth === 8) {
        const i = y * stride + x * channels;
        if (colorType === 0) { r = g = b = out[i]; }
        else if (colorType === 2) { r = out[i]; g = out[i + 1]; b = out[i + 2]; }
        else if (colorType === 3) { const pi = out[i] * 3; r = plte[pi]; g = plte[pi + 1]; b = plte[pi + 2]; if (trns && out[i] < trns.length) al = trns[out[i]]; }
        else if (colorType === 4) { r = g = b = out[i]; al = out[i + 1]; }
        else if (colorType === 6) { r = out[i]; g = out[i + 1]; b = out[i + 2]; al = out[i + 3]; }
      } else if (bitDepth === 16) {
        const i = y * stride + x * channels * 2;
        if (colorType === 0 || colorType === 4) { r = g = b = out[i]; if (colorType === 4) al = out[i + 2]; }
        else if (colorType === 2) { r = out[i]; g = out[i + 2]; b = out[i + 4]; }
        else if (colorType === 6) { r = out[i]; g = out[i + 2]; b = out[i + 4]; al = out[i + 6]; }
      } else {
        const perByte = 8 / bitDepth;
        const bi = y * stride + Math.floor(x / perByte);
        const shift = 8 - bitDepth * ((x % perByte) + 1);
        const idx = (out[bi] >> shift) & maxBit;
        if (colorType === 3) { const pi = idx * 3; r = plte[pi]; g = plte[pi + 1]; b = plte[pi + 2]; if (trns && idx < trns.length) al = trns[idx]; }
        else { const v = Math.round(idx * 255 / maxBit); r = g = b = v; }
      }
      const k = (y * w + x) * 4; rgba[k] = r; rgba[k + 1] = g; rgba[k + 2] = b; rgba[k + 3] = al;
    }
  }
  return { data: rgba, width: w, height: h };
}

/* Giải mã QR/barcode. Trả { ok, values:[...], error? } */
function decodeQR(buffer) {
  const img = pngToRGBA(buffer);
  if (!img) return { ok: false, error: 'chỉ hỗ trợ ảnh PNG (không interlaced)' };
  let res = null;
  try {
    res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
  } catch (e) { return { ok: false, error: 'decode: ' + e.message }; }
  /* ảnh nhỏ quá thì phóng to 3x rồi thử lại (QR ở xa thường nhỏ) */
  if ((!res || !res.data) && img.width < 300 && img.height < 300) {
    try {
      const S = 3, W = img.width * S, H = img.height * S;
      const big = new Uint8ClampedArray(W * H * 4);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const si = ((Math.floor(y / S)) * img.width + Math.floor(x / S)) * 4;
          const di = (y * W + x) * 4;
          big[di] = img.data[si]; big[di + 1] = img.data[si + 1]; big[di + 2] = img.data[si + 2]; big[di + 3] = img.data[si + 3];
        }
      }
      res = jsQR(big, W, H, { inversionAttempts: 'attemptBoth' });
    } catch { /* bỏ qua */ }
  }
  if (!res || !res.data) return { ok: true, values: [] };
  return { ok: true, values: [String(res.data).trim()].filter(Boolean) };
}

module.exports = { decodeQR, pngToRGBA };
