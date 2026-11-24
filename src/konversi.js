// /konversi <jumlah> <koin> — konversi koin ke USD, BTC, ETH, IDR.
// Harga CEX (OKX -> Gate -> Bitget, pair USDT). Kalau koin tidak ada di CEX
// atau yang diketik alamat kontrak, pakai DEX (DexScreener, pair likuiditas terbesar).
// Semua API publik gratis tanpa key.

export const KONVERSI_USAGE = [
  'Format: /harga <koin> atau /konversi <jumlah> <koin>',
  'Contoh:',
  '/harga btc',
  '/konversi 457 btc',
  '/konversi 1000000 pepe',
  '/konversi 500 <alamat kontrak> (koin DEX)',
].join('\n');

async function getJson(fetchFn, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Parse "457 btc", "1.5 eth", "1,5 eth", "1.000.000 pepe", "10k pepe".
export function parseKonversi(args) {
  const parts = (args || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  // Cuma nama koin ("/harga btc") -> harga per 1 koin.
  if (parts.length === 1) {
    if (/^[\d.,]+[kmb]?$/i.test(parts[0])) return null;
    return { amount: 1, coin: parts[0] };
  }
  let [rawAmt, coin] = parts;
  // Boleh dibalik: "/konversi btc 457"
  if (!/\d/.test(rawAmt) && /\d/.test(coin)) [rawAmt, coin] = [coin, rawAmt];
  let s = rawAmt.toLowerCase();
  let mult = 1;
  if (s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); }
  else if (s.endsWith('m') || s.endsWith('jt')) { mult = 1e6; s = s.replace(/(m|jt)$/, ''); }
  else if (s.endsWith('b')) { mult = 1e9; s = s.slice(0, -1); }
  // Format Indonesia: titik ribuan, koma desimal.
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, s.includes('.') ? '' : '.');
  const amount = Number(s) * mult;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, coin };
}

