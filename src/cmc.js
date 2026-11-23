// Data CoinMarketCap (rank, market cap, volume 24j, perubahan harga 24j).
// Pakai endpoint data publik CMC tanpa API key, 1 request untuk ~2000 koin
// teratas, cache 5 menit. Kalau CMC gagal -> null, laporan tetap jalan
// tanpa kolom CMC (tidak ada angka karangan).

export const CMC_URL =
  'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing' +
  '?start=1&limit=2000&sortBy=market_cap&sortType=desc&convert=USD' +
  '&cryptoType=all&tagType=all&audited=false';
const CACHE_MS = 5 * 60 * 1000;
// Harga bursa vs CMC boleh beda maksimal segini (cegah salah koin karena simbol sama).
export const PRICE_TOLERANCE = 0.2;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Ubah respons CMC jadi Map(SIMBOL -> [kandidat...]) urut rank terbaik dulu.
export function parseCmc(json) {
  const list = json?.data?.cryptoCurrencyList;
  if (!Array.isArray(list) || !list.length) return null;
  const map = new Map();
  for (const c of list) {
    const q = Array.isArray(c.quotes) ? c.quotes.find((x) => x.name === 'USD') || c.quotes[0] : null;
    const sym = String(c.symbol || '').toUpperCase();
    if (!sym || !q) continue;
    const item = {
      symbol: sym,
      name: c.name,
      rank: num(c.cmcRank),
      price: num(q.price),
      mcap: num(q.marketCap) || null, // 0 = supply belum terverifikasi CMC -> tampil '-'
      vol: num(q.volume24h),
      ch24: num(q.percentChange24h),
    };
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym).push(item);
  }
  for (const arr of map.values()) arr.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return map;
}

// Kontrak futures kadang pakai pengali, mis. 1000PEPE = 1000 PEPE.
export function splitMultiplier(base) {
  const m = /^(1000000|100000|10000|1000|100|1M)([A-Z][A-Z0-9]*)$/.exec(base);
  if (!m) return { sym: base, mult: 1 };
  return { sym: m[2], mult: m[1] === '1M' ? 1e6 : Number(m[1]) };
}

// Cari data CMC untuk 1 koin bursa. exPrice = harga kontrak di bursa (boleh null).
// Kalau ada harga bursa, pilih kandidat yang harganya cocok (±20%);
// kalau tidak ada yang cocok -> null (lebih baik kosong daripada salah koin).
// Kalau harga bursa tidak ada, ambil kandidat rank terbaik.
export function matchCmc(map, base, exPrice = null) {
  if (!map) return null;
  const tries = [{ sym: base, mult: 1 }];
  const sm = splitMultiplier(base);
  if (sm.mult !== 1) tries.push(sm);
  for (const { sym, mult } of tries) {
    const cands = map.get(sym);
    if (!cands || !cands.length) continue;
    if (exPrice === null || !(exPrice > 0)) {
      if (mult === 1) return cands[0];
      continue;
    }
    const unit = exPrice / mult;
    const hit = cands.find((c) => c.price > 0 && Math.abs(c.price - unit) / unit <= PRICE_TOLERANCE);
    if (hit) return hit;
  }
  return null;
}

let cache = null;

export async function fetchCmc(fetchFn = fetch, { noCache = false } = {}) {
  if (!noCache && cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  try {
    const res = await fetchFn(CMC_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (ndrean7-bot)', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const map = parseCmc(await res.json());
    if (map && !noCache) cache = { at: Date.now(), map };
    return map;
  } catch {
    return null;
  }
}

// ---------- format angka ----------

export function fUsd(x) {
  if (x === null || x === undefined || !Number.isFinite(x) || x <= 0) return '-';
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [v, u] of units) {
    if (x >= v) {
      const n = x / v;
      return `$${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)}${u}`;
    }
  }
  return `$${x.toFixed(0)}`;
}

export function fPct(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  const s = Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1);
  return `${x >= 0 ? '+' : ''}${s}%`;
}
