// Daily Market: forex, crypto, saham (on-demand via /market).
// Data: Yahoo Finance (forex + saham) dan CoinGecko (crypto), gratis tanpa key.
// Tidak pernah mengarang harga: instrumen yang gagal diambil datanya
// ditampilkan sebagai "data tidak tersedia".
import { todayWIB } from './utils/time.js';

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

// Yahoo tidak lagi menyediakan XAUUSD=X (delisted) — emas pakai GC=F
// (kontrak berjangka emas COMEX, USD per troy ounce).
export const INSTRUMENTS = [
  { key: 'gold', name: 'XAUUSD (Emas)', symbol: 'GC=F', kind: 'yahoo', section: 'forex', fmt: 'usd2' },
  { key: 'eurusd', name: 'EURUSD', symbol: 'EURUSD=X', kind: 'yahoo', section: 'forex', fmt: 'fx4' },
  { key: 'gbpusd', name: 'GBPUSD', symbol: 'GBPUSD=X', kind: 'yahoo', section: 'forex', fmt: 'fx4' },
  { key: 'usdjpy', name: 'USDJPY', symbol: 'USDJPY=X', kind: 'yahoo', section: 'forex', fmt: 'fx2' },
  { key: 'btc', name: 'BTC', symbol: 'bitcoin', kind: 'crypto', section: 'crypto', fmt: 'usd0' },
  { key: 'eth', name: 'ETH', symbol: 'ethereum', kind: 'crypto', section: 'crypto', fmt: 'usd0' },
  { key: 'sol', name: 'SOL', symbol: 'solana', kind: 'crypto', section: 'crypto', fmt: 'usd2' },
  { key: 'ihsg', name: 'IHSG', symbol: '^JKSE', kind: 'yahoo', section: 'stocks', fmt: 'idx' },
  { key: 'bbca', name: 'BBCA', symbol: 'BBCA.JK', kind: 'yahoo', section: 'stocks', fmt: 'idr' },
  { key: 'bbri', name: 'BBRI', symbol: 'BBRI.JK', kind: 'yahoo', section: 'stocks', fmt: 'idr' },
  { key: 'tlkm', name: 'TLKM', symbol: 'TLKM.JK', kind: 'yahoo', section: 'stocks', fmt: 'idr' },
];

// Label tren dari harga penutupan harian (urut lama -> baru).
// Bullish kalau harga terakhir di atas MA20 dan berubah naik;
// bearish kalau di bawah MA20 dan berubah turun; sisanya sideways.
// changeOverride (desimal, mis. 0.02 = +2%) dipakai crypto dari angka 24j
// CoinGecko; kalau tidak diisi, perubahan dihitung dari 2 closes terakhir.
export function trendLabel(closes, changeOverride) {
  if (!Array.isArray(closes) || closes.length < 2) return 'sideways';
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const window = closes.slice(-20);
  const ma20 = window.reduce((a, b) => a + b, 0) / window.length;
  const change =
    typeof changeOverride === 'number' ? changeOverride : (last - prev) / prev;
  if (last > ma20 && change > 0) return 'bullish';
  if (last < ma20 && change < 0) return 'bearish';
  return 'sideways';
}

export const LABEL_TEXT = {
  bullish: '🟢 Bullish',
  bearish: '🔴 Bearish',
  sideways: '⚪ Sideways',
};

function fmtPrice(value, fmt) {
  switch (fmt) {
    case 'usd2':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'usd0':
      return `$${Math.round(value).toLocaleString('en-US')}`;
    case 'fx4':
      return value.toFixed(4);
    case 'fx2':
      return value.toFixed(2);
    case 'idx':
      return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    case 'idr':
      return `Rp${Math.round(value).toLocaleString('id-ID')}`;
    default:
      return String(value);
  }
}

