import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  trendLabel,
  formatBriefing,
  buildBriefing,
  INSTRUMENTS,
} from '../src/market.js';
import { addSubscriber, loadSubscribers } from '../src/subscribers.js';
import { handleMessage } from '../src/handlers/message.js';
import { MARKET_REQUEST } from '../src/commands/index.js';

// --- trendLabel ---

test('trendLabel: bullish kalau harga di atas MA20 dan naik', () => {
  // 20 closes datar 100, lalu naik ke 110, 112.
  const closes = [...Array(20).fill(100), 110, 112];
  assert.equal(trendLabel(closes), 'bullish');
});

test('trendLabel: bearish kalau harga di bawah MA20 dan turun', () => {
  const closes = [...Array(20).fill(100), 90, 88];
  assert.equal(trendLabel(closes), 'bearish');
});

test('trendLabel: sideways kalau di atas MA20 tapi turun', () => {
  const closes = [...Array(20).fill(100), 110, 108];
  assert.equal(trendLabel(closes), 'sideways');
});

test('trendLabel: sideways kalau di bawah MA20 tapi naik', () => {
  const closes = [...Array(20).fill(100), 90, 92];
  assert.equal(trendLabel(closes), 'sideways');
});

test('trendLabel: data kurang dari 2 closes -> sideways', () => {
  assert.equal(trendLabel([]), 'sideways');
  assert.equal(trendLabel([100]), 'sideways');
  assert.equal(trendLabel(null), 'sideways');
});

test('trendLabel: changeOverride dipakai untuk crypto (24h %)', () => {
  // Harga di atas MA20 tapi 24h % negatif -> sideways, bukan bullish.
  const closes = [...Array(20).fill(100), 110, 112];
  assert.equal(trendLabel(closes, -0.02), 'sideways');
  assert.equal(trendLabel(closes, 0.03), 'bullish');
  // Harga di bawah MA20 tapi 24h % positif -> sideways.
  const down = [...Array(20).fill(100), 90, 88];
  assert.equal(trendLabel(down, 0.02), 'sideways');
  assert.equal(trendLabel(down, -0.02), 'bearish');
});

// --- formatBriefing ---

const fakeRows = (label) => ({
  forex: [
    {
      inst: INSTRUMENTS.find((i) => i.key === 'gold'),
      data: { price: 3515.4, changePct: 0.5, label },
    },
    { inst: INSTRUMENTS.find((i) => i.key === 'eurusd'), data: null },
  ],
  crypto: [
    {
      inst: INSTRUMENTS.find((i) => i.key === 'btc'),
      data: { price: 60116, changePct: 2.3, label: 'bullish' },
    },
  ],
  stocks: [
    {
      inst: INSTRUMENTS.find((i) => i.key === 'bbca'),
      data: { price: 5550, changePct: -0.9, label: 'bearish' },
    },
  ],
  gainers: [{ symbol: 'DOGE', pct: 12.5 }],
  losers: [{ symbol: 'XRP', pct: -7.7 }],
  dateStr: 'Sabtu, 22 November 2026',
});

test('formatBriefing: ada semua section, label, disclaimer, tanggal', () => {
  const text = formatBriefing(fakeRows('bullish'));
  assert.ok(text.includes('📈 Market Live — Sabtu, 22 November 2026'));
  assert.ok(text.includes('💱 Forex:'));
  assert.ok(text.includes('🪙 Crypto:'));
  assert.ok(text.includes('📊 Saham:'));
  assert.ok(text.includes('XAUUSD (Emas) $3,515.40 (+0.5%) — 🟢 Bullish'));
  assert.ok(text.includes('EURUSD: data tidak tersedia'));
  assert.ok(text.includes('BTC $60,116 (+2.3%) — 🟢 Bullish'));
  assert.ok(text.includes('BBCA Rp5.550 (-0.9%) — 🔴 Bearish'));
  assert.ok(text.includes('🚀 Top Gainer'));
  assert.ok(text.includes('1. DOGE +12.5%'));
  assert.ok(text.includes('📉 Top Loser'));
  assert.ok(text.includes('1. XRP -7.7%'));
  assert.ok(text.includes('Bukan saran beli/jual, cuma bacaan tren.'));
});

test('formatBriefing: top mover kosong -> data tidak tersedia', () => {
  const rows = fakeRows('sideways');
  rows.gainers = [];
  rows.losers = [];
  const text = formatBriefing(rows);
  assert.ok(text.includes('Top Gainer (24j, top 100 market cap):\ndata tidak tersedia'));
});

// --- buildBriefing dengan fetch palsu (tanpa network) ---

function yahooChart(closes) {
  return {
    chart: {
      result: [
        { indicators: { quote: [{ close: closes }] } },
      ],
      error: null,
    },
  };
}

