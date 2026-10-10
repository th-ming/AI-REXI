// internalAgent.js — agent-loop chạy HOÀN TOÀN bằng API provider (không cần opencode.exe/dsh),
// nên hoạt động cả trên Linux/container (Render/VPS). Protocol: ReAct JSON — model bắt buộc
// trả 1 object JSON mỗi bước hoặc file → parse được. executeTool + stop: model nào cũng dùng được.

const { executeTool, TOOL_REGISTRY, getAgentChain } = require('./agentService');
const db = require('../config/db');
const { decryptKey } = require('../utils/cryptoKeys');
const { PROVIDER_ENDPOINTS } = require('../model-scanner.scheduler');

const AGENT_PROVIDER = (process.env.AGENT_PROVIDER || 'unorouter').toLowerCase();
const AGENT_MODEL = process.env.AGENT_MODEL || 'deepseek-v4-flash:free';
const MAX_STEPS = parseInt(process.env.AGENT_MAX_STEPS || '6');
const TOTAL_DEADLINE_MS = parseInt(process.env.AGENT_DEADLINE_MS || '120000'); // 2 phút: luôn trả lời trước khi proxy timeout
const TOOL_TIMEOUT_MS = parseInt(process.env.AGENT_TOOL_TIMEOUT_MS || '40000'); // tool nặng (browser) fail nhanh

// Fallback chain DONG (thay FALLBACK_PROVIDERS cung): lay tu getAgentChain()
// (env -> DB agent_chain -> mac dinh deepseek/xkiro/kiosapi). Doi qua API, khong can deploy.
async function getFallbackChain(excludeProvider, excludeModel) {
  try {
    const chain = await getAgentChain();
    return chain.filter(f => !(f.provider === excludeProvider && f.model === excludeModel));
  } catch {
    return [
      { provider: 'unorouter', model: 'deepseek-v4.1-flash:free' },
      { provider: 'xkiro', model: 'mistralai/mistral-small-2603' },
      { provider: 'kiosapi', model: 'sensenova-6.8-flash' },
    ].filter(f => !(f.provider === excludeProvider && f.model === excludeModel));
  }
}

// Tim provider tu model id user chon (ai_models, uu tien dang active)
async function resolveModelProvider(modelId) {
  try {
    const m = String(modelId || '').trim();
    if (!m) return null;
    const short = m.includes('/') ? m.split('/').pop() : m;
    const rows = await new Promise((res) => db.all(
      'SELECT ma_nha_cung_cap FROM ai_models WHERE (LOWER(ma_model) = LOWER(?) OR LOWER(ma_model) = LOWER(?)) AND kich_hoat = 1 ORDER BY thu_tu_hien_thi LIMIT 1',
      [m, short], (e, r) => res(e ? [] : (r || []))));
    if (rows.length) return String(rows[0].ma_nha_cung_cap).toLowerCase();
  } catch { /* ignore */ }
  return null;
}

async function getKey(provider) {
  const rows = await new Promise((res) => db.all(
    "SELECT gia_tri_khoa FROM khoa_api WHERE LOWER(ten_nha_cung_cap) = ? AND gia_tri_khoa IS NOT NULL AND TRIM(gia_tri_khoa) <> '' LIMIT 1",
    [provider], (e, r) => res(e ? [] : (r || []))));
  if (!rows.length) return process.env[`${provider.toUpperCase()}_API_KEY`] || null;
  try { return decryptKey(rows[0].gia_tri_khoa).trim(); } catch { return rows[0].gia_tri_khoa; }
}

function chatUrl(provider) {
  const ep = PROVIDER_ENDPOINTS[provider];
  if (ep && ep.endpoint) return ep.endpoint.replace(/\/models\/?$/, '') + '/chat/completions';
  throw new Error(`Không biết chat endpoint cho provider ${provider}`);
}

function buildSystemPrompt(allowedTools) {
  const list = (allowedTools && allowedTools.length)
    ? TOOL_REGISTRY.filter(t => allowedTools.includes(t.name))
    : TOOL_REGISTRY;
  const tools = list.map(t => {
    const params = (t.parameters && t.parameters.properties)
      ? Object.entries(t.parameters.properties).map(([k, v]) => `"${k}": (${v.type || 'string'}) ${String(v.description || '').slice(0, 90)}`).join('; ')
      : '';
    return `- ${t.name}: ${String(t.description || '').slice(0, 160)}${params ? ' | tham số: ' + params : ''}`;
  }).join('\n');
  return `Bạn là agent nội bộ của Rexi AI, chạy trên server Linux. Bạn giải quyết việc bằng cách lặp lại các bước.

TOOL KHẢ DỤNG:
${tools}

MỖI BƯỚC bạn CHỈ ĐƯỢC trả về ĐÚNG một JSON object (không markdown, không giải thích thêm), dạng:
1) Cần dùng tool:
{"thought":"<ngắn gọn>","tool":"<tên tool>","args":{...}}
2) Đã xong, trả lời người dùng:
{"thought":"<ngắn gọn>","answer":"<câu trả lời cuối, tiếng Việt>"}

Quy tắc: dùng tool khi thực sự cần; kiểm tra kết quả (OBSERVATION) trước khi bước tiếp; tối đa ${MAX_STEPS} bước; thất bại 2 lần liên tiếp cùng tool → đổi cách khác hoặc answer nêu rõ lỗi; tuyệt đối không bịa kết quả tool.
ĐỌC NỘI DUNG WEB: browser_navigate đã TRẢ LUÔN tiêu đề + text trang → dùng nó để tóm tắt/trả lời ngay, KHÔNG cần thêm bước; nếu cần đọc lại dùng browser_read. KHÔNG dùng browser_screenshot (bạn không đọc được ảnh). Nếu cần thông tin mới → search_web; đọc 1 URL bất kỳ → web_analyze.`;
}

