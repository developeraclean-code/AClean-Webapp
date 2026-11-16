# Pembayaran bertahap instalasi — 16 November 2026

Status: kandidat rilis GitHub, deployment produksi akan dilakukan manual oleh Owner. Tidak ada
migrasi, pembacaan database produksi, perubahan AI Vision, atau transaksi
pelanggan nyata oleh pekerjaan ini. Perubahan lain di worktree tetap dipertahankan.

## Masalah dan perilaku

Invoice lumpsum instalasi dapat mencakup paket/DP dan tambahan yang ditagih
beberapa kali. Membandingkan bukti transfer terakhir dengan total invoice yang
belum memiliki pembayaran terdahulu menghasilkan selisih besar. Selisih tersebut
bukan otomatis potongan PPh, diskon, atau bukti penerimaan kas.

`Lampirkan Bukti Bayar` pada sumber WA menyediakan toggle **Pelunasan bertahap
instalasi** untuk service `Install`, `Instalasi`, atau `Installation` dengan selisih
nominal. Saat diaktifkan:

1. Baca ulang saldo invoice dan seluruh ledger pembayaran (pagination 200).
2. Tampilkan total, pembayaran tercatat, bukti terakhir, sisa, dan selisih.
3. Catat satu penerimaan terdahulu per tindakan, memakai nominal nyata yang diisi
   manual, tanggal, metode transfer/tunai, referensi 10–1000 karakter, dan
   pengakuan bahwa penerimaan telah diperiksa serta belum tercatat. Nominal tidak
   diisi otomatis dari selisih; maksimum selisih sebelum transfer terakhir.
4. Simpan melalui `record_invoice_partial_payment_atomic` yang sudah ada, dengan
   UUID pembayaran. Verifikasi identitas hasil, nominal, metode, tanggal,
   referensi, dan saldo sebelum memperbarui UI. Setiap penerimaan adalah transaksi
   tersendiri, sehingga tidak ikut dibatalkan jika modal ditutup.
5. Setelah sisa sesuai nominal bukti terakhir, pengguna memeriksa ulang bukti dan
   mengonfirmasi pelunasan melalui `confirm_invoice_wa_proof_atomic`. Bukti,
   pelunasan, ledger terakhir, dan order tetap mengikuti transaksi server yang ada.

Contoh sintetis: total Rp2.135.000; penerimaan terdahulu Rp1.000.000 dan Rp620.000;
bukti terakhir Rp515.000. Ledger akhir tiga pembayaran, kas Rp2.135.000, potongan
PPh nol. Total/harga dan nominal hasil AI pada bukti terakhir tidak berubah.

## Batas dan pengaman

- Ini bukan izin melunasi selisih yang belum dapat dijelaskan. Jika penerimaan
  terdahulu tidak dapat dibuktikan, periksa invoice dan pembayaran terlebih dahulu.
- Jika pembayaran telah dialokasikan pada invoice paket lain, jangan mencatat
  penerimaan lagi. Pemindahan alokasi antar-invoice belum disediakan oleh toggle.
- Pembayaran terdahulu memakai tanggal penerimaan yang diisi. Pelunasan WA terakhir
  tetap memakai tanggal konfirmasi sesuai RPC existing; tanggal AI adalah acuan
  pemeriksaan, bukan perubahan kontrak tanggal ledger terakhir.
- Riwayat gagal dimuat atau saldo tidak valid memblokir jalur ini. Respons simpan
  terputus/tidak lengkap menghentikan pencatatan dan pelunasan pada panel; tidak
  mengirim replay otomatis. Tutup dan periksa ledger sebelum mencatat kembali.
- Saat menyimpan, pemilihan bukti, perpindahan tab, dan penutupan modal diblokir.
  Konfirmasi bukti direset setelah saldo terbaru diterima/pembayaran disimpan.
- RPC existing menegakkan role dan locking/idempotensi. Pemeriksaan centang,
  tanggal, referensi dan batas selisih pada panel ini adalah validasi UI; tidak
  memperluas atau mengganti kontrak RPC pembayaran umum. Pengguna tetap wajib
  menghindari pencatatan satu transaksi nyata dua kali dengan UUID berbeda.