function stubFetch(url) {
  const u = String(url);
  if (u.includes('finance.yahoo.com')) {
    const symbol = decodeURIComponent(u.split('/chart/')[1].split('?')[0]);
    if (symbol === 'BBCA.JK') return Promise.resolve({ ok: false, json: async () => ({}) });
    const rising = [...Array(24).fill(100), 101, 102];
    const falling = [...Array(24).fill(100), 99, 98];
    const closes = symbol === 'EURUSD=X' ? falling : rising;
    return Promise.resolve({ ok: true, json: async () => yahooChart(closes) });
  }
  if (u.includes('simple/price?ids=tether')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ tether: { idr: 16654.3, idr_24h_change: 0.12 } }),
    });
  }
  if (u.includes('market_chart')) {
    const id = u.split('/coins/')[1].split('/')[0];
    const falling = id === 'ethereum';
    const prices = Array.from({ length: 31 }, (_, i) => [
      i,
      falling ? 50000 - i * 100 : 50000 + i * 100,
    ]);
    return Promise.resolve({ ok: true, json: async () => ({ prices }) });
  }
  if (u.includes('per_page=100')) {
    const coins = [
      { symbol: 'aaa', price_change_percentage_24h: 12.5 },
      { symbol: 'bbb', price_change_percentage_24h: 8.1 },
      { symbol: 'ccc', price_change_percentage_24h: 5.0 },
      { symbol: 'ddd', price_change_percentage_24h: 3.2 },
      { symbol: 'eee', price_change_percentage_24h: 1.0 },
      { symbol: 'fff', price_change_percentage_24h: -0.5 },
      { symbol: 'ggg', price_change_percentage_24h: -2.0 },
      { symbol: 'hhh', price_change_percentage_24h: -4.5 },
      { symbol: 'iii', price_change_percentage_24h: -7.7 },
      { symbol: 'jjj', price_change_percentage_24h: -15.3 },
    ];
    return Promise.resolve({ ok: true, json: async () => coins });
  }
  if (u.includes('coins/markets')) {
    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: 'bitcoin', current_price: 60116, price_change_percentage_24h: 2.3 },
        { id: 'ethereum', current_price: 3200, price_change_percentage_24h: -1.2 },
        { id: 'solana', current_price: 210.5, price_change_percentage_24h: 0.4 },
      ],
    });
  }
  return Promise.resolve({ ok: false, json: async () => ({}) });
}

test('buildBriefing dengan fetch palsu: semua section terisi, yang gagal -> data tidak tersedia', async () => {
  const text = await buildBriefing(stubFetch);
  assert.ok(text.includes('📈 Market Live —'));
  assert.ok(text.includes('XAUUSD (Emas) $102.00 (+1.0%) — 🟢 Bullish'));
  assert.ok(text.includes('EURUSD 98.0000 (-1.0%) — 🔴 Bearish'));
  assert.ok(text.includes('BBCA: data tidak tersedia'));
  assert.ok(text.includes('BTC $60,116 (+2.3%) — 🟢 Bullish'));
  assert.ok(text.includes('ETH $3,200 (-1.2%) — 🔴 Bearish'));
  assert.ok(text.includes('SOL $210.50 (+0.4%) — 🟢 Bullish'));
  assert.ok(text.includes('USDT/IDR Rp16.654 (+0.1%)'));
  assert.ok(text.includes('1. AAA +12.5%'));
  assert.ok(text.includes('5. EEE +1.0%'));
  assert.ok(text.includes('1. JJJ -15.3%'));
  assert.ok(text.includes('5. FFF -0.5%'));
  assert.ok(text.includes('Bukan saran beli/jual, cuma bacaan tren.'));
});

test('buildBriefing kalau semua API gagal: tetap balas, tanpa ngarang harga', async () => {
  const failingFetch = () => Promise.resolve({ ok: false, json: async () => ({}) });
  const text = await buildBriefing(failingFetch);
  assert.ok(text.includes('XAUUSD (Emas): data tidak tersedia'));
  assert.ok(text.includes('BTC: data tidak tersedia'));
  assert.ok(text.includes('USDT/IDR: data tidak tersedia'));
  assert.ok(text.includes('IHSG: data tidak tersedia'));
  assert.ok(text.includes('Top Gainer (24j, top 100 market cap):\ndata tidak tersedia'));
  assert.ok(!text.includes('$60,116'));
});

// --- /market wiring ---

test('/market dikenali dan masuk menu', () => {
  assert.equal(handleMessage('/market'), MARKET_REQUEST);
  assert.equal(handleMessage('.market'), MARKET_REQUEST);
  assert.ok(handleMessage('/menu').includes('/market'));
});

// --- subscribers ---

test('subscribers: tambah baru sekali, duplikat diabaikan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tgbot-'));
  const file = join(dir, 'subscribers.json');
  try {
    assert.deepEqual(loadSubscribers(file), []);
    assert.equal(addSubscriber(123, file), true);
    assert.equal(addSubscriber(123, file), false);
    assert.equal(addSubscriber(456, file), true);
    assert.deepEqual(loadSubscribers(file), [123, 456]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
