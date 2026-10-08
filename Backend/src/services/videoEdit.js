/**
 * videoEdit.js — dựng/sửa video bằng FFmpeg (ffmpeg-static), không cần GUI.
 * Dùng cho agent (tool video_edit) + route /services/video/edit.
 *
 * Hỗ trợ: trim | concat | add_audio | add_text | resize | speed | extract_audio | thumbnail
 * Input: đường dẫn file local HOẶC URL http(s) (tự tải về temp).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = null; }

let ffprobePath = null;
try { ffprobePath = require('ffprobe-static').path; } catch (e) { ffprobePath = null; }

let _chromium = null;
try { _chromium = require('playwright').chromium; } catch (e) { _chromium = null; }

const TEMP_DIR = path.join(__dirname, '..', '..', 'temp');

function ensureTemp() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

function haveFfmpeg() {
  return !!ffmpegPath && fs.existsSync(ffmpegPath);
}

function runFfmpeg(args, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!haveFfmpeg()) return reject(new Error('ffmpeg chưa có (ffmpeg-static không tìm thấy)'));
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} reject(new Error('ffmpeg timeout')); }, timeout);
    proc.stderr.on('data', d => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('ffmpeg exit ' + code + ': ' + err.split('\n').filter(Boolean).slice(-3).join(' | ')));
    });
  });
}

async function ensureLocal(input) {
  if (!input) throw new Error('Thiếu input');
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input, { redirect: 'follow' });
    if (!res.ok) throw new Error('Tải input HTTP ' + res.status);
    const ext = (input.match(/\.(mp4|webm|mov|mkv|mp3|wav|m4a|ogg|jpg|jpeg|png)\b/i) || [])[1] || 'mp4';
    const p = path.join(ensureTemp(), 'in_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext);
    // Stream thẳng xuống đĩa (không giữ cả file trong RAM → tránh OOM)
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(p));
    return p;
  }
  if (!fs.existsSync(input)) throw new Error('Không thấy file input: ' + input);
  return input;
}

function outPath(ext) {
  return path.join(ensureTemp(), 'edited_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext);
}

function parseTime(t) {
  if (typeof t === 'number') return t;
  if (typeof t === 'string' && /^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  if (typeof t === 'string' && /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(t)) {
    const parts = t.split(':').map(Number);
    while (parts.length < 3) parts.unshift(0);
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  throw new Error('Thời gian không hợp lệ: ' + t);
}

async function opTrim(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp4');
  const ss = a.start != null ? String(parseTime(a.start)) : null;
  const dur = a.duration != null ? String(parseTime(a.duration)) : (a.end != null ? null : null);
  const to = a.end != null ? String(parseTime(a.end)) : null;
  // Ưu tiên stream-copy (KHÔNG re-encode): nhanh + gần như không tốn RAM/CPU
  const copyArgs = ['-y'];
  if (ss) copyArgs.push('-ss', ss);
  if (a.loop) copyArgs.push('-stream_loop', '-1');
  copyArgs.push('-i', input);
  if (dur) copyArgs.push('-t', dur); else if (to) copyArgs.push('-to', to);
  copyArgs.push('-c', 'copy', '-movflags', '+faststart', out);
  try {
    await runFfmpeg(copyArgs);
    return out;
  } catch (e) {
    // Fallback: re-encode nhẹ
    const re = ['-y'];
    if (ss) re.push('-ss', ss);
    if (a.loop) re.push('-stream_loop', '-1');
    re.push('-i', input);
    if (dur) re.push('-t', dur); else if (to) re.push('-to', to);
    re.push('-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out);
    await runFfmpeg(re);
    return out;
  }
}

async function opConcat(a) {
  const list = Array.isArray(a.inputs) ? a.inputs : [];
  if (list.length < 2) throw new Error('concat cần >= 2 input');
  const locals = [];
  for (const it of list) locals.push(await ensureLocal(it));
  // Chuẩn hoá từng clip về cùng codec/res rồi ghép (an toàn cho mọi nguồn)
  const norm = [];
  for (let i = 0; i < locals.length; i++) {
    const o = outPath('mp4');
    await runFfmpeg(['-y', '-i', locals[i], '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1', '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', o]);
    norm.push(o);
  }
  const listFile = path.join(ensureTemp(), 'concat_' + Date.now() + '.txt');
  fs.writeFileSync(listFile, norm.map(p => "file '" + p.replace(/'/g, "'\\''") + "'").join('\n'));
  const out = outPath('mp4');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out]);
  return out;
}

async function opAddAudio(a) {
  const input = await ensureLocal(a.input);
  const audio = await ensureLocal(a.audio);
  const out = outPath('mp4');
  const mix = (a.mix != null) ? Math.max(0, Math.min(1, Number(a.mix))) : 0.3;
  const loopFlag = a.loop === false ? '' : '';
  const args = ['-y', '-i', input, '-stream_loop', a.loop === false ? '0' : '-1', '-i', audio,
    '-filter_complex', `[1:a]volume=${mix}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]`,
    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out];
  try { await runFfmpeg(args); }
  catch (e) {
    // nếu video gốc không có audio → chỉ gắn nhạc
    await runFfmpeg(['-y', '-i', input, '-stream_loop', a.loop === false ? '0' : '-1', '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out]);
  }
  return out;
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function probeDims(file) {
  return new Promise((resolve) => {
    if (!ffprobePath || !fs.existsSync(ffprobePath)) return resolve({ width: 1280, height: 720 });
    const p = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]);
    let o = '';
    p.stdout.on('data', d => { o += d.toString(); });
    p.on('close', () => { const m = o.trim().split('x'); resolve({ width: parseInt(m[0], 10) || 1280, height: parseInt(m[1], 10) || 720 }); });
    p.on('error', () => resolve({ width: 1280, height: 720 }));
  });
}

async function renderTextPng({ width, height, text, position, color, fontSize }) {
  if (!_chromium) throw new Error('Server chua co Playwright (chromium) de ve chu');
  const { launchBrowser } = require('./videoRenderer');
  const launched = await launchBrowser(_chromium);
  const browser = launched.browser;
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const align = position === 'top' ? 'flex-start' : (position === 'center' ? 'center' : 'flex-end');
    const pad = position === 'top' ? 'padding-top:40px' : (position === 'center' ? '' : 'padding-bottom:60px');
    const html = `<html><body style="margin:0;width:${width}px;height:${height}px;display:flex;justify-content:center;align-items:${align};box-sizing:border-box;${pad};background:transparent;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
      <span style="font-size:${fontSize}px;font-weight:700;color:${color};background:rgba(0,0,0,.42);padding:6px 16px;border-radius:10px;white-space:nowrap;max-width:94%;overflow:hidden;text-overflow:ellipsis">${escHtml(text)}</span>
    </body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    return await page.screenshot({ omitBackground: true, type: 'png' });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function opAddText(a) {
  const input = await ensureLocal(a.input);
  const { width, height } = await probeDims(input);
  const png = await renderTextPng({ width, height, text: a.text || '', position: a.position || 'bottom', color: a.color || 'white', fontSize: a.fontSize || 48 });
  const pngPath = outPath('png');
  fs.writeFileSync(pngPath, png);
  const out = outPath('mp4');
  await runFfmpeg(['-y', '-i', input, '-i', pngPath, '-filter_complex', '[0:v][1:v]overlay=0:0[v]', '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return out;
}

async function opResize(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp4');
  const w = parseInt(a.width || a.w || 1080, 10);
  const h = parseInt(a.height || a.h || 1920, 10);
  const mode = a.mode === 'stretch' ? 'scale=' + w + ':' + h : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  await runFfmpeg(['-y', '-i', input, '-vf', mode + ',setsar=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return out;
}

async function opSpeed(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp4');
  const sp = Number(a.speed || 1);
  if (!(sp > 0.1 && sp < 10)) throw new Error('speed phải trong 0.1..10');
  const vf = `setpts=${(1 / sp).toFixed(4)}*PTS`;
  const af = `atempo=${Math.max(0.5, Math.min(2, sp))}${sp > 2 ? ',atempo=' + (sp / 2 > 2 ? 2 : sp / 2) : ''}`;
  await runFfmpeg(['-y', '-i', input, '-filter_complex', `[0:v]${vf}[v];[0:a]${af}[a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  return out;
}

async function opExtractAudio(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp3');
  await runFfmpeg(['-y', '-i', input, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', out]);
  return out;
}

async function opThumbnail(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('jpg');
  const t = a.at != null ? parseTime(a.at) : 1;
  await runFfmpeg(['-y', '-ss', String(t), '-i', input, '-frames:v', '1', '-q:v', '2', out]);
  return out;
}

const OPS = {
  trim: opTrim, concat: opConcat, add_audio: opAddAudio, add_text: opAddText,
  resize: opResize, speed: opSpeed, extract_audio: opExtractAudio, thumbnail: opThumbnail,
};

async function videoEdit(args = {}) {
  const op = String(args.operation || '').toLowerCase();
  const fn = OPS[op];
  if (!fn) return { success: false, error: 'operation không hỗ trợ: ' + op + ' (dùng: ' + Object.keys(OPS).join(', ') + ')' };
  if (!haveFfmpeg()) return { success: false, error: 'FFmpeg chưa có trên server (ffmpeg-static thiếu)' };
  try {
    const out = await fn(args);
    const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
    return { success: true, operation: op, outputFile: out, fileName: path.basename(out), sizeBytes: size };
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

module.exports = { videoEdit, haveFfmpeg, TEMP_DIR, OPS };
