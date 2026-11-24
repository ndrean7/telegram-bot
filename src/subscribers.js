// Daftar chat yang menerima briefing market harian.
// File ini TIDAK di-commit (masuk .gitignore) — chat id itu data pribadi.
// Catatan: file ini hilang kalau host redeploy dari nol; chat id di env
// SUBSCRIBERS selalu ikut, sisanya cukup kirim pesan apa saja ke bot.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Chat id tetap dari env SUBSCRIBERS (dipisah koma) — tidak hilang saat redeploy.
export function envSubscribers(raw = process.env.SUBSCRIBERS) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((id) => Number.isInteger(id) && id !== 0);
}

export function loadSubscribers(filePath = 'subscribers.json') {
  let fromFile = [];
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      if (Array.isArray(data)) fromFile = data.filter((id) => Number.isInteger(id));
    }
  } catch {
    fromFile = [];
  }
  return [...new Set([...envSubscribers(), ...fromFile])];
}

export function saveSubscribers(ids, filePath = 'subscribers.json') {
  writeFileSync(filePath, JSON.stringify([...new Set(ids)]), 'utf8');
}

// Kembalikan true kalau chat id ini baru didaftarkan.
export function addSubscriber(chatId, filePath = 'subscribers.json') {
  const ids = loadSubscribers(filePath);
  if (ids.includes(chatId)) return false;
  ids.push(chatId);
  saveSubscribers(ids, filePath);
  // Dicatat di log host (tidak di GitHub) biar bisa dipasang permanen di env SUBSCRIBERS.
  if (filePath === 'subscribers.json') console.log(`Subscriber baru: ${chatId} (tambahkan ke env SUBSCRIBERS biar permanen)`);
  return true;
}
