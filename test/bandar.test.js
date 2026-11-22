import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreExchange,
  readingOf,
  combineCoin,
  formatBandar,
  buildBandar,
} from '../src/bandar.js';
import { handleMessage } from '../src/handlers/message.js';
import { BANDAR_REQUEST, MARKET_REQUEST } from '../src/commands/index.js';

// --- skor ---

test('scoreExchange: semua condong beli -> skor 3', () => {
  assert.equal(scoreExchange({ ls: 1.3, taker: 1.2, oi: 5 }), 3);
});

test('scoreExchange: semua condong jual -> skor -3', () => {
  assert.equal(scoreExchange({ ls: 0.7, taker: 0.8, oi: 6 }), -3);
});

test('scoreExchange: angka null dilewati, tidak dikarang', () => {
  assert.equal(scoreExchange({ ls: null, taker: null, oi: null }), 0);
  assert.equal(scoreExchange({ ls: 1.2, taker: null, oi: 10 }), 1);
});

test('readingOf: ambang akum/dist/netral', () => {
  assert.equal(readingOf(2), 'akum');
  assert.equal(readingOf(0), 'netral');
  assert.equal(readingOf(-1), 'dist');
});

test('combineCoin: 2 bursa setuju akumulasi, bursa tanpa data tidak dihitung', () => {
  const c = combineCoin('ABC', [
    { ex: 'OKX', m: { ls: 1.3, taker: 1.2, oi: 5 } },
    { ex: 'Gate', m: { ls: 1.2, taker: 1.1, oi: 4 } },
    { ex: 'Bitget', m: { ls: null, taker: null, oi: null } },
    { ex: 'Binance', m: null },
  ]);
  assert.equal(c.reading, 'akum');
  assert.deepEqual(c.agree, ['OKX', 'Gate']);
  assert.equal(c.total, 2);
});

test('combineCoin: sinyal campur -> netral', () => {
  const c = combineCoin('XYZ', [
    { ex: 'OKX', m: { ls: 1.3, taker: 1.2, oi: 5 } },
    { ex: 'Gate', m: { ls: 0.7, taker: 0.8, oi: 5 } },
  ]);
  assert.equal(c.reading, 'netral');
});

// --- format ---

test('formatBandar: daftar akumulasi, bursa gagal, majors, footer', () => {
  const coins = [
    combineCoin('ABC', [
      { ex: 'OKX', m: { ls: 1.3, taker: 1.2, oi: 5 } },
      { ex: 'Gate', m: { ls: 1.2, taker: 1.1, oi: 4 } },
    ]),
    combineCoin('BTC', [{ ex: 'OKX', m: { ls: 1.0, taker: 1.0, oi: 0 } }]),
  ];
  const text = formatBandar({
    coins,
    okEx: ['OKX', 'Gate'],
    failEx: ['Binance'],
    scanned: 2,
    dateStr: 'Minggu, 22 November 2026, jam 17.30 WIB',
  });
  assert.ok(text.includes('🐋 Akumulasi Bandar — Minggu, 22 November 2026, jam 17.30 WIB'));
  assert.ok(text.includes('Tidak bisa diakses: Binance'));
  assert.ok(text.includes('1. ABC — 2/2 bursa (OKX+Gate)'));
  assert.ok(text.includes('L/S 1.25 · Taker 1.15 · OI +4.5%'));
  assert.ok(text.includes('BTC ⚪ Netral'));
  assert.ok(text.includes('ETH: data tidak tersedia'));
  assert.ok(text.includes('Bukan sinyal beli/jual, cuma data petunjuk.'));
  assert.ok(text.length < 4096);
});

// --- scan dengan fetch palsu ---

const ok = (body) => Promise.resolve({ ok: true, json: async () => body });
const fail = (status) => Promise.resolve({ ok: false, status, json: async () => ({}) });

function stubFetch(url) {
  const u = String(url);
  if (u.includes('binance.com') || u.includes('bybit.com')) return fail(451);
  if (u.includes('okx.com/api/v5/market/tickers')) {
    return ok({ data: [
      { instId: 'BTC-USDT-SWAP', volCcy24h: '100', last: '60000' },
      { instId: 'ABC-USDT-SWAP', volCcy24h: '1000', last: '10' },
      { instId: 'NVDA-USDT-SWAP', volCcy24h: '1000000', last: '100' },
    ] });
  }
  if (u.includes('okx.com/api/v5/public/instruments')) {
    return ok({ data: [
      { instId: 'BTC-USDT-SWAP', instCategory: '1' },
      { instId: 'ABC-USDT-SWAP', instCategory: '1' },
      { instId: 'NVDA-USDT-SWAP', instCategory: '3' },
    ] });
  }
  if (u.includes('top-trader')) return ok({ data: [['1', u.includes('ABC') ? '1.5' : '1.0']] });
  if (u.includes('taker-volume-contract')) {
    // [ts, sellVol, buyVol]
    return ok({ data: u.includes('ABC') ? [['1', '100', '150']] : [['1', '100', '100']] });
  }
  if (u.includes('open-interest-history')) {
    // urut baru -> lama, oiCcy di index 2
    return ok({ data: u.includes('ABC') ? [['2', '0', '110'], ['1', '0', '100']] : [['2', '0', '100'], ['1', '0', '100']] });
  }
  if (u.includes('bitget.com')) return ok({ code: '40054', data: null });
  if (u.includes('gateio.ws/api/v4/futures/usdt/tickers')) {
    return ok([{ contract: 'ABC_USDT', volume_24h_quote: '5000' }]);
  }
  if (u.includes('contract_stats') && u.includes('ABC_USDT')) {
    return ok([
      { open_interest: 100, lsr_taker: 1.2, top_lsr_size: 1.3 },
      { open_interest: 108, lsr_taker: 1.3, top_lsr_size: 1.4 },
    ]);
  }
  return fail(404);
}

test('buildBandar dengan fetch palsu: bursa diblok dilewati, saham dibuang, ABC akumulasi', async () => {
  const text = await buildBandar(stubFetch, { noCache: true, scale: 0 });
  assert.ok(text.includes('Bursa: OKX, Gate'));
  assert.ok(text.includes('Tidak bisa diakses: Binance, Bybit, Bitget'));
  assert.ok(!text.includes('NVDA'));
  assert.ok(text.includes('1. ABC — 2/2 bursa (OKX+Gate)'));
  assert.ok(text.includes('BTC ⚪ Netral'));
  assert.ok(text.includes('SOL: data tidak tersedia'));
});

test('buildBandar: semua bursa gagal -> data tidak tersedia, tanpa angka karangan', async () => {
  const text = await buildBandar(() => fail(451), { noCache: true, scale: 0 });
  assert.ok(text.includes('Data tidak tersedia, semua bursa gagal diakses.'));
  assert.ok(!text.includes('L/S 1'));
});

// --- wiring ---

test('/bandar dikenali dan masuk menu, /market judulnya Market Live', () => {
  assert.equal(handleMessage('/bandar'), BANDAR_REQUEST);
  assert.equal(handleMessage('/market'), MARKET_REQUEST);
  const menu = handleMessage('/menu');
  assert.ok(menu.includes('/bandar — Akumulasi bandar crypto'));
  assert.ok(menu.includes('/market — Market Live'));
});
