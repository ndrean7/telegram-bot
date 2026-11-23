import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCmc, matchCmc, splitMultiplier, fUsd, fPct, fetchCmc, CMC_URL } from '../src/cmc.js';
import { buildBandar, combineCoin, formatBandar } from '../src/bandar.js';

const q = (price, mcap, vol, ch) => [{ name: 'USD', price, marketCap: mcap, volume24h: vol, percentChange24h: ch }];
const SAMPLE = {
  data: {
    cryptoCurrencyList: [
      { symbol: 'BTC', name: 'Bitcoin', cmcRank: 1, quotes: q(61682.64, 1240812623267.756, 27148836860.07, 4.9925) },
      { symbol: 'PEPE', name: 'Pepe', cmcRank: 40, quotes: q(0.0000081, 3.4e9, 6.1e8, -2.345) },
      // simbol sama, koin lain (rank lebih buruk, harga beda jauh)
      { symbol: 'ABC', name: 'Abc Real', cmcRank: 900, quotes: q(10.2, 5.5e6, 1.2e6, 12.34) },
      { symbol: 'ABC', name: 'Abc Fake Big', cmcRank: 300, quotes: q(0.5, 8e7, 9e6, 1) },
      { symbol: 'NOSUP', name: 'No Supply', cmcRank: 1500, quotes: q(1, 0, 5000, 0) },
    ],
  },
};

test('parseCmc: kandidat per simbol urut rank terbaik', () => {
  const m = parseCmc(SAMPLE);
  assert.equal(m.get('ABC').length, 2);
  assert.equal(m.get('ABC')[0].rank, 300);
  assert.equal(m.get('BTC')[0].mcap, 1240812623267.756);
  assert.equal(m.get('NOSUP')[0].mcap, null); // 0 dari CMC -> null, bukan angka
  assert.equal(parseCmc({}), null);
  assert.equal(parseCmc({ data: { cryptoCurrencyList: [] } }), null);
});

test('splitMultiplier: 1000PEPE -> PEPE x1000, 1INCH tidak diubah', () => {
  assert.deepEqual(splitMultiplier('1000PEPE'), { sym: 'PEPE', mult: 1000 });
  assert.deepEqual(splitMultiplier('1MBABYDOGE'), { sym: 'BABYDOGE', mult: 1e6 });
  assert.deepEqual(splitMultiplier('1INCH'), { sym: '1INCH', mult: 1 });
  assert.deepEqual(splitMultiplier('BTC'), { sym: 'BTC', mult: 1 });
});

test('matchCmc: harga bursa dipakai buat pilih koin yang benar saat simbol kembar', () => {
  const m = parseCmc(SAMPLE);
  assert.equal(matchCmc(m, 'ABC', 10).name, 'Abc Real'); // bukan yang rank lebih bagus
  assert.equal(matchCmc(m, 'ABC', 100), null); // tidak ada yang cocok -> kosong, bukan nebak
  assert.equal(matchCmc(m, 'ABC', null).name, 'Abc Fake Big'); // tanpa harga -> rank terbaik
  assert.equal(matchCmc(m, '1000PEPE', 0.0081).name, 'Pepe');
  assert.equal(matchCmc(m, 'BTC', 61700).rank, 1);
  assert.equal(matchCmc(m, 'ZZZ', 1), null);
  assert.equal(matchCmc(null, 'BTC', 1), null);
});

test('fUsd / fPct: format ringkas, null/0 -> "-"', () => {
  assert.equal(fUsd(1240812623267.756), '$1.24T');
  assert.equal(fUsd(27148836860.07), '$27.1B');
  assert.equal(fUsd(345e9), '$345B');
  assert.equal(fUsd(5.5e6), '$5.50M');
  assert.equal(fUsd(850e3), '$850K');
  assert.equal(fUsd(0), '-');
  assert.equal(fUsd(null), '-');
  assert.equal(fPct(4.9925), '+5.0%');
  assert.equal(fPct(-2.345), '-2.3%');
  assert.equal(fPct(123.4), '+123%');
  assert.equal(fPct(null), '-');
});

test('fetchCmc: gagal / bukan JSON -> null', async () => {
  assert.equal(await fetchCmc(() => Promise.resolve({ ok: false, status: 403 }), { noCache: true }), null);
  assert.equal(await fetchCmc(() => Promise.reject(new Error('net')), { noCache: true }), null);
  assert.equal(await fetchCmc(() => Promise.resolve({ ok: true, json: async () => { throw new Error('x'); } }), { noCache: true }), null);
});

