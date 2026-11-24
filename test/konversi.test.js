import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKonversi, isContractAddress, buildKonversi } from '../src/konversi.js';

test('parse amounts', () => {
  assert.deepEqual(parseKonversi('457 btc'), { amount: 457, coin: 'btc' });
  assert.equal(parseKonversi('1,5 eth').amount, 1.5);
  assert.equal(parseKonversi('1.000.000 pepe').amount, 1000000);
  assert.equal(parseKonversi('10k pepe').amount, 10000);
  assert.equal(parseKonversi('btc 2').amount, 2);
  assert.equal(parseKonversi('btc'), null);
});

test('contract detection', () => {
  assert.ok(isContractAddress('0x' + 'a'.repeat(40)));
  assert.ok(!isContractAddress('pepe'));
});

test('build with mocked fetch (CEX)', async () => {
  const fake = async (url) => ({
    ok: true,
    json: async () => {
      if (url.includes('coingecko')) return { tether: { idr: 18000 } };
      if (url.includes('BTC-USDT')) return { data: [{ last: '100000' }] };
      if (url.includes('ETH-USDT')) return { data: [{ last: '4000' }] };
      if (url.includes('PEPE-USDT')) return { data: [{ last: '0.000004' }] };
      return {};
    },
  });
  const out = await buildKonversi('1000000 pepe', fake);
  assert.match(out.text, /4 USD/);
  assert.match(out.text, /OKX/);
  assert.equal(out.keyboard.inline_keyboard.at(-1)[0].callback_data, 'del');
});

test('falls back to DEX', async () => {
  const fake = async (url) => ({
    ok: true,
    json: async () => {
      if (url.includes('dexscreener')) return { pairs: [{ priceUsd: '0.5', baseToken: { symbol: 'XYZ', address: 'x' }, dexId: 'uniswap', chainId: 'base', url: 'https://dexscreener.com/base/x', liquidity: { usd: 1000 } }] };
      if (url.includes('BTC-USDT')) return { data: [{ last: '100000' }] };
      if (url.includes('ETH-USDT')) return { data: [{ last: '4000' }] };
      return {};
    },
  });
  const out = await buildKonversi('10 xyz', fake);
  assert.match(out.text, /DEX uniswap \(base\)/);
  assert.match(out.text, /Likuiditas DEX kecil/);
});
