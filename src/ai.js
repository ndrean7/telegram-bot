// AI gratis (Gemini) buat jawab pertanyaan bebas.
// Tanpa GEMINI_API_KEY, fungsi ini balikin null dan bot tetap
// pakai balasan rule-based biasa — jadi tidak crash.
// Error dicatat di log (tanpa menampilkan key) biar ketahuan kenapa gagal.
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export async function askAI(text) {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) {
    console.error('AI nonaktif: GEMINI_API_KEY belum diisi di Variables Railway.');
    return null;
  }
  try {
    const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
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
      console.error('Gemini gagal:', res.status, data?.error?.message || JSON.stringify(data).slice(0, 200));
      return null;
    }
    const answer =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    if (!answer.trim()) console.error('Gemini balas kosong.');
    return answer.trim() || null;
  } catch (err) {
    console.error('Gemini error:', err.message);
    return null;
  }
}
