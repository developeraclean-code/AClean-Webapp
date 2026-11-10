# Audit paritas WhatsApp — 10 November 2026

## Temuan dan perbaikan

Dasar patch: `077d617` di branch staging, penerus fitur `9669f2f`.
Screenshot Owner membuktikan teks WhaCenter berstatus RECORDED setelah secret diperbaiki;
foto berikutnya gagal HTTP 400. Penolakan SQL direproduksi pada PostgreSQL terisolasi:
`capture_wa_webhook_214` menerima media Fonnte saja. Ini bukan bukti bahwa skema produksi
sudah diaudit langsung. Pemeriksaan HTTP publik menunjukkan database/Auth sehat dan GET
webhook aktif; version health berasal dari environment, bukan inspeksi SHA image/container.

| Jalur | Hasil audit/perubahan |
| --- | --- |
| Webhook teks/foto/PDF | Migrasi 233 memperbarui RPC lama, dengan overload terpisah untuk host CDN tambahan yang berasal dari environment server. RPC lama tetap bekerja untuk deployment Fonnte sebelumnya. |
| Validasi URL | HTTPS dan domain provider yang sesuai; host tambahan WhaCenter bersifat tambahan, bukan mengganti domain bawaan. Tolak credential, port selain HTTPS standar, IP, domain tiruan dan wildcard. Batas media 10 MB dan redirect tidak diikuti. |
| Antrean/retry media | `wa_payment_media_jobs.provider` menyimpan gateway asal; lease worker mengembalikannya. Retry tidak mengikuti perubahan provider global. Mirroring R2 mendahului AI, tanpa mutasi pembayaran otomatis. |
| Notifikasi operasional | Biaya lapangan, tas teknisi, rating rendah dan pengingat legacy menggunakan adaptor provider yang sama dengan workspace/cron. Tidak lagi membutuhkan token Fonnte saat WhaCenter dipilih. |
| Balasan webhook/AI | Seluruh balasan satu request memakai snapshot provider yang sudah diautentikasi. Pergantian provider saat pemrosesan tidak mengalihkan balasan itu. |
| Outbox invoice/laporan/katalog/reminder | Satu upaya pengiriman, audit provider 232 tetap digunakan. Respons kosong/tidak valid atau kegagalan server tanpa konfirmasi menjadi UNCERTAIN. Provider tetap tercatat saat koneksi putus; kegagalan audit tidak memicu kirim ulang. |
| Identitas/format | Dukung bentuk resmi `from/to/message/media/timestamp`, PDF lewat nama/MIME, video/audio tanpa type, dan group ID + participant eksplisit. Field media tidak lagi terpotong menjadi 100 karakter. Dokumen Office/arsip disimpan untuk review manual, bukan dikirim sebagai foto ke AI. |
| Pengaturan/koneksi | Fonnte memakai `/device` untuk menguji koneksi perangkat. Tolak URL lengkap/spasi/tanda kutip dalam secret WhaCenter saat aktivasi. Health WhaCenter dilaporkan terpisah dari Fonnte. |
| Grup | Discovery dari database tersedia bagi kedua provider. API sinkronisasi daftar grup tetap khusus Fonnte. WhaCenter mengirim ke nama grup yang dipetakan di `wa_monitored_groups`, sesuai API resminya. |

## Migrasi dan urutan deployment

1. Pastikan database target benar (staging/production) dan 214, 231, 232 sudah tersedia.
2. Jalankan `migrations/233_wa_media_provider_parity.sql` melalui SQL Editor target.
   Ini migrasi forward, tidak mengubah file 214 yang sudah pernah diterapkan. Script
   idempotent dan memanggil `NOTIFY pgrst, 'reload schema'` setelah kontrak RPC diperbarui.
3. Periksa kolom `provider` pada `wa_payment_media_jobs`, overload
   `capture_wa_webhook_214(jsonb,text[])`, dan grant service_role. Tidak ada grant baru
   untuk anon/authenticated atau perubahan policy tabel finansial.
4. Deploy SHA patch secara manual di Coolify. Token Fonnte tidak perlu dihapus.
   `WHACENTER_WEBHOOK_SECRET` hanya token; dashboard WhaCenter berisi URL lengkap
   `/api/whacenter-webhook?token=<token-yang-sama>`.
