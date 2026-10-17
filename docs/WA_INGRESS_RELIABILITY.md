# Penerimaan WA yang dapat ditelusuri

## Temuan 17 Oktober 2026

Bukti customer pukul 07.37 WIB belum ditemukan pada request webhook yang tercatat,
raw receipt, pesan, antrean media, atau suggestion. Dalam jendela 07.20–07.55 WIB,
request inbound yang tercatat hanya berasal dari pengirim lain pukul 07.41.
Endpoint health dan worker retry tetap sukses; pemeriksaan worker pukul 07.37
melaporkan tidak ada media untuk diproses. Ini menunjukkan batas kehilangan yang
teramati **sebelum penerimaan endpoint**, bukan bukti AI menolak transfer tersebut.
Pemeriksaan metadata R2 pada prefix `wa-inbox/2026-10/` (390 objek) dan `wa-images/`
(1.001 objek) selesai seluruhnya; tidak ada objek dengan waktu perubahan dalam
jendela tersebut. Pemeriksaan tidak mengunduh file customer atau mengubah bucket.

Penyebab di WhatsApp/Fonnte belum dipastikan. Label HD pada screenshot tidak
membuktikan ukuran/format file maupun penyebab kehilangan. API profil device hanya
mengonfirmasi koneksi dan paket; tidak membuktikan konfigurasi webhook, Autoread,
atau Inbox. Jangan menyimpulkan pengiriman berhasil hanya dari koneksi device.

## Kontrak baru — migrasi 214

1. Setelah validasi secret webhook, normalisasi identitas dan format pesan.
2. Satu transaksi menyimpan receipt, pesan personal, increment unread percakapan,
   serta referensi media customer yang memenuhi syarat untuk antrean retry.
3. Hanya setelah transaksi commit, pemrosesan foto dilanjutkan. Jika transaksi
   gagal, balas HTTP 503 dengan `Retry-After`, bukan sukses palsu.
4. Unduh file terbatas dari URL HTTPS Fonnte yang diizinkan, lalu simpan R2
   **sebelum** AI. Gagal staging menghentikan AI dan meninggalkan referensi retry.
5. Penulisan URL R2 pada antrean sekaligus menautkan lampiran pesan induk lewat
   trigger database. Pemulihan oleh worker juga memperbaiki lampiran chat.
6. Suggestion tetap untuk tinjauan admin; penerimaan tidak menyentuh invoice,
   ledger, stok, status PAID, atau pengiriman WA.

Receipt menggunakan ID event deterministik bila provider memberi ID/timestamp
atau URL media. Replay event yang sama tidak menambah pesan/unread/antrean lagi.
Jika teks tidak memiliki identitas stabil, jangan membuang pesan kedua hanya
karena isinya sama. Pemrosesan grup tetap mengikuti deduplikasi jalur grup lama.

Perubahan format yang ditangani:

- Alias `from`, JID telepon yang dikenal, dan field teks/caption.
- Video/audio tanpa caption tetap dicatat, bukan 400 yang berulang. Tidak dikirim
  ke AI pembayaran dan tidak memicu auto-reply.
- LID/identitas belum pasti atau foto tanpa URL aman disimpan sebagai REVIEW;
  jangan mengarang nomor customer dari digit LID.
- Foto kecil tidak lagi dibuang berdasarkan ambang 10 KB. Unduhan dibatasi
  10 MB dan waktu; file kosong/HTTP gagal tetap menjadi kendala retry.
- Foto material/tas operasional dan nomor internal tidak dimasukkan sebagai
  bukti pembayaran customer; alur operasional yang ada dipertahankan.
- Foto dengan caption pembayaran tidak lagi sekaligus menjalankan deteksi teks
  pembayaran sebelum staging foto.

## Monitoring dan refresh

Invoice menampilkan waktu penerimaan webhook terakhir, jumlah event 24 jam, serta
receipt REVIEW dengan alasan/ID penerimaan (maksimal 20 rincian). Endpoint hanya
Owner/Admin/server internal. Payload mentah, token, dan URL sumber tidak diteruskan
melalui monitor. Kegagalan monitor terlihat sebagai belum tersedia, bukan nol.

**Antrean retry kosong bukan jaminan seluruh pesan WhatsApp diterima.** Server
tidak dapat mendeteksi sebuah pesan yang sama sekali tidak pernah dikirim provider
tanpa pembanding dari sisi provider/WA. Monitor ini bukan rekonsiliasi Inbox Fonnte.

