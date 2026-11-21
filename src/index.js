import { createServer } from 'node:http';
import { config } from './config.js';
import { handleUpdate } from './handlers/message.js';

const API = `https://api.telegram.org/bot${config.token}`;

async function callTelegram(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error(`Telegram API ${method} gagal:`, data.description || res.status);
  }
  return data;
}

async function sendMessage(chatId, text) {
  await callTelegram('sendMessage', { chat_id: chatId, text });
}

// Long polling: ambil update baru, balas satu per satu.
// Tanpa webhook, jadi tidak butuh domain publik — cukup token.
async function pollOnce(offset) {
  const res = await fetch(
    `${API}/getUpdates?offset=${offset}&timeout=${config.pollTimeoutSeconds}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error('getUpdates gagal:', data.description || res.status);
    await new Promise((r) => setTimeout(r, 5000));
    return offset;
  }
  let nextOffset = offset;
  for (const update of data.result || []) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const reply = handleUpdate(update);
    if (reply) await sendMessage(reply.chatId, reply.text);
  }
  return nextOffset;
}

async function main() {
  if (!config.token) {
    console.error('TELEGRAM_BOT_TOKEN belum diisi. Isi di .env atau Variables Railway.');
    process.exit(1);
  }

  // Endpoint health untuk Railway / pengecekan luar.
  createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  }).listen(config.port, () => {
    console.log(`Health check: http://localhost:${config.port}/health`);
  });

  // Pastikan token benar sebelum polling.
  const me = await callTelegram('getMe', {});
  if (!me.ok) {
    console.error('Token tidak valid atau Telegram tidak bisa dihubungi.');
    process.exit(1);
  }
  console.log(`Bot jalan sebagai @${me.result.username}. Menunggu pesan...`);

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      offset = await pollOnce(offset);
    } catch (err) {
      console.error('Polling error:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main();
