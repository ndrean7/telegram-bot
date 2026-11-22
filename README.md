# Bot Telegram umum

Bot Telegram sederhana pakai **Bot API resmi Telegram**. Tanpa QR, tanpa
nomor, tanpa server 24 jam yang ribet — token dari BotFather, jalan pakai
long polling.

Bot ini menjawab dengan aturan ketat, tidak ngawur:

- Salam (`halo`, `hai`, `pagi`, `siang`, `sore`, `malam`) → sapaan + tawaran `/menu`
- `/menu`, `/help`, `/bantuan`, `.menu` → daftar perintah
- `/info` → info bot
- `/jam` → jam sekarang (WIB)
- `/ping` → `Pong!` + uptime
- `/market` → Market Live (forex, crypto, saham), on-demand, bukan harian
- `/bandar` → scan akumulasi & distribusi bandar crypto (top 15 masing-masing): ~100 koin futures volume terbesar, data publik OKX, Bitget, Gate (Binance/Bybit ikut kalau bisa diakses dari server). Bukan sinyal beli/jual.
- Pesan lain / perintah tidak dikenal → `Maaf, saya tidak mengerti. Ketik /menu untuk lihat perintah yang tersedia.`

Jawaban pendek, bahasa Indonesia.

## 1. Bikin bot di BotFather

1. Buka Telegram, cari **@BotFather**, pencet **Start**.
2. Kirim `/newbot`, ikuti panduannya: kasih nama bot, lalu username bot (harus diakhiri `bot`, contoh: `BotUmum0xndrean7_bot`).
3. BotFather kasih **token** seperti `123456:ABC-DEF...`. Catat token itu.
   Jangan bagikan token ke siapa pun — token = password bot.

## 2. Jalanin di lokal

```bash
npm install
cp .env.example .env
# isi TELEGRAM_BOT_TOKEN di .env dengan token dari BotFather
npm start
```

Buka Telegram, cari username bot kamu, kirim `halo` atau `/menu`.
Cek health: `http://localhost:3000/health` → `{"ok": true}`.

## 3. Deploy ke Railway

1. Buka Railway, **+ New > GitHub Repository**, pilih repo `telegram-bot`.
2. Tunggu deploy selesai (status ACTIVE).
3. Buka tab **Variables**, tambah:
   - `TELEGRAM_BOT_TOKEN` = token dari BotFather
4. Selesai. Bot langsung jalan — tidak butuh domain, tidak butuh webhook.
   Kalau deploy lama tidak jalan, cek tab **Logs**.

Catatan: Railway trial gratis terbatas. Kalau muncul "limit exceeded",
hapus project lama yang tidak dipakai (misalnya project bot WhatsApp).

## 4. Tambah perintah baru

1. Buka `src/commands/index.js`, tambah `case` baru di `runCommand`,
   contoh:

```js
case 'harga':
  return 'Harga ...';
```

2. Tambah barisnya di `menuText()`.
3. Tambah tes di `test/handlers.test.js`, lalu `npm test`.

## Kenapa Telegram, bukan WhatsApp?

- Telegram bot itu **resmi** — dibuat lewat BotFather, aman dari ban.
- Tidak butuh QR, tidak butuh nomor cadangan, tidak butuh HP nyala.
- Satu token cukup, tidak ada verifikasi nomor atau webhook wajib.

## Tes

```bash
npm test
```

Tes memakai handler murni (tanpa kirim pesan ke Telegram asli).
