import { readFileSync, existsSync } from 'node:fs';

// Muat .env secara manual (tanpa dependensi) supaya `npm start` di lokal
// bisa jalan dengan file .env. Di Railway, variabel diisi dari dashboard
// dan file .env tidak ada — itu normal.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

export const config = {
  botName: process.env.BOT_NAME || 'Bot Telegram',
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  port: Number(process.env.PORT || 3000),
  // Long polling: berapa lama getUpdates menunggu (detik).
  pollTimeoutSeconds: Number(process.env.POLL_TIMEOUT || 30),
};
