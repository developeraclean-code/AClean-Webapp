# Rilis perbaikan FSM — 15 November 2026

**Production selesai di-deploy, Finished/Healthy pada 19:03:40 WIB.**

- PR aplikasi: [#28](https://github.com/developeraclean-code/AClean-Webapp/pull/28), kandidat staging `28f930a5613a4d55e71ab8383f89559d7dbc8d14`.
- SHA aplikasi production: **`196cfdc1f622bf9dbbdc2443cdc12ebbaa7704fc`**. Tree hasil merge identik dengan kandidat staging yang diuji.
- Draft 238–241 dinomori ulang menjadi **246–249** karena main sudah memiliki voucher 241 dan rilis hingga 245. Migrasi249 adalah dependensi penyimpanan grup tim atomik. Identitas trigger internal 239/240/241 sengaja tetap, bukan penerapan ulang voucher 241.
- Staging menggunakan owner `supabase_admin`; production menggunakan owner `postgres`, sesuai kepemilikan objek aktual. Empat file diterapkan bersama dalam satu transaksi dengan ON_ERROR_STOP dan lock timeout 5 detik.
- Backup terenkripsi R2 terakhir sebelum rollout: snapshot `69d3472c`, 15 November 02:25 WIB, layanan backup sukses dan pemeriksaan restic tanpa error. Tidak ada dump ulang, reset database, atau perubahan data historis oleh migrasi ini.

## Bukti penerimaan

| Pemeriksaan | Hasil |
|---|---|
| CI kandidat | Quality dan E2E lulus; [hasil CI](../deliverables/fsm-fixes-2026-11-15/github-ci.json) |
| Lokal | 1.824 unit test; lint, typecheck, build, check:migrations dan cutover-routes lulus. 23 kelompok PostgreSQL 17.6 lulus, termasuk dua koneksi serentak. [Ringkasan](../deliverables/fsm-fixes-2026-11-15/local-verification.json), [kontrak native](../deliverables/fsm-fixes-2026-11-15/database-tests.log) |
| Data saat migrasi | Jumlah dan fingerprint seluruh baris pada 10 tabel bisnis sama sebelum/sesudah dalam transaksi, di staging dan production. Tidak ada pembayaran direset atau ledger dihapus. [Production](../deliverables/fsm-fixes-2026-11-15/production-migrations.json) |
| Definisi SQL | SHA256 keempat file dan MD5 seluruh 16 fungsi yang diperiksa cocok antara staging dan production; semuanya menolak EXECUTE anonim. Delapan trigger pelindung aktif; FK order→invoice tetap NOT VALID untuk menjaga referensi historis. [Kontrak production](../deliverables/fsm-fixes-2026-11-15/production-database-contracts.json) |
| Otorisasi production | 32 kasus pada 8 kombinasi peran/status aktif aktual lulus, dengan SQL role authenticated. Ini simulasi konteks profil dalam transaksi rollback, bukan login browser semua staf. [Matriks](../deliverables/fsm-fixes-2026-11-15/production-role-matrix.json) |
| Staging nyata | Login Owner fixture, baca order, dan API sesi berhasil. RPC invoice tidak ditemukan/grup kosong menolak sebelum penulisan bisnis; API anonim 401 dan RPC anonim ditolak. [Smoke staging](../deliverables/fsm-fixes-2026-11-15/staging-smoke.json) |
| Production | Image, SOURCE_COMMIT, ACLEAN_BUILD_SHA dan hash tiga helper runtime cocok dengan SHA rilis; container healthy, API anonim 401. [Smoke production](../deliverables/fsm-fixes-2026-11-15/production-smoke.json) |
| HTTPS publik | app.aclean.id dan status.aclean.id: HTML/aset JS/health 200, versi publik 196cfdc. [Endpoint](../deliverables/fsm-fixes-2026-11-15/public-endpoints.json) |
| Operasional | Scheduler target tetap aktif; auto-deploy kedua aplikasi tetap OFF; domain dan rahasia tidak diganti. [Status akhir Coolify](../deliverables/fsm-fixes-2026-11-15/final-status.json) |

Metadata penerapan juga disimpan root-only di VPS pada `/etc/aclean-prod-migration/fsm-20261115-*.json`. Tidak ada token atau kredensial dalam artefak rilis Git.

## Perilaku dan batas

Kebijakan Owner dipertahankan: penerimaan kas/ledger yang tercatat tidak boleh direset. Approval dan grup tim baru hanya mengklaim sukses setelah RPC berhasil. Refresh tab aplikasi lama agar memakai pemanggil atomik yang baru; jangan menerapkan ulang draft 238–241 atau redeploy hanya karena ada commit dokumentasi setelah SHA aplikasi ini.

Penghapusan laporan yang sudah memiliki dependensi invoice/stok ditolak sampai tersedia alur pembatalan khusus. Riwayat orphan tidak dibersihkan otomatis dan FK historis belum divalidasi. Global lock stok 5 detik adalah pilihan konsistensi; throughput produksi belum dibenchmark. Pada PostgREST self-host saat uji, SQLSTATE P0002 untuk invoice tidak ditemukan menjadi HTTP 500, tetap error yang diteruskan ke UI dan bukan sukses palsu.

Penerimaan ini mencakup empat area perbaikan yang diminta, bukan seluruh temuan audit FSM. Kontrak mutasi normal/kegagalan/race diuji pada database sintetis dengan metadata nyata dan trigger terpilih. Belum ada matriks mutasi browser semua staf, pengiriman WhatsApp nyata, uji beban production, atau sertifikasi seluruh kombinasi deposit/withholding/grouping pada graph trigger penuh staging. Kontrol browser lokal tidak tersedia pada rollout ini. Skor audit baseline 62/100 tidak otomatis berubah menjadi skor baru.

Rollback aplikasi tidak membatalkan migrasi maupun pelindung pembayaran. Prioritaskan perbaikan forward; jangan memulihkan fungsi stok read-then-set atau mereset saldo pembayaran.
