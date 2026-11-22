// /bandar: scan akumulasi & distribusi "bandar" crypto lintas bursa besar.
// Data publik futures gratis tanpa key: Binance, Bybit, OKX, Bitget, Gate.
// Bursa yang gagal (mis. diblok wilayah 451/403) dilewati, tidak dikarang.
// Tiap koin dinilai per bursa dari 3 data:
//   1. Rasio long/short trader (L/S)
//   2. Rasio taker buy/sell 24 jam
//   3. Perubahan open interest (OI) 24 jam
// Bukan sinyal beli/jual, cuma data petunjuk.
import { todayWIB, nowWIB } from './utils/time.js';

export const SCAN_LIMIT = 100;
export const TOP_SHOW = 15;
const CACHE_MS = 5 * 60 * 1000;
const STABLES = new Set(['USDC', 'USDT', 'FDUSD', 'DAI', 'TUSD', 'USDE', 'USD1', 'PYUSD', 'BUSD']);

// ---------- util ----------

// Limiter sederhana: jarak minimal antar request (ms) per antrean.
export function makeLimiter(spacingMs) {
  let next = 0;
  return async function run(fn) {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + spacingMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  };
}

async function getJson(fetchFn, url) {
  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': 'ndrean7-bot/1.0' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pctChange = (oldV, newV) =>
  oldV && newV !== null && oldV > 0 ? ((newV - oldV) / oldV) * 100 : null;

// ---------- adapter per bursa ----------
// Tiap adapter: tickers() -> Map(BASE -> volume USD 24j) atau null kalau bursa gagal.
// metrics(base, lim) -> { ls, taker, oi } (null per angka yang tidak tersedia).

export function makeAdapters(fetchFn, scale = 1) {
  const L = (ms) => makeLimiter(ms * scale);

  const binLim = { ls: L(200), tk: L(200), oi: L(200) };
  const binance = {
    name: 'Binance',
    async tickers() {
      const d = await getJson(fetchFn, 'https://fapi.binance.com/fapi/v1/ticker/24hr');
      if (!Array.isArray(d)) return null;
      const m = new Map();
      for (const t of d) {
        if (!t.symbol?.endsWith('USDT')) continue;
        m.set(t.symbol.slice(0, -4), num(t.quoteVolume) || 0);
      }
      return m;
    },
    async metrics(base) {
      const s = `${base}USDT`;
      const B = 'https://fapi.binance.com/futures/data';
      const [ls, tk, oi] = await Promise.all([
        binLim.ls(() => getJson(fetchFn, `${B}/topLongShortPositionRatio?symbol=${s}&period=1h&limit=1`)),
        binLim.tk(() => getJson(fetchFn, `${B}/takerlongshortRatio?symbol=${s}&period=1h&limit=24`)),
        binLim.oi(() => getJson(fetchFn, `${B}/openInterestHist?symbol=${s}&period=1h&limit=25`)),
      ]);
      let taker = null;
      if (Array.isArray(tk) && tk.length) {
        const buy = tk.reduce((a, x) => a + (num(x.buyVol) || 0), 0);
        const sell = tk.reduce((a, x) => a + (num(x.sellVol) || 0), 0);
        taker = sell > 0 ? buy / sell : null;
      }
      return {
        ls: Array.isArray(ls) && ls.length ? num(ls.at(-1).longShortRatio) : null,
        taker,
        // openInterestHist urut lama -> baru
        oi: Array.isArray(oi) && oi.length > 1
          ? pctChange(num(oi[0].sumOpenInterest), num(oi.at(-1).sumOpenInterest))
          : null,
      };
    },
  };

  const byLim = { ls: L(200), oi: L(200) };
  const bybit = {
    name: 'Bybit',
    async tickers() {
      const d = await getJson(fetchFn, 'https://api.bybit.com/v5/market/tickers?category=linear');
      const list = d?.result?.list;
      if (!Array.isArray(list)) return null;
      const m = new Map();
      for (const t of list) {
        if (!t.symbol?.endsWith('USDT')) continue;
        m.set(t.symbol.slice(0, -4), num(t.turnover24h) || 0);
      }
      return m;
    },
    async metrics(base) {
      const s = `${base}USDT`;
      const B = 'https://api.bybit.com/v5/market';
      const [ls, oi] = await Promise.all([
        byLim.ls(() => getJson(fetchFn, `${B}/account-ratio?category=linear&symbol=${s}&period=1h&limit=1`)),
        byLim.oi(() => getJson(fetchFn, `${B}/open-interest?category=linear&symbol=${s}&intervalTime=1h&limit=25`)),
      ]);
      const r = ls?.result?.list?.[0];
      const o = oi?.result?.list; // urut baru -> lama
      return {
        ls: r && num(r.sellRatio) > 0 ? num(r.buyRatio) / num(r.sellRatio) : null,
        taker: null, // Bybit tidak punya endpoint taker publik
        oi: Array.isArray(o) && o.length > 1
          ? pctChange(num(o.at(-1).openInterest), num(o[0].openInterest))
          : null,
      };
    },
  };

  // OKX rubik: batas ~5 request/2 detik per endpoint -> jarak 450ms.
  const okLim = { ls: L(450), tk: L(450), oi: L(450) };
  let okxCrypto = null; // set BASE kategori crypto (bukan saham/komoditas)
  const okx = {
    name: 'OKX',
    async tickers() {
      const [d, inst] = await Promise.all([
        getJson(fetchFn, 'https://www.okx.com/api/v5/market/tickers?instType=SWAP'),
        getJson(fetchFn, 'https://www.okx.com/api/v5/public/instruments?instType=SWAP'),
      ]);
      if (!Array.isArray(d?.data)) return null;
      if (Array.isArray(inst?.data)) {
        okxCrypto = new Set(
          inst.data
            .filter((i) => i.instId?.endsWith('-USDT-SWAP') && String(i.instCategory) === '1')
            .map((i) => i.instId.split('-')[0]),
        );
      }
      const m = new Map();
      for (const t of d.data) {
        if (!t.instId?.endsWith('-USDT-SWAP')) continue;
        // volCcy24h = volume dalam koin -> kali harga = USD
        m.set(t.instId.split('-')[0], (num(t.volCcy24h) || 0) * (num(t.last) || 0));
      }
      return m;
    },
    cryptoSet: () => okxCrypto,
    async metrics(base) {
      const id = `${base}-USDT-SWAP`;
      const B = 'https://www.okx.com/api/v5/rubik/stat';
      const [ls, tk, oi] = await Promise.all([
        okLim.ls(() => getJson(fetchFn, `${B}/contracts/long-short-account-ratio-contract-top-trader?instId=${id}&period=1H&limit=1`)),
        okLim.tk(() => getJson(fetchFn, `${B}/taker-volume-contract?instId=${id}&period=1H&limit=24`)),
        okLim.oi(() => getJson(fetchFn, `${B}/contracts/open-interest-history?instId=${id}&period=1H&limit=25`)),
      ]);
      let taker = null;
      // urutan kolom: [ts, sellVol, buyVol]
      if (Array.isArray(tk?.data) && tk.data.length) {
        const sell = tk.data.reduce((a, x) => a + (num(x[1]) || 0), 0);
        const buy = tk.data.reduce((a, x) => a + (num(x[2]) || 0), 0);
        taker = sell > 0 ? buy / sell : null;
      }
      const o = oi?.data; // [ts, oi, oiCcy, oiUsd], urut baru -> lama
      return {
        ls: Array.isArray(ls?.data) && ls.data.length ? num(ls.data[0][1]) : null,
        taker,
        oi: Array.isArray(o) && o.length > 1 ? pctChange(num(o.at(-1)[2]), num(o[0][2])) : null,
      };
    },
  };

  const bgLim = { ls: L(120), tk: L(120) };
  const bitget = {
    name: 'Bitget',
    async tickers() {
      const d = await getJson(fetchFn, 'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES');
      if (!Array.isArray(d?.data)) return null;
      const m = new Map();
      for (const t of d.data) {
        if (!t.symbol?.endsWith('USDT')) continue;
        m.set(t.symbol.slice(0, -4), num(t.usdtVolume) || 0);
      }
      return m;
    },
    async metrics(base) {
      const s = `${base}USDT`;
      const B = 'https://api.bitget.com/api/v2/mix/market';
      const [ls, tk] = await Promise.all([
        bgLim.ls(() => getJson(fetchFn, `${B}/position-long-short?symbol=${s}&period=1h`)),
        bgLim.tk(() => getJson(fetchFn, `${B}/taker-buy-sell?symbol=${s}&period=1h`)),
      ]);
      let taker = null;
      if (Array.isArray(tk?.data) && tk.data.length) {
        const last = tk.data.slice(-24); // urut lama -> baru
        const buy = last.reduce((a, x) => a + (num(x.buyVolume) || 0), 0);
        const sell = last.reduce((a, x) => a + (num(x.sellVolume) || 0), 0);
        taker = sell > 0 ? buy / sell : null;
      }
      return {
        ls: Array.isArray(ls?.data) && ls.data.length ? num(ls.data.at(-1).longShortPositionRatio) : null,
        taker,
        oi: null, // Bitget tidak punya riwayat OI publik
      };
    },
  };

  const gtLim = L(120);
  const gate = {
    name: 'Gate',
    async tickers() {
      const d = await getJson(fetchFn, 'https://api.gateio.ws/api/v4/futures/usdt/tickers');
      if (!Array.isArray(d)) return null;
      const m = new Map();
      for (const t of d) {
        if (!t.contract?.endsWith('_USDT')) continue;
        m.set(t.contract.slice(0, -5), num(t.volume_24h_quote) || 0);
      }
      return m;
    },
    async metrics(base) {
      const d = await gtLim(() =>
        getJson(fetchFn, `https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=${base}_USDT&interval=1h&limit=25`),
      );
      if (!Array.isArray(d) || !d.length) return { ls: null, taker: null, oi: null };
      // urut lama -> baru
      // Taker 24j = total volume beli agresif / total jual agresif (bukan
      // rata-rata rasio per jam, yang bias kalau ada jam bervolume kecil).
      const last24 = d.slice(-24);
      const tBuy = last24.reduce((a, x) => a + (num(x.long_taker_size) || 0), 0);
      const tSell = last24.reduce((a, x) => a + (num(x.short_taker_size) || 0), 0);
      return {
        ls: num(d.at(-1).top_lsr_size),
        taker: tSell > 0 ? tBuy / tSell : null,
        oi: d.length > 1 ? pctChange(num(d[0].open_interest), num(d.at(-1).open_interest)) : null,
      };
    },
  };

  return [binance, bybit, okx, bitget, gate];
}

// ---------- penilaian ----------

// Skor 1 bursa dari 3 angka. Aturan transparan:
//   L/S > 1,1 = +1, < 0,9 = -1
//   taker > 1,05 = +1, < 0,95 = -1
//   OI naik > 3%: +1 kalau taker >= 1 (posisi baru dibuka sambil dibeli),
//                 -1 kalau taker < 1 (posisi baru dibuka sambil dijual)
// Per bursa: skor >= 1 condong akumulasi, <= -1 condong distribusi.
// Per koin: condong akumulasi kalau rata-rata skor >= 1 dan bursa yang
// setuju akumulasi >= 2 (atau 1 kalau cuma 1 bursa ada data) serta lebih
// banyak dari yang condong distribusi. Distribusi kebalikannya.
export function scoreExchange({ ls, taker, oi }) {
  let s = 0;
  if (ls !== null) s += ls > 1.1 ? 1 : ls < 0.9 ? -1 : 0;
  if (taker !== null) s += taker > 1.05 ? 1 : taker < 0.95 ? -1 : 0;
  if (oi !== null && taker !== null && oi > 3) s += taker >= 1 ? 1 : -1;
  return s;
}

export function readingOf(score) {
  if (score >= 1) return 'akum';
  if (score <= -1) return 'dist';
  return 'netral';
}

const avg = (xs) => {
  const v = xs.filter((x) => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// Gabungkan hasil per bursa untuk 1 koin.
export function combineCoin(base, perEx) {
  const valid = perEx.filter((e) => e.m && (e.m.ls !== null || e.m.taker !== null || e.m.oi !== null));
  const rows = valid.map((e) => {
    const score = scoreExchange(e.m);
    return { ex: e.ex, score, reading: readingOf(score), m: e.m };
  });
  const akum = rows.filter((r) => r.reading === 'akum');
  const dist = rows.filter((r) => r.reading === 'dist');
  const need = Math.min(2, rows.length);
  const mean = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0;
  let reading = 'netral';
  if (rows.length && mean >= 1 && akum.length >= need && akum.length > dist.length) reading = 'akum';
  else if (rows.length && mean <= -1 && dist.length >= need && dist.length > akum.length) reading = 'dist';
  return {
    base,
    reading,
    agree: akum.map((r) => r.ex),
    against: dist.map((r) => r.ex),
    total: rows.length,
    score: mean,
    ls: avg(rows.map((r) => r.m.ls)),
    taker: avg(rows.map((r) => r.m.taker)),
    oi: avg(rows.map((r) => r.m.oi)),
  };
}

// ---------- format ----------
// Dikirim pakai parse_mode HTML: tabel di dalam <pre> (font monospace)
// supaya kolom rata di HP.

const f2 = (x) => (x === null ? '-' : x.toFixed(2));
const fOi = (x) => (x === null ? '-' : `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`);
const EX_ORDER = ['Binance', 'Bybit', 'OKX', 'Bitget', 'Gate'];
const EX_CODE = { Binance: 'N', Bybit: 'Y', OKX: 'O', Bitget: 'B', Gate: 'G' };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const padR = (t, n) => String(t).padEnd(n);
const padL = (t, n) => String(t).padStart(n);

// Urut kekuatan: bursa setuju terbanyak, lalu skor rata-rata terkuat.
export function rankAkum(coins) {
  return coins
    .filter((c) => c.reading === 'akum')
    .sort((a, b) => b.agree.length - a.agree.length || b.score - a.score || (b.taker || 0) - (a.taker || 0));
}
export function rankDist(coins) {
  return coins
    .filter((c) => c.reading === 'dist')
    .sort((a, b) => b.against.length - a.against.length || a.score - b.score || (a.taker || 0) - (b.taker || 0));
}

function table(list, exsOf) {
  const w = Math.max(4, ...list.map((c) => c.base.length));
  const rows = [`${padL('#', 2)} ${padR('Koin', w)} ${padR('Bursa', 5)} ${padL('L/S', 4)} ${padL('Tk', 4)} ${padL('OI', 6)}`];
  list.forEach((c, i) => {
    const exs = EX_ORDER.filter((e) => exsOf(c).includes(e)).map((e) => EX_CODE[e]).join('');
    rows.push(
      `${padL(i + 1, 2)} ${padR(c.base, w)} ${padR(exs, 5)} ${padL(f2(c.ls), 4)} ${padL(f2(c.taker), 4)} ${padL(fOi(c.oi), 6)}`,
    );
  });
  return `<pre>${esc(rows.join('\n'))}</pre>`;
}

export function formatBandar({ coins, okEx, failEx, dateStr, scanned }) {
  const L = [`🐋 <b>Akumulasi &amp; Distribusi Bandar</b>`, esc(dateStr), ''];
  L.push(`Bursa aktif: ${esc(okEx.length ? okEx.join(', ') : '-')}`);
  if (failEx.length) L.push(`Tidak bisa diakses: ${esc(failEx.join(', '))}`);
  L.push(`Discan: ${scanned} koin futures volume terbesar`);

  if (!okEx.length) {
    L.push('', 'Data tidak tersedia, semua bursa gagal diakses. Coba lagi nanti.');
  } else {
    const top = rankAkum(coins).slice(0, TOP_SHOW);
    const bottom = rankDist(coins).slice(0, TOP_SHOW);
    L.push('', `🟢 <b>Condong akumulasi</b> (${top.length})`);
    L.push(top.length ? table(top, (c) => c.agree) : 'Belum ada koin yang condong akumulasi.');
    L.push('', `🔴 <b>Condong distribusi</b> (${bottom.length})`);
    L.push(bottom.length ? table(bottom, (c) => c.against) : 'Belum ada koin yang condong distribusi.');

    L.push('', '<b>Majors</b>');
    const STAT = { akum: 'Akumulasi', dist: 'Distribusi', netral: 'Netral' };
    const mrows = [`${padR('Koin', 4)} ${padR('Status', 10)} ${padL('L/S', 4)} ${padL('Tk', 4)} ${padL('OI', 6)}`];
    for (const b of ['BTC', 'ETH', 'SOL']) {
      const c = coins.find((x) => x.base === b);
      if (!c || !c.total) mrows.push(`${padR(b, 4)} data tidak tersedia`);
      else mrows.push(`${padR(b, 4)} ${padR(STAT[c.reading], 10)} ${padL(f2(c.ls), 4)} ${padL(f2(c.taker), 4)} ${padL(fOi(c.oi), 6)}`);
    }
    L.push(`<pre>${esc(mrows.join('\n'))}</pre>`);
  }
  L.push('');
  L.push('<i>Bursa: O=OKX G=Gate B=Bitget N=Binance Y=Bybit (yang setuju)</i>');
  L.push('<i>L/S = rasio long/short top trader · Tk = beli/jual agresif 24j · OI = open interest 24j</i>');
  L.push('<i>Urut: bursa setuju terbanyak, lalu skor terkuat.</i>');
  L.push('Bukan sinyal beli/jual, cuma data petunjuk.');
  return L.join('\n');
}

// ---------- scan ----------

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function scanBandar(fetchFn = fetch, { scale = 1, limit = SCAN_LIMIT } = {}) {
  const adapters = makeAdapters(fetchFn, scale);
  const tick = await Promise.all(adapters.map((a) => a.tickers().catch(() => null)));
  const live = adapters.map((a, i) => ({ a, t: tick[i] })).filter((x) => x.t && x.t.size);
  const okEx = live.map((x) => x.a.name);
  const failEx = adapters.filter((a, i) => !(tick[i] && tick[i].size)).map((a) => a.name);

  const okxAd = adapters.find((a) => a.name === 'OKX');
  const cryptoSet = okEx.includes('OKX') ? okxAd.cryptoSet() : null;

  // Universe: total volume USD lintas bursa, hanya crypto, tanpa stablecoin.
  const vol = new Map();
  for (const { t } of live) for (const [b, v] of t) vol.set(b, (vol.get(b) || 0) + v);
  const universe = [...vol.entries()]
    .filter(([b]) => !STABLES.has(b) && /^[A-Z0-9]+$/.test(b))
    .filter(([b]) => !cryptoSet || cryptoSet.has(b))
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit)
    .map(([b]) => b);
  for (const b of ['BTC', 'ETH', 'SOL']) if (!universe.includes(b) && vol.has(b)) universe.push(b);

  // Per bursa jalan paralel; di dalam bursa, koin diproses berurutan lewat limiter.
  const perExResults = await Promise.all(
    live.map(async ({ a, t }) => {
      const res = await mapLimit(universe, 3, async (b) => {
        if (!t.has(b)) return null;
        try {
          return await a.metrics(b);
        } catch {
          return null;
        }
      });
      return { ex: a.name, res };
    }),
  );

  const coins = universe.map((b, i) =>
    combineCoin(b, perExResults.map((r) => ({ ex: r.ex, m: r.res[i] }))),
  );
  return { coins, okEx, failEx, scanned: universe.length };
}

// Cache 5 menit + gabung request yang barengan.
let cache = null;
let inflight = null;

export function bandarCached() {
  return cache && Date.now() - cache.at < CACHE_MS;
}

export async function buildBandar(fetchFn = fetch, opts = {}) {
  if (!opts.noCache && bandarCached()) return cache.text;
  if (!opts.noCache && inflight) return inflight;
  const job = (async () => {
    const r = await scanBandar(fetchFn, opts);
    const text = formatBandar({ ...r, dateStr: `${todayWIB()}, jam ${nowWIB().slice(0, 5)} WIB` });
    if (!opts.noCache) cache = { at: Date.now(), text };
    return text;
  })();
  if (opts.noCache) return job;
  inflight = job;
  try {
    return await job;
  } finally {
    inflight = null;
  }
}
