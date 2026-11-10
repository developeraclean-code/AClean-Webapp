# Audit klasifikasi dan retensi media WA — 10 November 2026

Audit baca-saja: penelusuran kode lokal, metadata objek bucket R2 produksi,
dan screenshot hasil SQL produksi yang dikirim Owner. Tidak menjalankan cron,
penghapusan, perubahan lifecycle, migrasi, push, atau deploy.

## Alur bukti bayar

Pada jalur personal image/document yang eligible (deteksi pembayaran aktif,
pengirim bukan internal, URL/format lolos), aplikasi menyimpan media di
`wa-staging/` sebelum Vision. Preview ditautkan sebelum klasifikasi.
Kategori `bukti_transfer` dipromosikan ke `wa-inbox/`, lalu dibuat
`payment_suggestions` berstatus PENDING untuk ditinjau. Ini tidak melunasi
invoice. Idempotensi media job mencegah duplikasi suggestion untuk job sama.

Media nonpembayaran diberi status IGNORED dan tidak menjadi suggestion, tetapi
objek staging tidak langsung dihapus. Kegagalan AI dapat dijadwalkan ulang.
Karena itu pernyataan “gambar tidak relevan sama sekali tidak disimpan di R2”
tidak sesuai implementasi. Retensi staging pada konfigurasi repo adalah 7 hari.

Sumber: `api/_handlers/wa.js`, `api/_payment-media.js`,
`src/lib/paymentMediaPolicy.js`, `ops/r2-lifecycle.json`.

## Eksekusi cron produksi menurut hasil SQL Owner

Semua baris terakhir yang ditampilkan berstatus SUCCESS. Waktu di bawah
dikonversi dari UTC pada screenshot ke WIB.

| Task | Eksekusi terakhir (WIB) | Bukti hasil |
|---|---|---|
| tick | 10 Nov 12:15:07 | 2 item diproses |
| payment-media-retry | 10 Nov 12:15:07 | 1 item diproses; bukan bukti semua antrean selesai |
| payment-proof-cleanup | 10 Nov 03:05:26 | purged 19, errors 0 |
| r2-cleanup-90d | 10 Nov 03:10:26 | purged 29, errors 0 |
| expense-foto-cleanup | 10 Nov 03:00:28 | purged 0, errors 0 |
| snapshot-cleanup | 10 Nov 10:05:02 | purged 0 |
| wa-cleanup | 10 Nov 09:00:06 | 838 item, errors 0 |
| log-cleanup | 10 Nov 03:00:28 | 1.403 item |
| cleanup | 1 Nov 02:00:06 | 370 item, errors 0; sesuai jadwal bulanan |

`purged=NULL` pada task yang tidak mengembalikan field itu bukan bukti gagal.
Hasil nol pada cleanup tidak berarti error. Tabel ini adalah snapshot eksekusi
terakhir, bukan bukti seluruh riwayat task bebas kegagalan.

Kode cleanup bukti invoice memilih status PAID dan umur >90 hari berdasarkan
paid_at (fallback created_at). `r2-cleanup-90d` memproses mirror media grup WA
>90 hari. Keduanya bukan pembersih `wa-staging/`. `wa-cleanup` menghapus chat
DB >14 hari dengan proteksi nomor yang mempunyai suggestion PENDING baru;
task itu tidak menghapus file staging R2. Cleanup bulanan hanya menghapus
suggestion CONFIRMED/DISMISSED >30 hari, bukan PENDING.

## Pemeriksaan bucket langsung

GET metadata baca-saja pada bucket `aclean-files`, prefix `wa-staging/`:

- HTTP 200, 414 objek, listing lengkap (tidak terpotong).
- Total 57.856.077 byte (sekitar 55,2 MiB).
- 347 objek lebih tua dari 7 hari; objek tertua sekitar 20,13 hari.
- GET konfigurasi lifecycle membalas 403 AccessDenied. Tidak ada perubahan policy.

Ini menunjukkan backlog staging melampaui retensi yang direncanakan. Tidak
membuktikan apakah rule hilang, nonaktif, atau baru diterapkan dan belum
selesai menghapus objek. Konfigurasi lifecycle live masih perlu diperiksa
melalui akses Cloudflare yang berwenang. Toggle cleanup aplikasi yang dilaporkan
aktif tidak membuktikan lifecycle bucket aktif.

Rule repo `wa-inbox/` 90 hari menghapus berdasarkan umur objek tanpa mengetahui
status invoice/suggestion. Jangan menerapkan seluruh JSON tanpa meninjau
perlindungan bukti PENDING atau invoice belum lunas. Retensi staging juga perlu
mempertimbangkan media yang masih gagal/retry sebelum menghapus backlog.

Tidak ada isi foto, nomor telepon, object key pelanggan, URL bertanda tangan,
atau credential yang dicetak dalam audit metadata ini.
