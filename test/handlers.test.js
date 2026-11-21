import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessage, handleUpdate, FALLBACK } from '../src/handlers/message.js';
import { INFO_REQUEST } from '../src/commands/index.js';

test('salam dibalas sapaan + tawaran /menu', () => {
  const reply = handleMessage('halo');
  assert.ok(reply.includes('Halo!'));
  assert.ok(reply.includes('/menu'));
  assert.ok(handleMessage('selamat pagi').includes('Halo!'));
  assert.ok(handleMessage('malam').includes('Halo!'));
});

test('/menu menampilkan daftar perintah', () => {
  const reply = handleMessage('/menu');
  assert.ok(reply.includes('/info'));
  assert.ok(reply.includes('/jam'));
  assert.ok(reply.includes('/ping'));
  assert.equal(handleMessage('/help'), reply);
  assert.equal(handleMessage('/bantuan'), reply);
});

test('.menu gaya lama tetap jalan', () => {
  assert.ok(handleMessage('.menu').includes('/info'));
});

test('/info menampilkan checklist check-in harian', () => {
  assert.equal(handleMessage('/info'), INFO_REQUEST);
});

test('/jam menampilkan WIB', () => {
  assert.ok(handleMessage('/jam').includes('WIB'));
});

test('/ping menampilkan Pong + uptime', () => {
  const reply = handleMessage('/ping');
  assert.ok(reply.startsWith('Pong!'));
});

test('/start menampilkan sapaan', () => {
  assert.ok(handleMessage('/start').includes('/menu'));
});

test('perintah tidak dikenal -> fallback, bukan ngarang', () => {
  assert.equal(handleMessage('/ngawur'), FALLBACK);
  assert.equal(handleMessage('.ngawur'), FALLBACK);
});

test('pesan biasa yang bukan salam -> fallback', () => {
  assert.equal(handleMessage('berapa harga bitcoin?'), FALLBACK);
  assert.equal(handleMessage('ini itu'), FALLBACK);
});

test('pesan kosong / bukan teks -> tidak dibalas', () => {
  assert.equal(handleMessage(''), null);
  assert.equal(handleMessage('   '), null);
  assert.equal(handleMessage(null), null);
});

test('perintah grup /menu@namabot tetap dikenali', () => {
  assert.ok(handleMessage('/menu@botku').includes('/info'));
});

test('handleUpdate: abaikan pesan bot dan channel post', () => {
  assert.equal(handleUpdate({ message: { text: 'halo', chat: { id: 1 }, from: { is_bot: true } } }), null);
  assert.equal(handleUpdate({ channel_post: { text: 'halo', chat: { id: 1 } } }), null);
  assert.equal(handleUpdate({ message: { photo: [], chat: { id: 1 }, from: { is_bot: false } } }), null);
});

test('handleUpdate: pesan user biasa dibalas dengan chatId', () => {
  const reply = handleUpdate({ message: { text: '/ping', chat: { id: 123 }, from: { is_bot: false } } });
  assert.equal(reply.chatId, 123);
  assert.ok(reply.text.startsWith('Pong!'));
});