Daftar percakapan Workspace melakukan refresh 60 detik hanya ketika panel dibuka
Owner/Admin dan tab terlihat, termasuk malam/Minggu. Fokus/online kembali memicu
refresh. Gagal baca mempertahankan snapshot dan menampilkan peringatan. Tidak
bergantung pada toggle polling WA Monitor lama; menutup panel menghentikan polling.
Ini terpisah dari penerimaan server dan tidak mengaktifkan auto-reply ARA.

## Rilis dan batas pemulihan

1. Jalankan validasi lokal di bawah.
2. Dengan persetujuan Owner, terapkan **hanya migrasi 214** ke proyek yang benar.
   Migrasi additive/idempotent; tidak backfill atau mengubah finansial historis.
3. Deploy backend yang menggunakan `capture_wa_webhook_214`, lalu UI. Jangan
   deploy handler baru sebelum RPC tersedia: ia sengaja mengembalikan 503 jika
   penerimaan belum dapat dikonfirmasi.
4. Fonnte → Device → Edit: periksa URL `/api/receive-wa`, secret bila digunakan,
   serta Autoread/Inbox sesuai pengaturan provider. Alias lama `/api/fonnte-webhook`
   tetap memakai handler dan validasi secret yang sama. Jangan mencetak token URL.
5. Uji satu teks, foto biasa, dan foto HD dari nomor milik Owner dengan persetujuan
   pengiriman nyata. Cocokkan waktu/receipt/pesan/referensi/R2/suggestion. Verifikasi
   pembayaran tetap manual. Pengujian lokal tidak mengirim pesan nyata.

HTTP 200 berarti referensi penerimaan tersimpan, **bukan** file sudah berada di R2
atau pembayaran telah sah. Retry provider dibatasi oleh provider; ini bukan
penyimpanan pengganti saat Supabase mati tanpa batas. Worker tidak bisa mengambil
pesan yang tidak pernah memberi event/URL. Untuk bukti yang hilang sejak upstream,
ambil file asli dari WA/Inbox provider dan lampirkan ke invoice yang benar melalui
alur tinjauan. Jangan mengubah UNPAID berdasarkan screenshot saja.

## Pengujian terisolasi

Semua data sintetis; tidak memakai API AI, mengirim WA, atau menulis produksi.

```sh
npm test
npm run lint
npm run build
npm run check:migrations
node scripts/test-wa-ingress-db.mjs
node scripts/test-payment-worker-db.mjs
node scripts/test-payment-media-db.mjs
npx playwright test --config e2e/wa-workspace.config.js
node scripts/smoke-payment-health.mjs
node scripts/smoke-payment-inbox.mjs
```

Script PostgreSQL/WASM membutuhkan PGlite; bila tidak terpasang pada repo,
`WA_PGLITE_MODULE` dapat menunjuk instalasi lokal yang sudah tersedia. Smoke status
memakai preview Vite lokal port 4192 secara bawaan (`PAYMENT_PREVIEW_ORIGIN` dapat
diubah), dengan API/akses eksternal diblokir. Preview UI memakai data sintetis:
`/preview/payment-health/index.html`, termasuk simulasi REVIEW dan monitor gagal.

## Catatan rilis 17 Oktober 2026

Migrasi 214 diterapkan atas persetujuan Owner sebelum rilis backend, tercatat
sebagai `20261017000000214`. Kolom, trigger lampiran pesan, izin RPC khusus
service-role, dan pembacaan health telah diverifikasi. Fingerprint seluruh nilai
lama pada invoice, ledger pembayaran, order, suggestion, pesan, percakapan,
receipt, antrean media dan pengaturan tidak berubah selama transaksi migrasi.
Tidak menjalankan worker, memanggil AI, atau mengirim WA dari script penerapan.

Validasi sebelum rilis: 1.343 tes unit, 40 skenario browser Workspace, 11 kelompok
tes SQL penerimaan (200 pesan + 200 replay), 12 kelompok tes worker (200 media),
smoke Invoice/status desktop-mobile, lint dan build lolos. Pengujian nyata
pengiriman foto dari WhatsApp/Fonnte tetap perlu dibandingkan pada operasional
berikutnya; kelulusan simulasi bukan jaminan seluruh pesan provider terkirim.
