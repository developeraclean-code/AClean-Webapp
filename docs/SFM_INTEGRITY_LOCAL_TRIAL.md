# SFM Integrity — Local Trial

Dokumen ini menjelaskan gate lokal untuk menguji konsistensi alur operasional
tanpa memakai kuota Supabase, Vercel, Cloudflare R2, atau provider WhatsApp.

## Menjalankan simulasi 100 pekerjaan

```bash
npm run test:sfm-100
```

Simulasi membuat data sintetis untuk 100 pekerjaan, laporan, invoice,
pembayaran, dan slot jadwal. Tidak ada data pelanggan produksi yang dibaca atau
ditulis. `fetch` diganti dengan network guard; test langsung gagal jika kode
mencoba melakukan request eksternal.

Selain audit keadaan akhir, simulator menjalankan lifecycle 100 job dan sengaja
menyisipkan kegagalan di tengah pembuatan order, submit laporan, pembuatan
invoice, dan pembayaran. Setiap kegagalan harus rollback bersih sebelum operasi
diulang.

## Cakupan audit

- relasi order, laporan, invoice, pembayaran, dan jadwal;
- status order dan invoice yang tidak valid;
- laporan ganda atau data tanpa induk;
- order selesai yang masih mempunyai slot aktif;
- invoice PAID yang tidak mempunyai ledger pembayaran;
- aggregate pembayaran invoice yang tertinggal dari ledger;
- self-repair aman dan idempotent.

Self-repair hanya mengubah kondisi yang dapat dihitung secara deterministik:

- menyelaraskan status order dari bukti laporan/invoice;
- menonaktifkan slot milik order terminal;
- menghitung ulang status dan saldo invoice dari ledger pembayaran.

Kasus ambigu seperti laporan duplikat, data yatim, atau PAID tanpa ledger tidak
diubah otomatis. Kasus tersebut masuk review manual agar sistem tidak mengarang
nominal, menghapus bukti, atau memilih record secara sembarang.

## Gate sebelum deploy

Semua perintah berikut harus lulus:

```bash
npm run test:sfm-100
npm test -- --run
npm run lint
npm run typecheck
npm run build
npm run check:migrations
```

Simulasi ini memvalidasi mesin aturan dan recovery lokal. Ia belum menggantikan
uji integrasi terhadap RPC Supabase. Migration atau RPC baru tetap harus diuji
di environment staging/local PostgreSQL sebelum diaktifkan pada produksi.
Karena itu skor confidence simulator sengaja dibatasi maksimum 95%, bukan 100%.