// --- integrasi ke /akumulasi ---

const ok = (body) => Promise.resolve({ ok: true, json: async () => body });
const fail = (status) => Promise.resolve({ ok: false, status, json: async () => ({}) });

function stub(withCmc) {
  return (url) => {
    const u = String(url);
    if (u === CMC_URL) return withCmc ? ok(SAMPLE) : fail(403);
    if (u.includes('binance.com') || u.includes('bybit.com') || u.includes('bitget.com')) return fail(451);
    if (u.includes('okx.com/api/v5/market/tickers')) {
      return ok({ data: [
        { instId: 'BTC-USDT-SWAP', volCcy24h: '100', last: '61700' },
        { instId: 'ABC-USDT-SWAP', volCcy24h: '1000', last: '10' },
      ] });
    }
    if (u.includes('okx.com/api/v5/public/instruments')) {
      return ok({ data: [
        { instId: 'BTC-USDT-SWAP', instCategory: '1' },
        { instId: 'ABC-USDT-SWAP', instCategory: '1' },
      ] });
    }
    if (u.includes('top-trader')) return ok({ data: [['1', u.includes('ABC') ? '1.5' : '1.0']] });
    if (u.includes('taker-volume-contract')) return ok({ data: u.includes('ABC') ? [['1', '100', '150']] : [['1', '100', '100']] });
    if (u.includes('open-interest-history')) return ok({ data: u.includes('ABC') ? [['2', '0', '110'], ['1', '0', '100']] : [['2', '0', '100'], ['1', '0', '100']] });
    if (u.includes('gateio.ws/api/v4/futures/usdt/tickers')) return ok([{ contract: 'ABC_USDT', volume_24h_quote: '5000', last: '10.1' }]);
    if (u.includes('contract_stats') && u.includes('ABC_USDT')) {
      return ok([
        { open_interest: 100, top_lsr_size: 1.3, long_taker_size: 120, short_taker_size: 100 },
        { open_interest: 108, top_lsr_size: 1.4, long_taker_size: 130, short_taker_size: 100 },
      ]);
    }
    return fail(404);
  };
}

test('buildBandar + CMC OK: tabel CMC muncul dengan angka yang cocok', async () => {
  const text = await buildBandar(stub(true), { noCache: true, scale: 0 });
  assert.ok(text.includes('Data CMC: OK'));
  assert.ok(text.includes('📊 <i>CoinMarketCap</i>'));
  assert.ok(text.includes('Koin Rank   MCap    Vol    24j'));
  // ABC harga bursa 10 -> Abc Real (rank 900), bukan Abc Fake Big
  assert.ok(text.includes('ABC   900 $5.50M $1.20M +12.3%'), text);
  assert.ok(!text.includes('$80.0M'));
});

test('buildBandar + CMC gagal: laporan tetap terkirim tanpa kolom CMC', async () => {
  const text = await buildBandar(stub(false), { noCache: true, scale: 0 });
  assert.ok(text.includes('Data CMC: tidak bisa diakses'));
  assert.ok(!text.includes('CoinMarketCap'));
  assert.ok(!text.includes('MCap'));
  assert.ok(text.includes(' 1 ABC'));
});

test('formatBandar + CMC: 15+15 koin tetap < 4096 karakter, lebar baris tabel <= 34', () => {
  const many = [];
  const exs = ['OKX', 'Gate', 'Bitget', 'Binance', 'Bybit'];
  for (let i = 0; i < 20; i++) {
    const a = combineCoin(`AKUM${i}`, exs.map((ex) => ({ ex, m: { ls: 1.3, taker: 1.2, oi: 12.3 } })));
    const d = combineCoin(`DIST${i}`, exs.map((ex) => ({ ex, m: { ls: 0.7, taker: 0.8, oi: -12.3 } })));
    a.cmc = { rank: 1234, mcap: 12.3e9, vol: 456e6, ch24: -12.34 };
    d.cmc = i % 2 ? null : { rank: 99, mcap: 1.24e12, vol: 27.1e9, ch24: 123.4 };
    many.push(a, d);
  }
  const text = formatBandar({ coins: many, okEx: exs, failEx: [], scanned: 100, cmcOk: true, dateStr: 'Senin, 23 November 2026, jam 12.50 WIB' });
  assert.ok(text.length < 4096, `len ${text.length}`);
  const pre = [...text.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].flatMap((m) => m[1].split('\n'));
  for (const line of pre) assert.ok(line.length <= 34, `${line.length}: ${line}`);
  assert.ok(text.includes('DIST1     -      -      -      -'));
});
