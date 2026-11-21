import { config } from '../config.js';
import { FALLBACK, menuText, runCommand } from '../commands/index.js';

// Sapaan yang dikenali. Dicek sebagai kata pertama / pesan utuh saja,
// supaya "malam minggu" tetap salam tapi kata di tengah kalimat tidak
// memicu balasan.
const GREETINGS = new Set([
  'halo',
  'hai',
  'hi',
  'hello',
  'pagi',
  'siang',
  'sore',
  'malam',
  'selamat pagi',
  'selamat siang',
  'selamat sore',
  'selamat malam',
  'assalamualaikum',
]);

function firstWord(text) {
  return text.split(/\s+/)[0] || '';
}

function isGreeting(text) {
  if (GREETINGS.has(text)) return true;
  if (GREETINGS.has(firstWord(text)) && text.split(/\s+/).length <= 3) return true;
  return false;
}

function greetingText() {
  return `Halo! Saya ${config.botName}. Ada yang bisa saya bantu?\nKetik /menu untuk lihat perintah yang tersedia.`;
}

// Logika inti bot — murni (tidak kirim pesan, tidak baca network),
// jadi bisa dites tanpa koneksi ke Telegram.
// Kembalikan string balasan, atau null kalau pesan tidak perlu dibalas
// (pesan kosong, atau bukan teks).
export function handleMessage(rawText) {
  if (typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;

  const lower = text.toLowerCase();

  // 1. Perintah Telegram: /menu, /jam, /ping, /info, /help, /start.
  // Telegram bisa menambah "@namabot" di belakang perintah grup,
  // contoh: /menu@namabot — bagian itu dibuang.
  if (lower.startsWith('/')) {
    const name = lower.slice(1).split(/[\s@]/)[0];
    const reply = runCommand(name);
    return reply ?? FALLBACK;
  }

  // 2. Perintah gaya lama: .menu, .jam, .ping
  if (lower.startsWith('.')) {
    const name = lower.slice(1).split(/\s+/)[0];
    const reply = runCommand(name);
    return reply ?? FALLBACK;
  }

  // 3. Sapaan
  if (isGreeting(lower)) return greetingText();

  // 4. Selain itu: JANGAN ngarang jawaban. Fallback sopan, itu saja.
  return FALLBACK;
}

// Tentukan balasan untuk satu update Telegram (getUpdates).
// Kembalikan { chatId, text } atau null kalau tidak perlu dibalas:
// - bukan pesan teks (foto, stiker, dll.)
// - dikirim oleh bot lain / bot sendiri
// - channel post (tidak ada chat pengirim biasa)
export function handleUpdate(update) {
  const msg = update?.message;
  if (!msg || typeof msg.text !== 'string') return null;
  if (msg.from?.is_bot) return null;
  const text = handleMessage(msg.text);
  if (text === null) return null;
  return { chatId: msg.chat.id, text };
}

export { FALLBACK, menuText };
