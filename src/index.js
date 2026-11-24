import { createServer } from 'node:http';
import { config } from './config.js';
import { askAI } from './ai.js';
import { handleUpdate, FALLBACK } from './handlers/message.js';
import { MARKET_REQUEST, INFO_REQUEST, BANDAR_REQUEST } from './commands/index.js';
import { buildBriefing } from './market.js';
import { buildBandar, bandarCached } from './bandar.js';
import {
  loadCheckins,
  saveCheckins,
  markDone,
  remainingItems,
  parseCallback,
  checklistText,
  checklistKeyboard,
} from './checkins.js';
import { nowWIBParts, todayWIB } from './utils/time.js';
import { buildKonversi } from './konversi.js';

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

async function sendMessage(chatId, text, replyMarkup, parseMode) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  if (parseMode) body.parse_mode = parseMode;
  return callTelegram('sendMessage', body);
}

// Tangani tap tombol checklist (/info): tandai selesai, lalu update
// pesan aslinya (teks + keyboard) supaya tinggal yang belum.
// Kembalikan true kalau update ini adalah callback query.
async function handleCallback(update) {
  const cb = update?.callback_query;
  if (!cb || cb.from?.is_bot) return false;
  // Tombol Delete di hasil /konversi: hapus pesan bot itu.
  if (cb.data === 'del') {
    await callTelegram('answerCallbackQuery', { callback_query_id: cb.id });
    if (cb.message) {
      await callTelegram('deleteMessage', { chat_id: cb.message.chat.id, message_id: cb.message.message_id });
    }
    return true;
  }
  const key = parseCallback(cb.data);
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (!key || typeof chatId !== 'number' || typeof messageId !== 'number') {
    await callTelegram('answerCallbackQuery', { callback_query_id: cb.id });
    return true;
  }
  const { date } = nowWIBParts();
  const state = loadCheckins();
  const newly = markDone(state, date, key);
  if (newly) saveCheckins(state);
  await callTelegram('answerCallbackQuery', {
    callback_query_id: cb.id,
    text: newly ? 'Ditandai selesai ✅' : 'Udah ditandai tadi',
  });
  if (!newly) return true;
  const remaining = remainingItems(state, date);
  await callTelegram('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: checklistText(state, date, todayWIB()),
    reply_markup: checklistKeyboard(remaining),
  });
  return true;
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
    // Tap tombol inline keyboard (checklist /info).
    if (await handleCallback(update)) continue;
    // /konversi <jumlah> <koin>: harga CEX/DEX live (async).
    const kText = update?.message?.text;
    const km = typeof kText === 'string' && !update.message.from?.is_bot
      ? kText.trim().match(/^\/(konversi|convert|kv|harga|price|p)(@\w+)?(\s+([\s\S]*))?$/i)
      : null;
    if (km) {
      const out = await buildKonversi(km[4] || '').catch(() => ({ text: 'Harga lagi nggak bisa diambil. Coba lagi bentar.' }));
      await sendMessage(update.message.chat.id, out.text, out.keyboard);
      continue;
    }
    const reply = handleUpdate(update);
    if (!reply) continue;
    // /market: ganti penanda dengan briefing live (async).
    if (reply.text === MARKET_REQUEST) {
      reply.text = await buildBriefing();
    }
    // /akumulasi, /distribusi (alias lama /bandar): scan lintas bursa (lama kalau belum ada cache).
    // Scan jalan di background supaya balasan perintah lain tidak ketahan.
    if (reply.text === BANDAR_REQUEST) {
      if (!bandarCached()) {
        await sendMessage(reply.chatId, '⏳ Lagi scan ~100 koin di beberapa bursa, tunggu ±1 menit...');
      }
      const chatId = reply.chatId;
      buildBandar()
        .catch((err) => {
          console.error('bandar gagal:', err?.message || err);
          return 'Data akumulasi/distribusi lagi nggak bisa diambil. Coba lagi bentar.';
        })
        .then(async (text) => {
          const r = await sendMessage(chatId, text, undefined, 'HTML');
          // Kalau Telegram nolak HTML, kirim ulang versi teks polos.
          if (!r?.ok) await sendMessage(chatId, text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
        })
        .catch((err) => console.error('kirim bandar gagal:', err?.message || err));
      continue;
    }
    // /info: kirim checklist check-in harian + tombol inline.
    if (reply.text === INFO_REQUEST) {
      const { date } = nowWIBParts();
      const state = loadCheckins();
      const remaining = remainingItems(state, date);
      await sendMessage(
        reply.chatId,
        checklistText(state, date, todayWIB()),
        checklistKeyboard(remaining),
      );
      continue;
    }
    // Pesan bebas (bukan perintah/salam) dan AI aktif: jawab pakai AI,
    // tapi kalau AI gagal / tidak ada key, tetap pakai fallback.
    if (reply.text === FALLBACK && update?.message?.text) {
      // Tampilkan "sedang mengetik..." selama AI mikir.
      const typing = () => callTelegram('sendChatAction', { chat_id: reply.chatId, action: 'typing' }).catch(() => {});
      typing();
      const tick = setInterval(typing, 4500);
      const aiReply = await askAI(update.message.text).finally(() => clearInterval(tick));
      if (aiReply) reply.text = aiReply;
    }
    await sendMessage(reply.chatId, reply.text);
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

  // Render free tier tidur kalau 15 menit tanpa request masuk.
  // Ping /health publik sendiri tiap 10 menit supaya polling tetap jalan.
  const publicUrl = process.env.RENDER_EXTERNAL_URL;
  if (publicUrl) {
    setInterval(() => {
      fetch(`${publicUrl}/health`).catch((err) => console.error('Keep-alive gagal:', err.message));
    }, 10 * 60 * 1000);
    console.log('Keep-alive aktif tiap 10 menit.');
  }

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
