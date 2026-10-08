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

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) { ffmpegPath = null; }

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
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = (input.match(/\.(mp4|webm|mov|mkv|mp3|wav|m4a|ogg|jpg|jpeg|png)\b/i) || [])[1] || 'mp4';
    const p = path.join(ensureTemp(), 'in_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext);
    fs.writeFileSync(p, buf);
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
  const args = ['-y'];
  if (a.start != null) args.push('-ss', String(parseTime(a.start)));
  args.push('-i', input);
  if (a.duration != null) args.push('-t', String(parseTime(a.duration)));
  else if (a.end != null) args.push('-to', String(parseTime(a.end)));
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', out);
  await runFfmpeg(args);
  return out;
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
    await runFfmpeg(['-y', '-i', locals[i], '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2', o]);
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

function escapeDrawtext(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

async function opAddText(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp4');
  const fontsize = a.fontSize || 48;
  const color = a.color || 'white';
  const posMap = { top: 'x=(w-text_w)/2:y=40', bottom: 'x=(w-text_w)/2:y=h-th-60', center: 'x=(w-text_w)/2:y=(h-th)/2' };
  const pos = posMap[a.position] || posMap.bottom;
  let draw = `drawtext=text='${escapeDrawtext(a.text || '')}':fontsize=${fontsize}:fontcolor=${color}:${pos}:box=1:boxcolor=black@0.4:boxborderw=12`;
  if (a.start != null || a.duration != null) {
    const s = a.start != null ? parseTime(a.start) : 0;
    const e = a.duration != null ? s + parseTime(a.duration) : 1e6;
    draw += `:enable='between(t,${s},${e})'`;
  }
  await runFfmpeg(['-y', '-i', input, '-vf', draw, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return out;
}

async function opResize(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp4');
  const w = parseInt(a.width || a.w || 1080, 10);
  const h = parseInt(a.height || a.h || 1920, 10);
  const mode = a.mode === 'stretch' ? 'scale=' + w + ':' + h : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  await runFfmpeg(['-y', '-i', input, '-vf', mode + ',setsar=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return out;
}

async function opSpeed(a) {
  const input = await ensureLocal(a.input);
  const out = outPath('mp4');
  const sp = Number(a.speed || 1);
  if (!(sp > 0.1 && sp < 10)) throw new Error('speed phải trong 0.1..10');
  const vf = `setpts=${(1 / sp).toFixed(4)}*PTS`;
  const af = `atempo=${Math.max(0.5, Math.min(2, sp))}${sp > 2 ? ',atempo=' + (sp / 2 > 2 ? 2 : sp / 2) : ''}`;
  await runFfmpeg(['-y', '-i', input, '-filter_complex', `[0:v]${vf}[v];[0:a]${af}[a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
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
