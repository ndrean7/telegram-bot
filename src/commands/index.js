import { config } from '../config.js';
import { formatUptime, nowWIB, todayWIB } from '../utils/time.js';

export const FALLBACK =
  'Maaf, saya tidak mengerti. Ketik /menu untuk lihat perintah yang tersedia.';

const STARTED_AT = Date.now();

export function menuText() {
  return [
    'Perintah yang tersedia:',
    '/menu — lihat daftar perintah',
    '/info — info bot',
    '/jam — jam sekarang (WIB)',
    '/ping — cek bot hidup',
    '',
    'Balas salam (halo, pagi, sore, malam) juga bisa.',
  ].join('\n');
}

export function infoText() {
  return [
    `${config.botName} — bot Telegram umum.`,
    'Dibuat dengan Bot API resmi Telegram.',
    'Perintah: /menu, /info, /jam, /ping.',
  ].join('\n');
}

// Jalankan satu perintah (tanpa prefix, sudah huruf kecil).
// Kembalikan teks balasan, atau null kalau perintah tidak dikenal.
export function runCommand(name) {
  switch (name) {
    case 'menu':
    case 'help':
    case 'bantuan':
      return menuText();
    case 'info':
      return infoText();
    case 'jam':
      return `Sekarang ${todayWIB()}, pukul ${nowWIB()} WIB.`;
    case 'ping':
      return `Pong! Bot hidup, sudah jalan ${formatUptime(STARTED_AT)}.`;
    case 'start':
      return `Halo! Saya ${config.botName}. Ketik /menu untuk lihat perintah yang tersedia.`;
    default:
      return null;
  }
}