function extractJson(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cand = fence ? fence[1] : s;
  const start = cand.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cand.length; i++) {
    const ch = cand[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(cand.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function callModel(baseUrl, key, model, messages) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 1200 }),
    signal: AbortSignal.timeout(90000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* noop */ }
  if (!res.ok) { const e = new Error(`LLM ${res.status}: ${(json && (json.error?.message || json.message)) || text.slice(0, 160)}`); e.status = res.status; throw e; }
  let content = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content)
    || (json && json.choices && json.choices[0] && json.choices[0].text) || '';
  if (!content && json) { // SSE-flavored body fallback
    content = String(text).split('\n').filter(l => l.startsWith('data:')).map(l => { try { const j = JSON.parse(l.slice(5)); return j.choices?.[0]?.delta?.content || ''; } catch { return ''; } }).join('');
  }
  return String(content);
}

async function runInternalAgent(prompt, { provider, model, onEvent, allowedTools } = {}) {
  // Dung model user chon (resolve provider tu DB); fallback chain dong
  model = model || AGENT_MODEL;
  if (!provider || provider === 'auto') {
    provider = (await resolveModelProvider(model)) || AGENT_PROVIDER;
  }
  provider = String(provider).toLowerCase();
  // Chain: model user chon truoc, sau do fallback dong (env/DB/mac dinh)
  const chain = [{ provider, model }]
    .concat(await getFallbackChain(provider, model));
  let lastErr = null;
  for (const cand of chain) {
    try {
      return await runAgentLoop(prompt, cand.provider, cand.model, onEvent, allowedTools);
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || e);
      // Chỉ failover khi lỗi provider (credit/hết quota/model chết/key), không retry lỗi logic
      if (!/LLM (400|401|402|403|404|429|5\d\d)|chưa có API key|Không biết chat endpoint/i.test(msg)) throw e;
      if (onEvent) onEvent({ failover: cand.provider, error: msg.slice(0, 160) });
    }
  }
  throw lastErr || new Error('Không có provider AI khả dụng');
}

async function runAgentLoop(prompt, provider, model, onEvent, allowedTools) {
  const key = await getKey(provider);
  if (!key) throw new Error(`Provider ${provider} chưa có API key trong khoa_api (env AGENT_PROVIDER/AGENT_MODEL để đổi)`);
  const baseUrl = chatUrl(provider);
  const messages = [{ role: 'system', content: buildSystemPrompt(allowedTools) }, { role: 'user', content: String(prompt) }];
  const steps = [];
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (Date.now() > deadline) throw new Error('Agent hết thời gian (4 phút)');
    const raw = await callModel(baseUrl, key, model, messages);
    const act = extractJson(raw);
    if (onEvent) onEvent({ step, raw: raw.slice(0, 400) });
    if (!act || typeof act !== 'object') {
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: 'OBSERVATION: phản hồi không phải JSON hợp lệ. Trả lời ĐÚNG 1 object JSON như hướng dẫn.' });
      continue;
    }
    if (act.answer) {
      steps.push({ step: step + 1, thought: act.thought || '', answer: String(act.answer).slice(0, 20000) });
      return { success: true, provider, model, steps, answer: String(act.answer), rounds: step + 1 };
    }
    if (act.tool) {
      let toolResult;
      if (allowedTools && allowedTools.length && !allowedTools.includes(act.tool)) {
        toolResult = { error: 'Tool "' + act.tool + '" không được phép trong ngữ cảnh này. Chỉ dùng: ' + allowedTools.join(', ') };
      } else {
        try {
          toolResult = await Promise.race([
            executeTool(act.tool, act.args || {}),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`tool ${act.tool} timeout`)), TOOL_TIMEOUT_MS)),
          ]);
        } catch (e) { toolResult = { error: String(e && e.message || e) }; }
      }
      const slim = JSON.stringify(toolResult).slice(0, 6000);
      steps.push({ step: step + 1, thought: act.thought || '', tool: act.tool, args: act.args, result: slim.slice(0, 500) });
      messages.push({ role: 'assistant', content: JSON.stringify({ thought: act.thought || '', tool: act.tool, args: act.args }) });
      messages.push({ role: 'user', content: `OBSERVATION (${act.tool}): ${slim}` });
      continue;
    }
    return { success: false, error: 'Model trả JSON không hợp lệ (thiếu answer/tool)', steps };
  }
  return { success: false, error: `Đạt trần ${MAX_STEPS} bước mà chưa có câu trả lời`, steps };
}

module.exports = { runInternalAgent };
