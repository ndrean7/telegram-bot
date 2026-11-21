// Daftar chat yang menerima briefing market harian.
// File ini TIDAK di-commit (masuk .gitignore) — chat id itu data pribadi.
// Catatan: file ini hilang kalau Railway redeploy dari nol; user cukup
// kirim pesan apa saja ke bot untuk daftar lagi.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function loadSubscribers(filePath = 'subscribers.json') {
  try {
    if (!existsSync(filePath)) return [];
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data.filter((id) => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
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
  return true;
}
