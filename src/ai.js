// AI gratis (Gemini) buat jawab pertanyaan bebas.
// Tanpa GEMINI_API_KEY, fungsi ini balikin null dan bot tetap
// pakai balasan rule-based biasa — jadi tidak crash.
// Error dicatat di log (tanpa menampilkan key) biar ketahuan kenapa gagal.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PRIMARY = 'gemini-3.8-flash';
export const AI_BUSY = 'AI-nya lagi sibuk (server Google penuh). Coba tanya lagi bentar ya.';

// Daftar model cadangan diambil sekali dari ListModels (model flash yang bisa
// generateContent), supaya kalau model utama penuh (503) bisa pindah otomatis.
let modelCache = null;
let lastGood = null;
async function candidateModels(key) {
  if (modelCache) return modelCache;
  let extra = [];
  try {
    const res = await fetch(`${BASE}/models?pageSize=200&key=${encodeURIComponent(key)}`);
    const data = await res.json().catch(() => ({}));
    extra = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((n) => /(flash|gemma)/.test(n) && !/(image|tts|audio|live|embedding|thinking-exp|preview)/.test(n));
  } catch {
    extra = [];
  }
  const flash = extra.filter((n) => /flash/.test(n) && !/2\.0|1\.5/.test(n)).slice(0, 4);
  // Gemma: kuota terpisah dari Gemini, jadi cadangan terakhir kalau Gemini penuh.
  const gemma = extra.filter((n) => /^gemma-\d.*(27b|12b)/.test(n)).slice(0, 2);
  modelCache = [...new Set([PRIMARY, ...flash, ...gemma])];
  return modelCache;
}

export async function askAI(text) {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) {
    console.error('AI nonaktif: GEMINI_API_KEY belum diisi di Variables Railway.');
    return null;
  }
  const prompt = text;
  const models = await candidateModels(key);
  if (lastGood && models.includes(lastGood)) models.sort((a, b) => (a === lastGood ? -1 : b === lastGood ? 1 : 0));
  let busy = false;
  for (const model of [...models]) {
    const r = await callModel(model, key, prompt);
    if (r.answer) { lastGood = model; return r.answer; }
    if (r.status === 404) { modelCache = modelCache.filter((m) => m !== model); continue; }
    if (r.retryable) busy = true;
    else if (r.status && r.status !== 404) break; // error lain (mis. key salah): jangan coba terus
  }
  return busy ? AI_BUSY : null;
}

async function callModel(model, key, text) {
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(9000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text:
                  'Kamu adalah bot Telegram bernama 0xndrean7. Jawab dengan bahasa Indonesia santai, kayak orang biasa ngobrol, singkat, jangan kaku, jangan pakai bahasa formal. Jangan ngaku kamu AI, jangan bilang kamu model bahasa. PENTING: jangan ngawur, jangan ngarang jawaban. Kalau tidak tahu jawabannya, bilang dengan santai kamu tidak tahu dan jangan tebak. Jangan invent nama, angka, tanggal, atau fakta. Jawab hanya yang kamu yakin benar.\n\nPertanyaan: ' +
                  text,
              },
            ],
          },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`Gemini gagal (${model}):`, res.status, data?.error?.message || JSON.stringify(data).slice(0, 200));
      return { status: res.status, retryable: res.status === 503 || res.status === 429 || res.status >= 500 };
    }
    const answer =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    if (!answer.trim()) console.error(`Gemini balas kosong (${model}).`);
    return { answer: answer.trim() || null, retryable: !answer.trim() };
  } catch (err) {
    console.error(`Gemini error (${model}):`, err.message);
    return { retryable: true };
  }
}
