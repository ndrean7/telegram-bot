import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKINS,
  loadCheckins,
  saveCheckins,
  isDone,
  markDone,
  remainingItems,
  parseCallback,
  checklistText,
  checklistKeyboard,
} from '../src/checkins.js';
import { handleMessage } from '../src/handlers/message.js';
import { INFO_REQUEST } from '../src/commands/index.js';

// --- daftar checklist ---

test('CHECKINS: 10 item, key unik, URL https atau null (tidak ada yang dikarang)', () => {
  assert.equal(CHECKINS.length, 10);
  const keys = CHECKINS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of CHECKINS) {
    assert.ok(c.name && c.note);
    assert.ok(c.url === null || c.url.startsWith('https://'));
  }
  // URL yang terkonfirmasi di memory.
  const byKey = Object.fromEntries(CHECKINS.map((c) => [c.key, c]));
  assert.equal(byKey.asentum.url, 'https://airdrop.asentum.com/');
  assert.equal(byKey.amadeus.url, 'https://amahub.ama.one/quests/');
  assert.equal(byKey.ammora.url, 'https://ammora.org/waitlist');
  assert.equal(byKey.kalos.url, 'https://kalos.fun');
  assert.equal(byKey.dfusion.url, 'https://testnet.dfusion.ai');
  assert.equal(byKey.swarmbase.url, 'https://point.swarmbase.io');
  // URL belum terkonfirmasi — tampil tanpa link, bukan karangan.
  assert.equal(byKey.agnt.url, null);
  assert.equal(byKey.pushchain.url, null);
  assert.equal(byKey.simplechain.url, null);
  assert.equal(byKey.alphea.url, null);
});

// --- state per tanggal ---

test('markDone: tandai sekali, duplikat ditolak, key asing ditolak', () => {
  const state = {};
  assert.equal(markDone(state, '2026-11-22', 'asentum'), true);
  assert.equal(isDone(state, '2026-11-22', 'asentum'), true);
  assert.equal(markDone(state, '2026-11-22', 'asentum'), false);
  assert.equal(markDone(state, '2026-11-22', 'ngawur'), false);
  assert.equal(isDone(state, '2026-11-22', 'kalos'), false);
});

test('state dikunci per tanggal WIB: hari baru mulai kosong', () => {
  const state = {};
  markDone(state, '2026-11-22', 'asentum');
  markDone(state, '2026-11-22', 'kalos');
  assert.equal(isDone(state, '2026-11-23', 'asentum'), false);
  assert.equal(isDone(state, '2026-11-23', 'kalos'), false);
  assert.equal(remainingItems(state, '2026-11-23').length, 10);
});

test('remainingItems: yang sudah ditandai tidak muncul lagi', () => {
  const state = {};
  markDone(state, '2026-11-22', 'asentum');
  markDone(state, '2026-11-22', 'ammora');
  const remaining = remainingItems(state, '2026-11-22');
  assert.equal(remaining.length, 8);
  assert.ok(!remaining.some((c) => c.key === 'asentum'));
  assert.ok(!remaining.some((c) => c.key === 'ammora'));
  assert.ok(remaining.some((c) => c.key === 'kalos'));
});

test('load/save checkins: round-trip, file rusak -> kosong', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgbot-'));
  const file = join(dir, 'checkins.json');
  try {
    assert.deepEqual(loadCheckins(file), {});
    const state = {};
    markDone(state, '2026-11-22', 'asentum');
    saveCheckins(state, file);
    assert.deepEqual(loadCheckins(file), { '2026-11-22': { asentum: true } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- teks + keyboard ---

test('checklistText: hanya yang belum, ada link, ada hitungan', () => {
  const state = {};
  markDone(state, '2026-11-22', 'asentum');
  const text = checklistText(state, '2026-11-22', 'Minggu, 22 November 2026');
  assert.ok(text.includes('📋 Check-in Harian — Minggu, 22 November 2026'));
  assert.ok(text.includes('Sudah 1/10, sisa 9 yang belum:'));
  assert.ok(!text.includes('Asentum'));
  assert.ok(text.includes('Kalos'));
  assert.ok(text.includes('https://kalos.fun'));
  assert.ok(text.includes('AGNT Hub'));
  assert.ok(text.includes('Tap tombol di bawah'));
});

test('checklistText: semua selesai -> pesan selesai, tanpa daftar', () => {
  const state = {};
  for (const c of CHECKINS) markDone(state, '2026-11-22', c.key);
  const text = checklistText(state, '2026-11-22', 'Minggu, 22 November 2026');
  assert.ok(text.includes('Semua check-in hari ini sudah selesai (10/10)'));
  assert.ok(!text.includes('https://'));
});

test('checklistKeyboard: satu tombol per sisa, callback_data checkin:key', () => {
  const state = {};
  markDone(state, '2026-11-22', 'asentum');
  const kb = checklistKeyboard(remainingItems(state, '2026-11-22'));
  assert.equal(kb.inline_keyboard.length, 9);
  assert.deepEqual(kb.inline_keyboard[0], [
    { text: '✅ Amadeus (AMA Hub)', callback_data: 'checkin:amadeus' },
  ]);
  assert.ok(kb.inline_keyboard.every((row) => row[0].callback_data.startsWith('checkin:')));
});

test('checklistKeyboard: semua selesai -> keyboard kosong (hapus tombol)', () => {
  assert.deepEqual(checklistKeyboard([]), { inline_keyboard: [] });
});

test('parseCallback: hanya checkin:key yang dikenal', () => {
  assert.equal(parseCallback('checkin:asentum'), 'asentum');
  assert.equal(parseCallback('checkin:kalos'), 'kalos');
  assert.equal(parseCallback('checkin:ngawur'), null);
  assert.equal(parseCallback('market'), null);
  assert.equal(parseCallback(''), null);
  assert.equal(parseCallback(null), null);
});

// --- wiring /info ---

test('/info dikenali dan masuk menu sebagai checklist', () => {
  assert.equal(handleMessage('/info'), INFO_REQUEST);
  assert.equal(handleMessage('.info'), INFO_REQUEST);
  assert.ok(handleMessage('/menu').includes('/info — checklist check-in testnet harian'));
});
