# Bukti WA dan invoice gabungan

Migrasi 206 memisahkan pencocokan otomatis dari verifikasi pembayaran.

- Webhook menyimpan media dan kandidat. Pencocokan invoice hanya boleh
  menghasilkan `PENDING / PENDING`; tidak menempelkan bukti pada invoice,
  mengirim konfirmasi lunas, atau menambah ledger.
- Retro-match mensyaratkan nomor yang sama, nominal sisa tagihan yang tepat,
  serta kandidat yang tidak ambigu. Nomor beda satu digit tidak ditautkan
  otomatis. Bukti yang tidak cocok tetap tersedia untuk pemeriksaan manual.
- `consolidate_invoices_atomic` mengunci dan memeriksa ulang snapshot sumber.
  Invoice baru, pembatalan sumber, hubungan job, dan hubungan kandidat bukti
  disimpan dalam satu transaksi. Retry kumpulan ID sumber yang sama mengembalikan
  hasil pertama, termasuk ketika respons HTTP pertama tidak sampai ke browser.
- Trigger kandidat menelusuri penanda `[Digabung ke ...]`, termasuk beberapa
  penggabungan berturut-turut, agar webhook yang terlambat tetap menuju invoice
  aktif. Rantai hilang/berulang menghasilkan error, bukan salah tautan diam-diam.
- `confirm_invoice_wa_proof_atomic` dipakai oleh Lampirkan Bukti WA dan Pending
  AI pada menu Invoice. Verifikasi kandidat, pelunasan, ledger, dan status job
  bersifat atomik. Satu URL bukti yang sudah dipakai tidak boleh menjadi
  pembayaran lain. Menempelkan bukti ke invoice yang sudah PAID tidak menambah kas.
- WhatsApp Workspace tetap mendukung cicilan/alokasi beberapa invoice melalui
  `apply_wa_payment`; status verifikasi ikut menjadi `LINKED`. Riwayat foto pada
  sumber CANCELLED tanpa pembayaran bukan bukti yang sudah dikonsumsi.

## Batas konsolidasi

Konsolidasi database hanya menerima invoice UNPAID/OVERDUE yang belum memiliki
uang masuk/ledger/DP atau bukti terverifikasi. Invoice quotation, PPh, trade-in,
dan penjualan unit AC memakai **Gabung & Kirim PDF**, tanpa mengganti ID invoice.
Guard ini mencegah hilangnya saldo, metadata pajak, dan hubungan quotation.
Item/nilai sumber yang tidak konsisten wajib dibetulkan sebelum konsolidasi.
Fitur PDF gabungan tidak sama dengan konsolidasi database.

Nominal bukti yang berbeda dari sisa tagihan tidak boleh otomatis melunasi.
Gunakan verifikasi alokasi/cicilan di WhatsApp Workspace, atau koreksi nominal
setelah memeriksa bukti. File yang belum dikenali AI/nomor pengirim berbeda harus
diperiksa dan dikonfirmasi secara eksplisit.

## Pemulihan data lama

Migrasi hanya membuka kembali kandidat yang berstatus CONFIRMED otomatis oleh
`retro-match`, masih `validation_status=PENDING`, tertinggal di invoice sumber
CANCELLED bergabungan, dan tidak mempunyai pembayaran pada sumber/tujuan.
Kandidat diarahkan ke invoice gabungan sebagai PENDING, dan job sumber terkait
diarahkan ke invoice aktif. Tidak ada pelunasan, perubahan nominal, penghapusan
foto, atau penambahan kas. Sumber yang memiliki pembayaran tetap untuk audit
manual, bukan dipulihkan otomatis.

## Pengujian

```sh
npm test -- src/lib/__tests__/invoiceProofMerge.test.js
WA_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-invoice-proof-merge-db.mjs
```

Uji PostgreSQL terisolasi mencakup rollback kegagalan di tengah merge/pelunasan,
retry/idempotensi, 200 job/100 gabungan, webhook terlambat, rantai gabungan,
otorisasi, nominal salah, bukti duplikat, dan lampiran tanpa kas ulang. Script
tersebut tidak membaca `.env` dan tidak menghubungi produksi. Race lintas transaksi
tetap dapat dibatalkan PostgreSQL dengan serialization/deadlock error; caller
harus menampilkan error/retry, tidak melanjutkan mutasi parsial.