- Aturan PPh 2–3% tetap berlaku pada jalur PPh; sumber URL/upload dan AI Vision
  tidak memperoleh mode paksa baru.

## Bukti lokal awal

- `npm test`: **155 file, 1.788 tes PASS** pada worktree sesi ini.
- `npm run lint`, `npm run typecheck`, `npm run build`: PASS. Build memiliki
  peringatan import React dinamis/statis existing, tanpa kegagalan build.
- `npm run check:migrations`: PASS untuk nomor dobel baru; gap/nomor warisan tetap
  dilaporkan. Tidak ada migrasi baru.
- `node scripts/smoke-installation-payments.mjs`: PASS pada Chromium desktop 1440px
  dan HP 390px. Browser terhubung ke PGlite terisolasi melalui route lokal yang
  diintersep; RPC cicilan/verifikasi bukti SQL asli dijalankan, tanpa kredensial,
  trafik AI/WA, atau koneksi produksi. Harness memakai definisi guard cicilan dari
  migrasi 246 lokal; ini bukan bukti migrasi tersebut terpasang di target live.
- Dua penerimaan terdahulu dan pelunasan terakhir menghasilkan ledger tepat,
  order PAID, bukti CONFIRMED/LINKED, nominal AI tetap, potongan nol. Replay UUID
  yang sama pada SQL tidak membuat pembayaran kedua.
- Kegagalan baca memblokir pelunasan. Simulasi commit SQL diikuti respons putus
  menghasilkan satu pembayaran PARTIAL_PAID, bukti masih PENDING, tanpa replay
  otomatis. Teknisi/Helper/peran kosong ditolak oleh RPC SQL yang diuji.
- Tidak ada error runtime browser, trafik eksternal, atau overflow horizontal.
  Screenshot sintetis: `/private/tmp/aclean-installments-1440.png` dan
  `/private/tmp/aclean-installments-390.png` (inspeksi visual HP dilakukan).

Menjalankan ulang smoke memerlukan server Vite lokal pada `127.0.0.1:4193`
(atau `PAYMENT_PREVIEW_ORIGIN` yang sesuai). Jangan arahkan harness ke produksi.
Sesi ini memakai Node arm64 `/usr/local/bin/node` karena Node default nvm v25
berarsitektur x86_64 dan tidak dapat dijalankan di host ini.

## Kandidat GitHub — 16 November 2026

Owner meminta commit/push dan SHA untuk redeploy manual. Kandidat disiapkan pada
branch `codex/installation-staged-payments-20261116` berbasis `origin/main`
`87ce1440a3c9988805089d6de1156e3c0b5f5029` di worktree terpisah
`/private/tmp/aclean-installments-release-20261116`. Integrasi mempertahankan
jalur transfer gabungan, bukti dari arsip, dan perbaikan main lainnya. Toggle
hanya ditampilkan untuk kekurangan nominal pada instalasi; transfer berlebih
tetap menggunakan pemeriksaan alokasi gabungan existing. Patch upload dari
worktree utama tidak ikut dipindahkan.

Tidak ada perubahan sumber Coolify, env, database, atau deployment produksi
oleh agen. Percobaan SSH baca-saja ke VPS timeout; akses browser panel tidak
tersedia. Sesuai arahan terbaru, Owner akan melakukan redeploy sendiri.

Verifikasi kandidat main terbaru: **161 file / 1.856 tes PASS**; lint,
typecheck, build, dan check:migrations PASS. Smoke desktop 1440px dan HP 390px
PASS untuk ledger tiga pembayaran, respons putus tanpa replay, baca gagal yang
memblokir pelunasan, serta penolakan Teknisi/Helper/peran kosong. Kandidat
memakai branch rilis di atas; deployment manual harus memilih branch dan SHA
kandidat yang benar, bukan sekadar redeploy SHA produksi lama.