5. Jika media berasal dari CDN di luar `*.whacenter.com`, isi daftar nama host tepat
   di `WHACENTER_MEDIA_HOSTS` (maksimum 32); deploy ulang setelah mengubah environment.
   Overload RPC menerima daftar dari server, bukan field pada webhook publik.

Pemeriksaan SQL baca-saja setelah migrasi:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='wa_payment_media_jobs' AND column_name='provider';
SELECT to_regprocedure('public.capture_wa_webhook_214(jsonb,text[])');
SELECT has_function_privilege('service_role','public.capture_wa_webhook_214(jsonb,text[])','EXECUTE') AS server_allowed,
       has_function_privilege('authenticated','public.capture_wa_webhook_214(jsonb,text[])','EXECUTE') AS browser_allowed;
```

## Verifikasi

Pengujian terisolasi mencakup reproduksi error sebelum 233, apply dua kali, intake media
kedua provider, whitelist CDN, penolakan URL, rollback atomik, 200 penerimaan + 200 replay,
identitas grup, grant anon/authenticated dan panggilan aktual service_role, serta provider
pada lease worker. Tes JavaScript memeriksa handler WhaCenter foto/PDF sampai staging
sebelum AI, retry provider asal setelah selector berubah, balasan yang tetap pada provider
awal, notifikasi tanpa token Fonnte, timeout tanpa fallback, dan audit outbox saat putus.

Hasil akhir patch lokal: **1.763 tes Vitest / 155 file lulus**, lint, typecheck,
check:migrations dan build lulus. PostgreSQL/WASM: **18 kelompok ingress** (termasuk
200 penerimaan dan 200 replay), **13 kelompok worker** (200 pipeline media), dan
**13 kelompok workspace** lulus. Adapter self-host **14/14 lulus**. Uji self-host awal
terhalang izin bind loopback sandbox; dijalankan ulang dengan izin localhost dan lulus. Tidak ada pesan WhatsApp, panggilan AI,
atau mutasi produksi yang dijalankan oleh pengujian lokal. Migrasi 233 masih **Pending**
pada lingkungan nyata sampai diterapkan dan hasil baca-ulang dikonfirmasi.

## Uji nyata yang masih wajib

- Satu teks pribadi dan satu foto/PDF pribadi melalui WhaCenter: receipt/media_job tercatat,
  R2 aman, hasil tampil di aplikasi; bukti pembayaran tetap membutuhkan review manusia.
- Kirim teks serta PDF invoice/laporan dan katalog ke nomor uji; cocokkan satu penerimaan
  di perangkat dengan satu audit outbox. Jangan replay UNCERTAIN tanpa periksa provider.
- Uji foto operasional `Pagi Tas N`/`Material Pagi`, notifikasi Owner, dan reminder terkontrol.
- Uji grup dengan nama unik dan pemetaan yang tepat. Dokumen resmi tidak menyediakan
  contoh webhook grup lengkap ataupun jaminan media grup; jangan menyatakan paritas
  grup/media grup lulus sebelum callback perangkat nyata diperiksa.
- Pergantian kembali ke Fonnte dan kembali ke WhaCenter: hanya route terpilih yang diterima,
  pengiriman tidak berpindah provider otomatis, pekerjaan media lama tetap dapat dipulihkan.

Tes lokal/build bukan probabilitas keberhasilan produksi. Keyakinan menyeluruh memerlukan
migrasi pada target dan hasil uji perangkat nyata di atas; jangan menyebut 90% aman hanya
berdasarkan jumlah tes.

Referensi kontrak provider: [webhook WhaCenter](https://order.whacenter.com/docs/cara-menggunakan-webhook-di-whacenter/),
[kirim file WhaCenter](https://order.whacenter.com/docs/cara-kirim-pesan-gambar-atau-file-via-api-whacenter-dengan-menggunakan-php/),
[kirim grup WhaCenter](https://order.whacenter.com/docs/cara-kirim-pesan-text-ke-group-wa-via-api-whacenter/),
[profil device Fonnte](https://docs.fonnte.com/api-device-profile/).
