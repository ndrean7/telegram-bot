import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreExchange,
  readingOf,
  combineCoin,
  formatBandar,
  rankAkum,
  rankDist,
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
  assert.ok(text.includes('🐋 <b>Akumulasi &amp; Distribusi Bandar</b>\nMinggu, 22 November 2026, jam 17.30 WIB'));
  assert.ok(text.includes('Tidak bisa diakses: Binance'));
  assert.ok(text.includes(' 1 ABC  OG    1.25 1.15  +4.5%'));
  assert.ok(text.includes('BTC  Netral     1.00 1.00  +0.0%'));
  assert.ok(text.includes('ETH  data tidak tersedia'));
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
  assert.ok(text.includes('Bursa aktif: OKX, Gate'));
  assert.ok(text.includes('Tidak bisa diakses: Binance, Bybit, Bitget'));
  assert.ok(!text.includes('NVDA'));
  assert.ok(text.includes(' 1 ABC'));
  assert.ok(text.includes('BTC  Netral'));
  assert.ok(text.includes('SOL  data tidak tersedia'));
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
  assert.ok(menu.includes('/bandar — Akumulasi & distribusi bandar crypto'));
  assert.ok(menu.includes('/market — Market Live'));
});

// --- distribusi ---

test('combineCoin: 2 bursa setuju distribusi -> dist, against berisi bursanya', () => {
  const c = combineCoin('DUMP', [
    { ex: 'OKX', m: { ls: 0.7, taker: 0.8, oi: 6 } },
    { ex: 'Gate', m: { ls: 0.8, taker: 0.9, oi: 4 } },
  ]);
  assert.equal(c.reading, 'dist');
  assert.deepEqual(c.against, ['OKX', 'Gate']);
});

test('formatBandar: section distribusi, urut paling negatif, tanpa angka karangan', () => {
  const coins = [
    combineCoin('ABC', [
      { ex: 'OKX', m: { ls: 1.3, taker: 1.2, oi: 5 } },
      { ex: 'Gate', m: { ls: 1.2, taker: 1.1, oi: 4 } },
    ]),
    combineCoin('MILD', [
      { ex: 'OKX', m: { ls: 0.85, taker: 0.94, oi: 0 } },
      { ex: 'Gate', m: { ls: 0.85, taker: 0.94, oi: 0 } },
    ]),
    combineCoin('DUMP', [
      { ex: 'OKX', m: { ls: 0.7, taker: 0.8, oi: 6 } },
      { ex: 'Gate', m: { ls: 0.8, taker: 0.9, oi: 4 } },
    ]),
    combineCoin('HALF', [{ ex: 'OKX', m: { ls: 0.7, taker: null, oi: null } }]),
  ];
  const text = formatBandar({
    coins, okEx: ['OKX', 'Gate'], failEx: [], scanned: 4,
    dateStr: 'Minggu, 22 November 2026, jam 17.30 WIB',
  });
  const dIdx = text.indexOf('🔴 <b>Condong distribusi</b>');
  assert.ok(dIdx > text.indexOf('🟢 <b>Condong akumulasi</b>'));
  const dist = text.slice(dIdx, text.indexOf('<b>Majors</b>'));
  assert.ok(dist.includes(' 1 DUMP OG    0.75 0.85  +5.0%'));
  assert.ok(dist.includes(' 2 MILD OG'));
  assert.ok(dist.includes('HALF O     0.70    -      -'));
  assert.ok(!dist.includes('ABC'));
});

test('formatBandar: tidak ada distribusi -> pesan kosong, panjang 20+20 koin tetap < 4096', () => {
  const none = formatBandar({
    coins: [combineCoin('ABC', [{ ex: 'OKX', m: { ls: 1.3, taker: 1.2, oi: 5 } }])],
    okEx: ['OKX'], failEx: [], scanned: 1, dateStr: 'x',
  });
  assert.ok(none.includes('Belum ada koin yang condong distribusi.'));
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push(combineCoin(`AKUMCOIN${i}`, ['OKX', 'Gate', 'Bitget', 'Binance', 'Bybit'].map((ex) => ({ ex, m: { ls: 1.3, taker: 1.2, oi: 12.3 } }))));
    many.push(combineCoin(`DISTCOIN${i}`, ['OKX', 'Gate', 'Bitget', 'Binance', 'Bybit'].map((ex) => ({ ex, m: { ls: 0.7, taker: 0.8, oi: 12.3 } }))));
  }
  const big = formatBandar({ coins: many, okEx: ['OKX', 'Gate', 'Bitget', 'Binance', 'Bybit'], failEx: [], scanned: 50, dateStr: 'Minggu, 22 November 2026, jam 17.30 WIB' });
  assert.ok(big.length < 4096, `len ${big.length}`);
  assert.ok(big.includes('Bukan sinyal beli/jual, cuma data petunjuk.'));
  assert.ok(/15 DISTCOIN/.test(big) && !/16 DISTCOIN/.test(big));
  assert.ok(/15 AKUMCOIN/.test(big) && !/16 AKUMCOIN/.test(big));
  assert.ok(big.includes('NYOBG'));
});

test('akumulasi & distribusi tidak pernah overlap', () => {
  const coins = [];
  const samples = [1.3, 0.7, 1.0, 1.2, 0.8];
  let k = 0;
  for (const ls of samples) for (const tk of samples) for (const oi of [-5, 0, 5]) {
    coins.push(combineCoin(`C${k++}`, [
      { ex: 'OKX', m: { ls, taker: tk, oi } },
      { ex: 'Gate', m: { ls: 2 - ls, taker: tk, oi: -oi } },
    ]));
  }
  const a = new Set(rankAkum(coins).map((c) => c.base));
  for (const c of rankDist(coins)) assert.ok(!a.has(c.base), c.base);
});

test('formatBandar: semua isi di-escape HTML, tag seimbang', () => {
  const text = formatBandar({
    coins: [combineCoin('ABC', [{ ex: 'OKX', m: { ls: 1.3, taker: 1.2, oi: 5 } }])],
    okEx: ['OKX'], failEx: ['A<B>'], scanned: 1, dateStr: 'x & y',
  });
  assert.ok(text.includes('A&lt;B&gt;') && text.includes('x &amp; y'));
  for (const t of ['pre', 'b', 'i']) {
    assert.equal((text.match(new RegExp(`<${t}>`, 'g')) || []).length, (text.match(new RegExp(`</${t}>`, 'g')) || []).length);
  }
});
