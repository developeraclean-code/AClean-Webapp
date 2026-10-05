# WhatsApp Workspace AClean

Buka tombol **WhatsApp** dari dashboard/sidebar (Owner/Admin, pengaturan `wa_monitor_enabled` aktif).

- Desktop: panel maksimal 1280 px, dengan daftar chat, percakapan, dan ringkasan pelanggan. Tombol ↗ memperbesar panel hingga memenuhi layar.
- Layar lebih kecil: ringkasan dapat dibuka melalui **Aksi pelanggan**. Di HP, tombol kembali menampilkan daftar chat.
- Cari nama, nomor, atau cuplikan pesan dari percakapan yang dimuat. Filter **Belum dibaca** dan **Baru** membantu memilah kontak.
- Riwayat dimulai dari 100 pesan terbaru; **Muat pesan sebelumnya** menambah riwayat. Percakapan aktif diperbarui setiap 15 detik saat tab terlihat.
- Draf terpisah per nomor selama sesi panel. Balasan cepat menambahkan teks ke draf; pesan baru dikirim lewat **Kirim** atau Enter di desktop. Shift+Enter membuat baris baru. Di HP, Enter selalu membuat baris baru.
- Jika nomor memiliki beberapa lokasi pelanggan, pilih lokasi sebelum membuat jadwal/reorder atau melihat tagihan.
- **Buat jadwal** dan **Reorder** membuka pop-up planning di atas percakapan. Pilih tanggal, Team opsional, serta jam mulai–selesai; klik **Simpan planning** untuk membuat job. Default status **PENDING**; pelanggan dapat ditandai terkonfirmasi tanpa menunggu anggota tim. Setelah disimpan, **Lihat di Jadwal** membuka kalender mingguan per Team pada minggu pekerjaan. Tidak ada dispatch otomatis. Rincian alur, roster harian, dan reschedule: [Jadwal Team](TEAM_SCHEDULING.md).
- Panel pembayaran menampilkan sisa invoice UNPAID, OVERDUE, dan PARTIAL_PAID. Draf pengingat memakai sisa tagihan, bukan nominal awal. Bukti pembayaran dapat diverifikasi melalui tab **Verifikasi bayar**.

## Lima peningkatan operasional

1. **Tindak lanjut bersama.** Status, pengingat WIB, penanggung jawab, dan catatan internal tersimpan di database. Filter **Belum selesai** dan **Jatuh follow-up** membantu prioritas. Perubahan admin lain menolak penyimpanan versi lama sehingga catatan tidak tertimpa diam-diam. Pesan pelanggan yang masuk membuka kembali tindak lanjut berstatus selesai atau menunggu pelanggan.
2. **Slot jadwal.** Membaca order dan ketersediaan teknisi pada tanggal pilihan, memperhitungkan durasi, teknisi pendamping, ketidakhadiran, dan benturan waktu. Slot diperiksa ulang sebelum membuat draf penawaran atau membuka pop-up planning dengan Team, tanggal, dan jam terisi. Rekomendasi berbasis Team mengikuti preset dan roster tanggal pilihan. Pekerjaan tanpa tim tetap tercatat; ketersediaan anggota perlu diperiksa saat roster diisi atau diubah.
3. **Alokasi bukti bayar.** Pilih bukti, periksa nominal/metode, lalu pilih invoice dari nomor yang sama; nama lokasi selalu ditampilkan. Pembayaran parsial dan satu transfer untuk beberapa invoice didukung. Alokasi otomatis mendahulukan jatuh tempo. Konfirmasi mencatat pembayaran, memperbarui saldo/status, dan menyelesaikan suggestion dalam satu transaksi. Koreksi nominal memerlukan catatan. Retry memakai ID transaksi yang sama; perubahan formulir dikunci selama hasil transaksi belum diketahui.
4. **Pengiriman tercatat dan PDF.** Pesan, PDF invoice yang disetujui, dan laporan terverifikasi menggunakan catatan pengiriman di server. Status dibedakan menjadi sedang diproses, diterima gateway, gagal, dan belum pasti. Permintaan dengan ID yang sama tidak mengirim ulang. Timeout tidak memicu retry otomatis atau fallback attachment yang berisiko menggandakan pesan. Riwayat menampilkan waktu, pelaku, dokumen, dan hasil gateway.
5. **Servis berkala.** Rekomendasi berdasarkan pekerjaan Cleaning/Maintenance yang sudah COMPLETED/PAID, minimal 90 hari sebelumnya, tanpa order aktif pada lokasi tersebut. Draf reminder mempertahankan penanda pelanggan saat berpindah chat. Pengiriman manual dan cron berbagi cooldown 30 hari; status belum pasti juga menahan pengiriman berikutnya. Penanda kontak otomatis lama (`last_rating_request`) ikut dihormati.