function fmtPct(pct) {
  const rounded = Number(pct.toFixed(1));
  if (rounded === 0) return '0.0%';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

// Ambil closes harian Yahoo. Coba query1, ulangi sekali, lalu query2 sekali.
// Kembalikan array closes atau null kalau semua gagal.
async function fetchYahooCloses(symbol, fetchFn) {
  const hosts = [
    'query1.finance.yahoo.com',
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
  ];
  for (const host of hosts) {
    try {
      const res = await fetchFn(
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`,
        { headers: UA },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(
        (v) => typeof v === 'number',
      );
      if (closes && closes.length >= 2) return closes;
    } catch {
      // coba host berikutnya
    }
  }
  return null;
}

async function fetchCryptoMarkets(fetchFn) {
  try {
    const res = await fetchFn(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,solana&price_change_percentage=24h',
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return new Map(data.map((c) => [c.id, c]));
  } catch {
    return null;
  }
}

async function fetchCryptoChart(id, fetchFn) {
  try {
    const res = await fetchFn(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const closes = (data?.prices || [])
      .map((p) => p[1])
      .filter((v) => typeof v === 'number');
    return closes.length >= 2 ? closes : null;
  } catch {
    return null;
  }
}

async function fetchTop100(fetchFn) {
  try {
    const res = await fetchFn(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h',
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function topMovers(coins) {
  if (!coins) return { gainers: [], losers: [] };
  const valid = coins.filter(
    (c) => typeof c.price_change_percentage_24h === 'number' && c.symbol,
  );
  const sorted = [...valid].sort(
    (a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h,
  );
  const toRow = (c) => ({
    symbol: c.symbol.toUpperCase(),
    pct: c.price_change_percentage_24h,
  });
  return {
    gainers: sorted.slice(0, 5).map(toRow),
    losers: sorted.slice(-5).reverse().map(toRow),
  };
}

function instrumentLine({ inst, data }) {
  if (!data) return `${inst.name}: data tidak tersedia`;
  return `${inst.name} ${fmtPrice(data.price, inst.fmt)} (${fmtPct(data.changePct)}) — ${LABEL_TEXT[data.label]}`;
}

// Susun teks briefing dari baris yang sudah dihitung (murni, gampang dites).
export function formatBriefing({ forex, crypto, stocks, gainers, losers, dateStr }) {
  const moverLines = (list) =>
    list.length
      ? list.map((m, i) => `${i + 1}. ${m.symbol} ${fmtPct(m.pct)}`)
      : ['data tidak tersedia'];
  return [
    `📈 Daily Market — ${dateStr}`,
    '',
    '💱 Forex:',
    ...forex.map(instrumentLine),
    '',
    '🪙 Crypto:',
    ...crypto.map(instrumentLine),
    '',
    '📊 Saham:',
    ...stocks.map(instrumentLine),
    '',
    '🚀 Top Gainer (24j, top 100 market cap):',
    ...moverLines(gainers),
    '',
    '📉 Top Loser (24j, top 100 market cap):',
    ...moverLines(losers),
    '',
    'Harga emas dari futures COMEX (GC=F).',
    'Bukan saran beli/jual, cuma bacaan tren.',
  ].join('\n');
}

// Ambil semua data lalu susun briefing lengkap.
export async function buildBriefing(fetchFn = fetch) {
  const yahooJobs = INSTRUMENTS.filter((i) => i.kind === 'yahoo').map(
    async (inst) => {
      const closes = await fetchYahooCloses(inst.symbol, fetchFn);
      if (!closes) return { inst, data: null };
      const last = closes.at(-1);
      const prev = closes.at(-2);
      return {
        inst,
        data: {
          price: last,
          changePct: ((last - prev) / prev) * 100,
          label: trendLabel(closes),
        },
      };
    },
  );

  const cryptoMarketsP = fetchCryptoMarkets(fetchFn);
  const top100P = fetchTop100(fetchFn);

  const cryptoMarkets = await cryptoMarketsP;
  const cryptoJobs = INSTRUMENTS.filter((i) => i.kind === 'crypto').map(
    async (inst) => {
      const coin = cryptoMarkets?.get(inst.symbol);
      if (!coin || typeof coin.current_price !== 'number') {
        return { inst, data: null };
      }
      const closes = await fetchCryptoChart(inst.symbol, fetchFn);
      const changeDecimal =
        typeof coin.price_change_percentage_24h === 'number'
          ? coin.price_change_percentage_24h / 100
          : undefined;
      const label = closes
        ? trendLabel(closes, changeDecimal)
        : changeDecimal > 0
          ? 'bullish'
          : changeDecimal < 0
            ? 'bearish'
            : 'sideways';
      return {
        inst,
        data: {
          price: coin.current_price,
          changePct: coin.price_change_percentage_24h ?? 0,
          label,
        },
      };
    },
  );

  const [yahooRows, cryptoRows, top100] = await Promise.all([
    Promise.all(yahooJobs),
    Promise.all(cryptoJobs),
    top100P,
  ]);
  const rows = [...yahooRows, ...cryptoRows];
  const bySection = (section) =>
    INSTRUMENTS.filter((i) => i.section === section).map(
      (inst) => rows.find((r) => r.inst.key === inst.key),
    );
  const { gainers, losers } = topMovers(top100);

  return formatBriefing({
    forex: bySection('forex'),
    crypto: bySection('crypto'),
    stocks: bySection('stocks'),
    gainers,
    losers,
    dateStr: todayWIB(),
  });
}
