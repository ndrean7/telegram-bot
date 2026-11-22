import { config } from '../config.js';
import { formatUptime, nowWIB, todayWIB } from '../utils/time.js';

export const FALLBACK =
  'Waduh, gua nggak ngerti maksud lo. Coba /menu deh, di situ ada yang bisa gua lakuin.';

// Penanda perintah /market — index.js mengganti ini dengan hasil
// buildBriefing() (async), jadi runCommand tetap sinkron.
export const MARKET_REQUEST = '[[MARKET]]';

// Penanda perintah /info — index.js mengganti ini dengan checklist
// check-in harian + inline keyboard (async, baca state).
export const INFO_REQUEST = '[[INFO]]';

// Penanda perintah /akumulasi (/distribusi, alias lama /bandar) — index.js mengganti ini dengan hasil
// scan akumulasi & distribusi lintas bursa (async di background, ~1 menit, cache 5 menit).
export const BANDAR_REQUEST = '[[BANDAR]]';

const STARTED_AT = Date.now();

export function menuText() {
  return [
    'Nih, yang bisa gua lakuin:',
    '/menu — liat daftar ini lagi',
    '/info — checklist check-in testnet harian',
    '/jam — jam berapa sekarang (WIB)',
    '/ping — ngecek gua masih hidup apa nggak',
    '/market — Market Live (forex, crypto, saham)',
    '/akumulasi — Akumulasi & distribusi crypto (scan ~100 koin, lintas bursa; /distribusi juga bisa)',
    '',
    'Sapa gua aja juga boleh, halo, pagi, sore, malam, bebas.',
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
      return INFO_REQUEST;
    case 'jam':
      return `Sekarang ${todayWIB()}, jam ${nowWIB()} WIB.`;
    case 'ping':
      return `Pong! Gua masih hidup, udah jalan ${formatUptime(STARTED_AT)}.`;
    case 'market':
      return MARKET_REQUEST;
    case 'akumulasi':
    case 'distribusi':
    case 'bandar': // alias lama, disembunyikan dari menu
      return BANDAR_REQUEST;
    case 'start':
      return `Halo! Gua ${config.botName}. Mau ngapain? Cek /menu dulu deh.`;
    default:
      return null;
  }
}