Riwayat pengiriman yang masih `SENDING` atau `UNCERTAIN` perlu diperiksa terhadap gateway sebelum tindakan manual berikutnya. Tidak ada klaim bahwa pesan telah diterima perangkat atau dibaca pelanggan. Jika gateway menerima pesan tetapi penyimpanan hasil gagal, catatan tetap tertahan untuk pemeriksaan, tanpa mengirim ulang otomatis.

Data pelanggan, order, invoice, dan bukti bayar berasal dari data yang sudah dimuat aplikasi. Invoice menggunakan koleksi gabungan yang mencakup invoice outstanding. Ini bukan sinkronisasi seluruh riwayat WhatsApp Web. Pengiriman media baru, panggilan, dan tanda pesan dibaca penerima belum tersedia. Status pengiriman sukses berarti gateway menerima permintaan, bukan konfirmasi pesan telah dibaca.

## Pemeriksaan

### Preview lokal terpisah

```sh
npm run preview:wa
```

Buka **http://127.0.0.1:4174**. Server ini terpisah dari aplikasi utama, tidak membaca `.env.local`, tidak memerlukan login, dan tidak memakai koneksi Supabase/Fonnte. Seluruh data memakai memori browser. Jadwal/reorder membuka pop-up planning yang sama dengan aplikasi utama, dengan penyimpanan database tiruan. Klik **Simpan planning → Lihat di Jadwal** untuk melihat job pada kalender Team. Tombol **Planning Order** tetap membuka pengelolaan roster/form lama. Pembayaran dan riwayat pengiriman juga hanya mengubah data demo. Coba **Andi** untuk beberapa lokasi dan alokasi pembayaran, atau **Maya** untuk reminder servis. **Reset demo** mengembalikan data awal. Tutup panel untuk mengakses opsi simulasi pengiriman gagal.

Edit `src/views/WaPanel.jsx` / `src/views/WaPanel.css`, kemudian refresh browser untuk melihat perubahan. Tekan Ctrl+C di terminal untuk menghentikan server. Port dapat diubah dengan `WA_PREVIEW_PORT=4175 npm run preview:wa`.

Jika Node dari nvm menampilkan `Bad CPU type in executable` pada Mac ini, gunakan Node universal yang tersedia:

```sh
/usr/local/bin/node scripts/preview-wa-workspace.mjs
```

### Pengujian otomatis

```sh
npm run build
npm run lint
npm test
npx playwright test -c e2e/wa-workspace.config.js
```

Suite browser terisolasi memakai fixture dan gateway tiruan; tidak memerlukan login atau mengirim pesan ke pelanggan. Mencakup pemilihan lokasi, reorder, respons terlambat, draf per nomor, konflik tindak lanjut, pemeriksaan ulang jadwal, retry pembayaran, PDF, cooldown reminder, hasil pengiriman belum pasti, dan tata letak HP.

Pengujian transaksi SQL terpisah memakai PostgreSQL/WASM (PGlite 0.5.8). Dependency ini dipasang di direktori sementara, tidak ditambahkan ke aplikasi:

```sh
npm install --prefix /private/tmp/aclean-wa-dbcheck --no-save @electric-sql/pglite@0.5.8
WA_PGLITE_MODULE=/private/tmp/aclean-wa-dbcheck/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-wa-workspace-db.mjs
```

