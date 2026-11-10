# Preview media WhatsApp — 10 November 2026

Owner mengonfirmasi foto/PDF merupakan pesan masuk dari nomor lain. Query Owner
menunjukkan empat job WhaCenter FAILED_RETRYABLE tanpa referensi R2/preview.
Query lanjutan menunjukkan lima kegagalan terbaru: fetch failed pada webhook dan
retry juga gagal mengunduh.
Probe GET baca-saja dari container production kemudian membuktikan:

- Host sumber app.whacenter.com membalas **302**.
- Tujuan redirect adalah **sin1.contabostorage.com**.
- Pengunduh sebelumnya memakai redirect:error sehingga berhenti sebelum R2.

Akar kegagalan unduhan ini sudah didukung bukti runtime Owner. Pemeriksa belum dapat
membaca objek produksi melalui SSH (timeout). Cacat preview di bawah adalah temuan
terpisah yang tetap perlu diperbaiki sesudah unduhan berhasil.

## Perbaikan unduhan

WhaCenter mengikuti redirect secara manual, maksimal tiga hop dengan satu deadline.
Setiap URL harus HTTPS dan lolos whitelist provider sebelum request berikutnya;
header credential/cookie tidak diteruskan dan verifikasi TLS tidak dinonaktifkan.
Fonnte tetap memakai kebijakan redirect:error sebelumnya.

Pada environment Coolify target, isi/tambahkan **sin1.contabostorage.com** ke
**WHACENTER_MEDIA_HOSTS**. Daftar tambahan tidak mengganti domain WhaCenter bawaan.
Jangan menambahkan wildcard seluruh contabostorage.com. URL gateway WhaCenter asli
masih disimpan di job; URL storage bertanda tangan tidak dicetak atau dipersist ulang,
sehingga retry memperoleh redirect/signature baru dari gateway.

Kegagalan berikutnya memakai kode aman WA_MEDIA_REDIRECT_HOST_REJECTED,
WA_MEDIA_REDIRECT_LIMIT, WA_MEDIA_HTTP_*, WA_MEDIA_TIMEOUT atau kode DNS/TLS yang
sudah disaring. Worker menyimpan kode yang sama, tanpa URL pelanggan atau token.

## Cacat yang direproduksi

Migrasi 233 memperbaiki validasi URL media, tetapi trigger dari 214 hanya mengisi
wa_messages.image_url untuk prefix wa-inbox/. Sebelum hasil AI dikenali sebagai
bukti transfer, media berada pada wa-staging/ dan tidak tertaut ke preview chat.
Foto unit/PO yang diabaikan sebagai nonpembayaran serta media dengan AI timeout
bisa memiliki objek staging tanpa thumbnail di percakapan.

Perbaikan:

- Handler menautkan hasil staging segera setelah upload/upsert berhasil, sebelum AI.
- Migrasi 234 memperluas trigger ke prefix wa-staging/ dan menautkan hasil worker,
  termasuk saat wa_message_id baru diisi setelah upload. Promosi ke wa-inbox/
  mengganti URL staging secara atomik. Link manual yang berbeda tetap dilindungi.
- Backfill 234 hanya memperbaiki hubungan yang sudah punya message ID + phone
  cocok. Tidak mengunggah ulang objek, membuat saran pembayaran, atau mengubah ledger.
- UI membedakan foto dan PDF, menandai staging sebagai lampiran sementara, serta
  memaksa staging lewat proxy aplikasi ketika CDN publik dikonfigurasi.
- WA_INGRESS_CAPTURED menambahkan indikator media/host yang diizinkan, permintaan
  capture, internal sender dan toggle deteksi. WA_MEDIA_STORED mencatat receipt/job/
  message ID serta r2_reference_saved dan chat_preview_linked tanpa URL atau token.

Perbaikan ini menghubungkan media yang memang masuk staging pada pipeline yang
ada. Aturan pengirim internal, toggle deteksi, format yang didukung dan retensi
staging tetap berlaku; ini bukan perubahan kebijakan menjadi arsip permanen seluruh
WhatsApp. PDF ditampilkan sebagai tautan dokumen, bukan elemen img yang gagal.

## Diagnosis data target, baca-saja

Jalankan `scripts/sql/wa-media-storage-diagnostics.sql` di SQL Editor target.
Script menampilkan receipt media dua jam terakhir, status antrean, keberadaan
referensi R2 dan hubungan ke pesan, tanpa nomor telepon/isi pesan/URL/token.

| Hasil | Arti |
| --- | --- |
| r2_reference_saved=true, chat_preview_linked=false | Ada referensi upload R2; preview belum ditautkan. Apply 234 + deploy patch. |
| r2_reference_saved=false | Upload belum selesai/berhasil; lihat status antrean dan log download/staging. |
| Tidak ada receipt media | Periksa payload webhook serta waktu log dan indikator media; receipt teks saja belum membuktikan callback foto diterima. |
| Keduanya true tetapi gambar gagal | Periksa GET /api/foto pada Network: izin, objek 404/retensi, atau gangguan jaringan. Referensi database bukan bukti objek belum terhapus. |

## Rilis dan verifikasi

Prasyarat: migrasi 214 dan 233 tersedia. Simpan host Contabo di environment target, lalu jalankan `234_wa_staged_media_chat_preview.sql`
secara manual pada target yang benar, lalu deploy SHA patch dan refresh percakapan.
234 bersifat forward dan idempotent; status deployment/migrasi produksi masih
**Pending** sampai ada hasil apply dan pengujian perangkat nyata.

Pengujian lokal: **1.779 tes / 156 file lulus**, **22 kelompok kontrak PostgreSQL**
lulus, lint/typecheck/check:migrations/build lulus; adapter self-host 14/14 lulus. Uji SQL mereproduksi preview
staging yang hilang sebelum 234, backfill dua kali, promosi bukti, rollback atomik,
penolakan URL luar, exact message/phone link dan perlindungan lampiran manual.
Uji handler mencakup preview sebelum AI, AI timeout, dan foto nonpembayaran.
Uji render mencakup foto sementara, PDF, URL tidak valid dan proxy saat CDN publik aktif.
Uji unduhan mereproduksi 302 ke Contabo, menolak tujuan tanpa whitelist/downgrade
HTTP/credential/host tiruan, membatasi loop redirect, serta menyaring kode TLS tanpa
mencetak URL rahasia.

Untuk menerima hasil live: kirim satu foto uji masuk, cari WA_MEDIA_STORED dan
chat_preview_linked=true; cocokkan dengan query diagnostik serta buka objek dari
AClean. Dokumen ini tidak menyatakan objek pelanggan tertentu sudah diperiksa.


## Bukti runtime Owner — 10 November 2026, 12.00 WIB

Screenshot runtime produksi yang dikirim Owner menunjukkan satu gambar masuk
melalui route/selected_provider whacenter: type=image, media_url_allowed=true,
status=MEDIA_QUEUED. Pada 05:00:19 UTC (12:00:19 WIB), WA_MEDIA_STORED mencatat
r2_reference_saved=true, chat_preview_linked=true, storage_area=wa-staging.
Log berikutnya menunjukkan Vision mulai dipanggil, belum hasil klasifikasi.

Ini bukti pemulihan unduhan → staging R2 → penautan chat untuk gambar uji tersebut.
Pembacaan objek/preview browser dan hasil AI belum ditunjukkan pada screenshot;
apply migrasi 234 dan SHA image belum diaudit langsung lewat database/container.
Catatan ini berasal dari bukti Owner, tanpa nomor pengirim, URL atau token.