export function isContractAddress(s) {
  return /^0x[a-fA-F0-9]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

async function cexPrice(fetchFn, sym) {
  const S = sym.toUpperCase();
  if (S === 'USDT') return { price: 1, source: 'stablecoin', url: null };
  const okx = await getJson(fetchFn, `https://www.okx.com/api/v5/market/ticker?instId=${S}-USDT`);
  const o = Number(okx?.data?.[0]?.last);
  if (o > 0) return { price: o, source: 'OKX', url: `https://www.okx.com/trade-spot/${S.toLowerCase()}-usdt` };
  const gate = await getJson(fetchFn, `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${S}_USDT`);
  const g = Number(Array.isArray(gate) ? gate[0]?.last : NaN);
  if (g > 0) return { price: g, source: 'Gate', url: `https://www.gate.io/trade/${S}_USDT` };
  const bg = await getJson(fetchFn, `https://api.bitget.com/api/v2/spot/market/tickers?symbol=${S}USDT`);
  const b = Number(bg?.data?.[0]?.lastPr);
  if (b > 0) return { price: b, source: 'Bitget', url: `https://www.bitget.com/spot/${S}USDT` };
  return null;
}

async function dexPrice(fetchFn, q) {
  const url = isContractAddress(q)
    ? `https://api.dexscreener.com/latest/dex/tokens/${q}`
    : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
  const data = await getJson(fetchFn, url);
  let pairs = (data?.pairs || []).filter((p) => Number(p.priceUsd) > 0);
  if (!isContractAddress(q)) {
    pairs = pairs.filter((p) => p.baseToken?.symbol?.toUpperCase() === q.toUpperCase());
  } else {
    pairs = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === q.toLowerCase());
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pairs[0];
  return {
    price: Number(p.priceUsd),
    symbol: p.baseToken.symbol,
    source: `DEX ${p.dexId} (${p.chainId})`,
    url: p.url,
    liquidity: p.liquidity?.usd || 0,
  };
}

function fmtNum(n, maxFrac) {
  if (!Number.isFinite(n)) return '-';
  let frac = maxFrac;
  if (frac === undefined) {
    const a = Math.abs(n);
    frac = a >= 1000 ? 0 : a >= 1 ? 2 : a >= 0.01 ? 4 : 8;
  }
  return n.toLocaleString('id-ID', { maximumFractionDigits: frac });
}

export function fmtPrice(n) {
  if (n >= 1) return fmtNum(n, 4);
  // Harga kecil: tampilkan 4 angka penting.
  const digits = Math.min(18, Math.max(2, 3 - Math.floor(Math.log10(n))));
  return n.toLocaleString('id-ID', { maximumFractionDigits: digits });
}

// Kembalikan { text, keyboard } atau { text } kalau gagal.
export async function buildKonversi(args, fetchFn = fetch, opts = {}) {
  const parsed = parseKonversi(args);
  if (!parsed) return { text: KONVERSI_USAGE };
  const { amount, coin } = parsed;

  let info = null;
  let symbol = coin.toUpperCase();
  if (!isContractAddress(coin)) info = await cexPrice(fetchFn, coin);
  if (!info && opts.cexOnly && !isContractAddress(coin)) return { notFound: true };
  if (!info) {
    const d = await dexPrice(fetchFn, coin);
    if (d) { info = d; symbol = d.symbol.toUpperCase(); }
  }
  if (!info) {
    return { notFound: true, text: `Koin "${coin}" nggak ketemu di CEX (OKX, Gate, Bitget) maupun DEX. Cek lagi simbol atau alamat kontraknya.` };
  }

  const [btc, eth, idrData] = await Promise.all([
    cexPrice(fetchFn, 'BTC'),
    cexPrice(fetchFn, 'ETH'),
    getJson(fetchFn, 'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr'),
  ]);
  const usd = amount * info.price;
  const idrRate = Number(idrData?.tether?.idr);

  const idrOf = (v) => (v * idrRate >= 1 ? fmtNum(v * idrRate, 0) : fmtPrice(v * idrRate));
  const lines = [
    `💰 1 ${symbol} = $${fmtPrice(info.price)}${idrRate > 0 ? ` = Rp${idrOf(info.price)}` : ''}`,
    `Sumber: ${info.source}`,
  ];
  if (amount !== 1) {
    lines.push('', `💱 ${fmtNum(amount)} ${symbol}:`, `${usd >= 1 ? fmtNum(usd, 2) : fmtPrice(usd)} USD`);
    if (idrRate > 0) lines.push(`Rp${idrOf(usd)}`);
  } else {
    lines.push('');
  }
  if (btc?.price && symbol !== 'BTC') lines.push(`${fmtPrice(usd / btc.price)} BTC`);
  if (eth?.price && symbol !== 'ETH') lines.push(`${fmtPrice(usd / eth.price)} ETH`);
  if (info.liquidity !== undefined && info.liquidity < 50000) {
    lines.push('', `⚠️ Likuiditas DEX kecil ($${fmtNum(info.liquidity, 0)}), harga gampang goyang / rawan scam.`);
  }
  lines.push('', 'Harga live, bisa beda dikit antar bursa.');

  const rows = [];
  if (info.url) rows.push([{ text: `Chart ${symbol}`, url: info.url }]);
  rows.push([
    { text: 'Bitcoin', url: 'https://www.okx.com/trade-spot/btc-usdt' },
    { text: 'Ethereum', url: 'https://www.okx.com/trade-spot/eth-usdt' },
  ]);
  rows.push([{ text: 'Delete', callback_data: 'del' }]);
  return { text: lines.join('\n'), keyboard: { inline_keyboard: rows } };
}

// Chat biasa tanpa slash: "1 sol", "1 sol =", "2,5 eth=", "1000000 pepe".
// Balikin args kalau formatnya cocok, null kalau bukan.
export function plainKonversiArgs(text) {
  const m = (text || '').trim().match(/^([\d][\d.,]*\s*(?:k|m|b|jt)?)\s*([a-z][a-z0-9]{1,14}|0x[a-fA-F0-9]{40})\s*=?\s*$/i);
  if (!m) return null;
  return `${m[1].replace(/\s+/g, '')} ${m[2]}`;
}
