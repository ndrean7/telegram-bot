// Checklist check-in testnet harian (/info).
// Daftar ini HANYA berisi testnet yang terkonfirmasi punya tugas harian
// di memory user. URL hanya yang terkonfirmasi di memory — item tanpa
// URL tampil tanpa link (jangan karang URL).
// State: checkins.json {"2026-11-22": {"asentum": true}} — dikunci per
// tanggal WIB, jadi hari baru mulai kosong otomatis. File ini TIDAK
// di-commit (masuk .gitignore) dan hilang kalau Railway redeploy dari
// nol — sama seperti subscribers.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { todayWIB } from './utils/time.js';

export const CHECKINS = [
  { key: 'asentum', name: 'Asentum', url: 'https://airdrop.asentum.com/', note: 'check-in +15 XP' },
  { key: 'amadeus', name: 'Amadeus (AMA Hub)', url: 'https://amahub.ama.one/quests/', note: 'check-in +25 PRIME' },
  { key: 'ammora', name: 'Ammora', url: 'https://ammora.org/waitlist', note: 'check-in +100 AP' },
  { key: 'kalos', name: 'Kalos', url: 'https://kalos.fun', note: 'check-in (tanda tangan)' },
  { key: 'dfusion', name: 'dFusion', url: 'https://testnet.dfusion.ai', note: '3 chat harian' },
  { key: 'swarmbase', name: 'SwarmBase', url: 'https://point.swarmbase.io', note: 'check-in +10 poin' },
  { key: 'agnt', name: 'AGNT Hub', url: null, note: 'check-in + Daily Meme' },
  { key: 'pushchain', name: 'PushChain', url: null, note: 'check-in + faucet 6 jam' },
  { key: 'simplechain', name: 'SimpleChain', url: null, note: 'check-in +60 poin' },
  { key: 'alphea', name: 'ALPHEA', url: null, note: 'check-in +600 poin' },
];

export function loadCheckins(filePath = 'checkins.json') {
  try {
    if (!existsSync(filePath)) return {};
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function saveCheckins(state, filePath = 'checkins.json') {
  writeFileSync(filePath, JSON.stringify(state), 'utf8');
}

export function isDone(state, date, key) {
  return !!state?.[date]?.[key];
}

// Tandai selesai. Kembalikan true kalau baru ditandai, false kalau
// key tidak dikenal atau sudah ditandai sebelumnya.
export function markDone(state, date, key) {
  if (!CHECKINS.some((c) => c.key === key)) return false;
  if (isDone(state, date, key)) return false;
  if (!state[date]) state[date] = {};
  state[date][key] = true;
  return true;
}

export function remainingItems(state, date) {
  return CHECKINS.filter((c) => !isDone(state, date, c.key));
}

// Parse callback_data tombol. Kembalikan key atau null.
export function parseCallback(data) {
  if (typeof data !== 'string') return null;
  const m = /^checkin:([a-z0-9]+)$/.exec(data);
  if (!m) return null;
  return CHECKINS.some((c) => c.key === m[1]) ? m[1] : null;
}

// Susun teks checklist: hanya yang BELUM check-in hari ini.
// dateStr default tanggal WIB hari ini.
export function checklistText(state, date, dateStr = todayWIB()) {
  const remaining = remainingItems(state, date);
  const done = CHECKINS.length - remaining.length;
  if (remaining.length === 0) {
    return [
      `✅ Check-in Harian — ${dateStr}`,
      '',
      `Semua check-in hari ini sudah selesai (${done}/${CHECKINS.length})! 🎉`,
      'Balik lagi besok.',
    ].join('\n');
  }
  const lines = [
    `📋 Check-in Harian — ${dateStr}`,
    `Sudah ${done}/${CHECKINS.length}, sisa ${remaining.length} yang belum:`,
    '',
  ];
  for (const item of remaining) {
    lines.push(`• ${item.name} — ${item.note}`);
    if (item.url) lines.push(`  ${item.url}`);
  }
  lines.push('', 'Tap tombol di bawah kalau sudah selesai check-in.');
  return lines.join('\n');
}

// Keyboard: satu tombol per testnet yang belum selesai.
// Selalu kembalikan reply_markup (inline_keyboard kosong kalau semua
// selesai, supaya keyboard lama terhapus dari pesan).
export function checklistKeyboard(remaining) {
  return {
    inline_keyboard: remaining.map((item) => [
      { text: `✅ ${item.name}`, callback_data: `checkin:${item.key}` },
    ]),
  };
}