Script membangun schema pendukung minimal, memuat fungsi asli migrasi 170/171/173 serta migrasi 193, kemudian menguji transaksi, rollback, duplikasi bukti, batas saldo, pembatasan role/RLS, versi tindak lanjut, pencatatan dokumen, dan cooldown manual/cron. Script tidak membaca environment Supabase atau mengakses database produksi. Ini belum menguji race antar-koneksi pada Supabase sebenarnya.

Hasil verifikasi lokal setelah pembaruan Jadwal Team, 5 Oktober 2026:

- 811 test dalam 87 file Vitest lulus pada salinan commit WA/Jadwal (perubahan Mode Darurat terpisah tidak disertakan).
- 24 test browser WhatsApp/Planning lulus, termasuk desktop/HP, pop-up, preset yang bertambah, anggota per hari, absensi, reschedule, konflik admin, kegagalan jaringan, grid sampai 19:00, navigasi hari lintas minggu, dan planning malam dari WA yang tetap terlihat di Planning Order.
- 13 kelompok kontrak SQL WhatsApp dan 13 kelompok kontrak SQL planning lulus dengan PostgreSQL/WASM.
- Build produksi, lint `src`, typecheck, pemeriksaan sintaks backend, dan `git diff --check` lulus.
- Smoke test preview localhost lulus: navigasi reorder, kirim berhasil/gagal, slot jadwal, alokasi pembayaran, reset; tanpa error JavaScript atau permintaan jaringan eksternal.
- Pemeriksaan nomor migrasi tidak menemukan duplikasi baru; gap lama 024 dan 091 masih dilaporkan.

## Penerapan ke lingkungan nyata

Migrasi **193 dan 194 sudah diterapkan pada produksi pada 5 Oktober 2026 (WIB)** dan dicatat dalam `supabase_migrations.schema_migrations`. Uji transaksi pada schema produksi sebelum/sesudah migrasi lulus dengan rollback: planning Owner/Admin, penolakan Teknisi/RLS, benturan slot, retry, reschedule, pembatalan, pembayaran parsial, serta finalisasi outbox dan audit dokumen. Tidak ada pesan Fonnte yang dikirim atau data uji yang dipertahankan. Frontend/backend dipublikasikan melalui commit rilis ini. Urutan untuk lingkungan lain:

1. Pastikan lingkungan tujuan sudah memiliki schema/fungsi sebelumnya, khususnya `record_invoice_wa_sent`, `record_report_card_wa_sent` (170/171), pembayaran atomik (173), tabel WhatsApp/payment suggestions, dan `customers.last_rating_request` (031).
2. Terapkan `migrations/193_whatsapp_workspace.sql` dan `migrations/194_team_schedule_planning.sql` melalui mekanisme migrasi AClean. Prasyarat migrasi 194 dan batas pengujian tercantum di [TEAM_SCHEDULING.md](TEAM_SCHEDULING.md). Migrasi menambah `wa_followups`, `wa_outbox`, `wa_payment_receipts`, RLS, RPC, dan trigger pembukaan kembali follow-up. Jangan menjalankannya dua kali secara manual.
3. Setelah migrasi berhasil, deploy backend, cron, dan frontend bersama. Route `/api/wa-workspace-send` memerlukan autentikasi Owner/Admin dan konfigurasi Supabase/Fonnte server yang sudah digunakan aplikasi. Jika penyimpanan pengiriman belum tersedia, cron melewati reminder terkait dan mencatat kegagalan.
4. Di staging, uji akun Owner/Admin dan akun yang ditolak, satu nomor uji yang disetujui, PDF invoice/laporan, pembayaran parsial, dua admin bersamaan, serta reminder manual/cron. Pastikan status gateway dan audit database sesuai.

Schema produksi dan transaksi inti sudah diuji. Pengiriman Fonnte nyata, upload PDF, dan race lintas koneksi/jalur lama masih perlu uji terkontrol. Preview lokal tetap simulasi. Outbox memakai UUID permintaan dan menyimpan ID pesan bigint yang dibuat database; retry finalisasi tidak membuat pesan/audit ganda. Bukti bayar ditautkan ke ledger melalui catatan suggestion dan receipt alokasi, tanpa mengandalkan kolom `invoice_payments.payment_id` yang tidak ada.
