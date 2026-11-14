# Arsip bukti pembayaran WA — 14 November 2026

Permintaan Owner: bersihkan seluruh saran berstatus `PENDING/PENDING` yang tercampur dari tab Invoice → Pending AI, tetapi simpan media R2 dan sediakan pemulihan per bukti. Audit baca-saja sebelum perubahan menemukan 86 saran berisi 86 URL R2 berbeda (67 `wa-inbox/`, 19 `wa-images/`). Semua 86 objek asal dapat dibaca pada saat audit, total 7.854.552 byte. Tampilan hanya memperlihatkan 63 karena 23 baris tersaring oleh kebijakan bukti pembayaran. Angka ini adalah snapshot, bukan jaminan keadaan produksi berikutnya.

## Kontrak

- Skrip `api/_archive-payment-suggestions.mjs` memerlukan cutoff waktu, jumlah yang diharapkan, dan UUID batch. Ia menolak perubahan bila jumlah `pending + arsip batch aktif` tidak sama dengan ekspektasi. Jalankan dry-run sebelum `--execute`.
- Untuk setiap saran, skrip membaca objek asal, mendeteksi tipe dari signature, menyalin ke `payment-archive/YYYY-MM/<batch>/<suggestion>.<ext>`, lalu membaca ulang dan membandingkan SHA-256. RPC service-only migrasi 244 mencatat manifest dan mengubah `status` serta `validation_status` menjadi `ARCHIVED` hanya setelah verifikasi.
- Objek asal tidak dihapus. Prefix baru berada di luar aturan hapus 90 hari `wa-inbox/` dan `wa-images/` yang tercatat di `ops/r2-lifecycle.json`. Konfigurasi repo bukan bukti aturan live; audit lifecycle bucket tetap diperlukan untuk klaim retensi jangka panjang.
- Tab Pending AI memiliki panel Arsip bukti untuk Owner/Admin. Tombol Pulihkan mengembalikan satu saran ke `PENDING/PENDING` dan mengganti `image_url` ke salinan arsip. Penanda `restored_from_archive_at` membuat saran yang dahulu tersaring terlihat untuk tinjauan manual; `match_source` asli tetap dipertahankan agar pemeriksaan pembayaran berlaku.
- Arsip tidak menulis `invoices`, `invoice_payments`, atau ledger dan tidak menandai invoice lunas. Saran `CONFIRMED` dan `DISMISSED` tidak masuk scope skrip.

## Operasi dan verifikasi

1. Terapkan migrasi 244 setelah memeriksa constraint/RLS produksi. Deploy build yang memuat proxy prefix `payment-archive/`, skrip, dan UI pemulihan.
2. Tetapkan cutoff sebelum batch. Catat UUID batch di manifest operasional privat. Jalankan `node api/_archive-payment-suggestions.mjs --before <ISO> --expected <COUNT> --batch-id <UUID>` dari container aplikasi untuk dry-run, lalu ulangi dengan `--execute`. Jika terhenti, gunakan parameter batch yang sama.
3. Baca ulang jumlah saran `ARCHIVED/ARCHIVED` untuk batch, manifest aktif, dan jumlah `PENDING/PENDING` pada cutoff. Uji satu objek arsip melalui proxy foto dan uji pemulihan dalam transaksi yang di-rollback atau dengan fixture; jangan mengubah bukti pembayaran nyata hanya untuk uji.
4. Di browser Owner, buka Invoice → Pending AI → Arsip bukti; cek daftar/preview. Item yang dipulihkan muncul di Pending AI dan tetap perlu pemeriksaan invoice.

**Batas:** Panel kesehatan media menampilkan sejarah kegagalan job terpisah dari saran pembayaran. Mengarsipkan saran tidak menghapus sejarah kegagalan tersebut. Saran baru yang datang setelah cutoff tetap aktif.

## Hasil produksi 14 November 2026, sekitar 15.20 WIB

- PR #23 dan #24 lulus lint/typecheck/unit serta Playwright E2E; merge terakhir `dbd6af467b3a4aa5cfb688248baee304aadd55b4` berstatus `Finished` dan Coolify `running:healthy`. Health publik melaporkan versi `dbd6af4`.
- Migrasi 244 diterapkan pada database live. Simulasi migrasi di lab dan produksi sebelumnya lulus dalam transaksi `ROLLBACK`; uji archive→restore atas satu saran nyata juga lulus dalam transaksi `ROLLBACK`.
- Batch `5cd738f9-8ab1-41d9-9ab7-30d7dd6ac6db` memakai cutoff `2026-11-14T07:58:43Z` dan ekspektasi 86. Dry-run menunjukkan 86 pending/0 arsip. Eksekusi selesai 86/86. Baca ulang DB: 86 manifest aktif, 86 saran `ARCHIVED/ARCHIVED`, 0 saran pending dari cutoff, total 7.854.552 byte.
- Pemeriksaan signature file asal: 82 JPEG dan 4 PDF, tanpa file tak terbaca. Setelah batch, seluruh 86 objek asal dan 86 salinan R2 diverifikasi ulang terhadap hash/ukuran manifest; proxy aplikasi mengembalikan 200 dengan MIME JPEG/PDF yang sesuai. Uji RLS: Owner melihat 86 arsip, sesi tanpa identitas melihat 0. Grant anonim untuk tabel/restore tidak tersedia.
- Satu saran baru dibuat setelah cutoff pada `2026-11-14T08:13:52Z`; karena itu counter `review` live setelah batch adalah 1. Panel health masih mencatat 49 job gagal historis dan 4 menunggu, yang merupakan antrean terpisah dari 86 saran lama.
- Browser live Owner tidak dapat diuji dari sesi agen karena host browser automation tidak tersedia. Aturan lifecycle R2 live juga tidak dapat dibaca: kredensial objek mengembalikan HTTP 403 untuk `GetBucketLifecycleConfiguration`, dan token Cloudflare lifecycle tidak terpasang pada aplikasi. Prefix arsip berada di luar rule delete yang tercatat di repo, tetapi retensi live belum terkonfirmasi secara independen.
