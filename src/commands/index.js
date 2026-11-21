import { config } from '../config.js';
import { formatUptime, nowWIB, todayWIB } from '../utils/time.js';

export const FALLBACK =
  'Waduh, gua nggak ngerti maksud lo. Coba /menu deh, di situ ada yang bisa gua lakuin.';

const STARTED_AT = Date.now();

export function menuText() {
  return [
    'Nih, yang bisa gua lakuin:',
    '/menu — liat daftar ini lagi',
    '/info — tentang gua',
    '/jam — jam berapa sekarang (WIB)',
    '/ping — ngecek gua masih hidup apa nggak',
    '',
    'Sapa gua aja juga boleh, halo, pagi, sore, malam, bebas.',
  ].join('\n');
}

export function infoText() {
  return [
    `Gua ${config.botName}, Bot Telegram biasa aja.`,
    'Jalan pakai Bot API resmi Telegram.',
    'Coba /menu, /info, /jam, /ping.',
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
      return `Sekarang ${todayWIB()}, jam ${nowWIB()} WIB.`;
    case 'ping':
      return `Pong! Gua masih hidup, udah jalan ${formatUptime(STARTED_AT)}.`;
    case 'start':
      return `Halo! Gua ${config.botName}. Mau ngapain? Cek /menu dulu deh.`;
    default:
      return null;
  }
}
