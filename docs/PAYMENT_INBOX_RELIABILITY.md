# Bukti bayar WA: operasi 24 jam

Penerimaan webhook dan pengamanan media ke R2 tidak bergantung pada jam kerja,
panel WA Monitor, auto-reply ARA, maupun tab browser admin. Suggestion adalah
kandidat pemeriksaan, **bukan** konfirmasi uang masuk atau pelunasan otomatis.

## Penyaring bukti pembayaran (21 Oktober 2026)

- Pending AI khusus gambar bukti pembayaran berhasil; nominal boleh belum terbaca
  bila gambar jelas merupakan bukti transfer. Foto AC/kerusakan/unit, ulasan Google,
  invoice/quotation, saldo dan transfer gagal/pending bukan bukti pembayaran.
- Invoice terbuka, nama customer, nominal pada invoice, caption pembayaran maupun
  kegagalan lookup tidak boleh mengubah foto nonpembayaran menjadi suggestion.
- AI timeout/jenis dokumen tak pasti tetap dilacak di **Rincian media**, retry maksimal
  tiga kali. Tidak membuat suggestion pembayaran sebelum gambar dikenali sebagai bukti.
- Media ingress dicadangkan dahulu ke `wa-staging/` agar URL Fonnte kedaluwarsa
  tidak menghilangkan bukti tanpa caption. Hanya bukti teridentifikasi disalin ke
  `wa-inbox/` sebelum suggestion disimpan. Nominal/bank/tanggal dan foto bukti tetap
  disimpan untuk pemeriksaan; tidak ada auto-PAID. Nonpembayaran berhenti `IGNORED`,
  tanpa pencarian invoice, salinan arsip bukti, atau pengulangan AI.
- `ops/r2-lifecycle.json` menambah retensi **7 hari hanya untuk prefix baru
  `wa-staging/`**. Konfigurasi lokal tidak mengaktifkan aturan cloud: saat rilis,
  periksa `scripts/apply-r2-lifecycle.mjs` dry-run lalu terapkan dengan persetujuan
  Owner. Tanpa penerapan tersebut, penghapusan staging belum dijamin. Jangan
  memperpendek retensi `wa-inbox/` atau menyentuh objek bisnis lama.
- Fallback luas `wa_image_review` lama yang hanya berisi klasifikasi nonpembayaran
  atau AI gagal disaring dari inbox/modal WA, bukan dihapus dari database.
  Bukti transfer teridentifikasi, termasuk yang lama dan nominal belum terbaca,
  tetap tampil. Riwayat media/RPC health dapat memuat arsip yang kini tersaring;
  tombol Tinjau bukti memakai jumlah daftar pembayaran aktif.
- Foto 404 tidak dipulihkan dengan mengganti prompt. Thumbnail memakai `fotoUrl`,
  lazy loading, serta peringatan unggah ulang yang menetap untuk URL gagal, tanpa
  retry otomatis tiap polling. Pembayaran tidak berubah karena foto tidak tersedia.

Audit read-only 21 Oktober: ada lima fallback berkategori `kerusakan_ac`, 14 dokumen
umum, dan tiga tanpa klasifikasi. Dua URL bukti historis sejak April yang diperiksa
membalas HTTP 404. Ini snapshot, bukan angka hardcoded atau bukti pasti penyebab
penghapusan R2. Tidak ada transaksi/objek produksi diubah pada pemeriksaan ini.

### Penanganan PDF dan audit pemakaian — perubahan lokal 21 Oktober 2026

Audit produksi menemukan empat job PDF dengan `invalid_image_format`: PDF sebelumnya
dikirim sebagai gambar. Perubahan lokal mengirim PDF sebagai `file` pada OpenAI Chat
Completions dan `document` pada Claude. Model/provider yang dipilih tidak berubah;
dukungan model dan hasil ekstraksi tetap perlu diuji dengan permintaan nyata.
Referensi skema: [OpenAI Docs — File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
dan [Claude — PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support).

- Tipe media diperiksa dari signature byte, bukan ekstensi atau Content-Type saja.
  Ini bukan decoder/validator seluruh berkas: PDF rusak/terenkripsi dan gambar rusak
  masih dapat ditolak provider. Batas klasifikasi 10 MB; berkas tak dikenal/kebesaran
  berhenti `FAILED_PERMANENT` untuk penanganan admin, tanpa suggestion atau auto-PAID.
- Respons provider HTTP 400/413/415/422 tidak dikirim ulang dengan byte yang sama.
  Gangguan jaringan, 429 dan 5xx tetap mengikuti retry terbatas yang ada. Media tetap
  terlacak; perubahan kode tidak membuka kembali job gagal historis secara otomatis.
- Webhook dan retry memakai satu pencatat `wa-personal-vision` di helper klasifikasi,
  dengan metadata `stage`, `media_job_id`, `attempt`, dan `usage_known`. Respons sukses
  yang gagal diparse tetap dicatat tokennya. Tidak ada log biaya kedua di webhook.
  Cached OCR/antrean kosong/input yang ditolak sebelum AI bukan pemakaian model baru.
- Logging di-await dengan timeout maksimal 3 detik dan fail-silent. Gangguan database
  tetap dapat menghilangkan log; bukan buku tagihan provider yang dijamin lengkap.
  `usage_known:false` berarti token/biaya tidak diketahui, **bukan** bukti gratis.
- Anggaran dispatcher retry dinaikkan 11→30 detik (minimal sisa waktu 25 detik),
  karena unduh/AI/log/finalisasi tidak cukup ditampung oleh timeout model 9 detik saja.
  Tick yang sudah terlalu akhir menunda ke tick berikutnya, bukan mulai lalu terputus.
  Interval tetap 15 menit, satu media/invocation, lease dan toggle tetap; tanpa kirim WA.
- Verifikasi lokal memakai respons API simulasi, tanpa kuota berbayar atau mutasi
  produksi. Kelulusan tes **bukan akurasi Vision ≥90%**. Perlu dataset foto/PDF nyata
  berlabel dan evaluasi model terpilih sebelum menilai ketepatan nominal/recall.
- Jalur pembayaran grup, material, dan tas teknisi belum disatukan ke classifier
  pembayaran pribadi; hasil pengujian ini tidak mewakili akurasi semua fitur Vision.

### Pembersihan terbatas sesuai persetujuan Owner, 21 Oktober 2026

Batas kandidat: suggestion PENDING bertanggal sebelum **1 Oktober 2026 00.00 WIB**.
Ditemukan 56 referensi berlabel folder `wa-images/bukti_transfer`, semuanya memiliki
nominal tetapi tanpa klasifikasi terstruktur. HEAD seluruh objek: 46 tersedia,
10 sudah 404. OCR lokal (tanpa API AI berbayar), disertai pemeriksaan visual pada
hasil ambigu, menemukan lima nonpembayaran: dua layar pengiriman barang (10 Juli),
foto tagihan (7 Juli), screenshot payroll (27 Juni), dan info saldo (8 September).

Lima objek tersebut dihapus setelah pemeriksaan referensi bukti invoice, ledger,
biaya dan laporan tidak menemukan pemakaian. Lima suggestion menjadi
`DISMISSED/REJECTED`, URL foto dikosongkan, alasan pemeriksaan dan metadata tetap
tersimpan. Bukan penghapusan semua suggestion lama. Snapshot pemulihan terenkripsi
disimpan lokal privat. Lima HEAD setelah delete membalas 404; kelima ID tidak lagi
PENDING. Fingerprint status/nominal/paid_amount/sisa/bukti seluruh invoice sama
sebelum dan sesudah. Foto Oktober tidak disentuh.

Audit retensi produksi pada pemeriksaan ini:

- `payment_proof_cleanup_enabled=true`; dispatcher 10 menit aktif. Dalam tujuh
  hari ada tujuh run `payment-proof-cleanup` SUCCESS, counter `purged=81`, error 0.
  Counter mencakup objek yang sudah tidak ada (DELETE 404 juga dianggap selesai),
  sehingga bukan bukti 81 objek fisik baru terhapus. Run terakhir 21 Oktober
  03.10 WIB: swept/purged 16, error 0, `has_more=false`.
- 865 invoice memiliki sentinel `purged-90d`; tidak ada kandidat PAID lama ber-URL
  `/api/foto` tersisa menurut kondisi cron saat audit. Dua sampel referensi yang
  sudah ditandai purge memang membalas 404. Nominal/status lunas tidak dihapus.
- Cakupan cron hanya invoice **PAID**; umur dihitung dari
  `coalesce(paid_at,created_at)`, **bukan LastModified R2/umur unggahan**. Pending AI
  tidak ikut cleanup ini. Sebelum lima penghapusan di atas masih ada 17 objek
  Pending AI dengan LastModified >90 hari; empat di antaranya termasuk kandidat
  nonpembayaran yang dihapus. Jangan mengklaim semua bukti >90 hari sudah dibersihkan.
- Aturan bucket dalam `ops/r2-lifecycle.json` belum merupakan bukti aturan cloud
  aktif. GET lifecycle S3 masih `403 AccessDenied`; header expiration sampel objek
  juga kosong. Konfigurasi lifecycle produksi belum dapat disertifikasi dengan
  kredensial operasional ini. Tidak ada perubahan scheduler/lifecycle pada audit.

## Pembaruan tampilan

- Owner/Admin mendapat snapshot seluruh suggestion PENDING, dengan pagination
  200 baris per halaman; tidak dipotong menjadi 20 entri.
- Tab terlihat: interval lima menit, sepanjang hari termasuk Minggu. Tab
  tersembunyi: polling dihentikan, kembali terlihat/fokus/online memicu refresh.
- Notifikasi memakai ID yang belum pernah terlihat dalam sesi, bukan umur 125
  detik. Snapshot pertama tidak membanjiri admin dengan notifikasi arsip lama.
- Kegagalan mempertahankan snapshot terakhir dan menampilkan peringatan. Hasil
  kosong yang berhasil benar-benar membersihkan entri yang telah diselesaikan.
- Invoice dan Pending AI mengikuti pembaruan inbox yang sama. Tombol Perbarui
  tersedia untuk pemeriksaan langsung tanpa harus logout/login.
- Banner hanya membawa admin ke pemeriksaan invoice. Tombol Tutup tidak menolak
  bukti atau mengubah statusnya; tidak ada jalur pelunasan langsung dari notifikasi.

## Retry terpisah dari task operasional berat

Migrasi **210** hanya menambah kolom lease dan fungsi antrean/status/scheduler.
Tidak mengubah transaksi historis, invoice, pembayaran, atau status media lama.

Klaim media atomik menggunakan `FOR UPDATE SKIP LOCKED`, token lease, dan masa
lease lima menit. Media baru diberikan waktu dua menit untuk pemrosesan webhook
awal. Media yang belum diamankan dari URL Fonnte didahulukan. Worker lama tidak
dapat menimpa hasil worker pemilik lease yang baru.

Satu media per invocation menjaga beban serverless tetap terbatas. Maksimal tiga
percobaan, jeda retry 15 lalu 30 menit. Lease kedaluwarsa dapat dipulihkan termasuk
crash pada percobaan terakhir; bila file sudah aman tetapi AI gagal, media tetap
tercatat untuk pemeriksaan di Rincian media, bukan diklaim bukti pembayaran.
Upsert tidak membuka kembali CONFIRMED/DISMISSED.

Pemicu utama: Supabase `pg_cron` + `pg_net`, setiap 15 menit, 24 jam. Kunci internal
disimpan di Vault dan dibaca ketika fungsi dispatcher berjalan, bukan ditulis ke
perintah cron, GitHub, frontend, atau output konfigurasi. Pemicu GitHub terpisah
dan tick Vercel menjadi cadangan; jadwal GitHub sendiri tidak dijadikan jaminan
ketepatan interval. Antrean kosong tidak memanggil AI.

Urutan rilis:

1. Jalankan test unit, PostgreSQL/WASM, build, dan smoke UI tanpa data produksi.
2. `scripts/configure-payment-worker.mjs --check` (read-only).
3. Dengan persetujuan Owner, `--migrate` menerapkan hanya migrasi 210 dan
   memeriksa fingerprint invoice, ledger, order, suggestion, dan antrean.
4. Deploy kode yang sesuai dan pastikan endpoint status dapat dibaca Owner/Admin.
5. `--schedule` mengaktifkan pemicu utama setelah backend siap; `pg_net` dipasang
   bila belum tersedia. Script tidak menjalankan worker atau mengirim WA sendiri.
6. Periksa heartbeat worker pada jadwal berikutnya. Kunci yang dirotasi pada
   Vercel juga harus diperbarui di Vault melalui `--schedule`.

Script memakai `pg` sebagai dependensi operasional; `ACLEAN_PG_MODULE` dapat menunjuk
ke instalasi lokal yang sudah tersedia. Koneksi diambil dari `.env.local`, tidak
boleh di-commit atau dicetak. Mode bawaan `--check` tidak mengubah produksi.

## Pemeriksaan admin

Panel **Bukti Pembayaran WA** pada Invoice menampilkan heartbeat retry, jumlah
antrean, media belum aman, kegagalan, dan tautan rincian. Endpoint bersifat
read-only, tanpa cache, hanya Owner/Admin atau server internal. Detail dibatasi
50 baris; jumlah ringkasan tetap exact. Gagal membaca status tidak dianggap sehat.

Worker yang tidak sukses 45 menit atau antrean menunggu lebih dari 30 menit
ditandai. Watchdog harian/petang dapat mengirim alarm hanya ke Owner, dibatasi
sekali per enam jam. Gangguan Supabase/Vercel sendiri tetap memerlukan monitoring
di luar keduanya; mekanisme ini bukan jaminan ketersediaan tanpa batas.

Media lama berstatus FAILED_PERMANENT tidak dihapus/dibuka kembali otomatis.
Periksa arsip WA untuk memastikan apakah benar bukti bayar. Jika file memang
hilang, unggah ulang melalui Lampirkan Bukti pada invoice yang benar. Jangan
mengubah UNPAID hanya karena screenshot ada atau nomor cocok.

## Membaca hasil retry (pembaruan tampilan Oktober 2026)

Status pemicu dan status media dipisahkan. Heartbeat hijau hanya menunjukkan
pemicu retry masih terpantau, bukan semua media berhasil atau invoice sudah lunas.
Panel membaca hasil `cron_runs` terbaru, termasuk FAILED/TIMEOUT/RUNNING, melalui
endpoint read-only yang sama. Hanya status, waktu dan counter yang diizinkan
diteruskan; metadata mentah, pesan error provider dan ID invoice tidak diteruskan.
Watchdog tetap memakai satu RPC lama tanpa query tambahan.

- **Berhasil · antrean retry kosong**: run SUCCESS secara eksplisit melaporkan
  `checked=0` dan `retried=0`. Bukan kegagalan dan tidak memanggil AI untuk retry.
  Run tanpa counter tidak boleh dianggap antrean kosong.
- **Antrean retry**: RECEIVED/STORED/PROCESSING/FAILED_RETRYABLE, termasuk media
  yang belum aman di R2. Waktu retry adalah batas paling awal, bukan SLA selesai.
- **Perlu tinjau admin**: seluruh suggestion PENDING untuk pemeriksaan manual;
  bukan jumlah kegagalan retry dan bukan konfirmasi pelunasan.
- **Gagal otomatis**: FAILED_PERMANENT; tidak diulang otomatis. Jumlah yang baru
  ditandai gagal dalam 24 jam dipisahkan dari riwayat lebih lama.
- Rincian dipisahkan menjadi kategori retry, tinjauan admin dan gagal otomatis.
  Rincian PENDING_REVIEW dari antrean media dapat lebih sedikit daripada seluruh
  Pending AI. Maksimal 50 rincian dimuat; jumlah global tetap dari RPC agregat.
- File historis yang dihentikan manual dapat memiliki `attempts=0`. Tampilkan
  “belum ada percobaan worker tercatat”, bukan klaim sudah gagal tiga percobaan.
- Gagal membaca hasil run tetap menampilkan counter antrean dengan peringatan
  hasil tidak tersedia. Gagal refresh status mempertahankan snapshot lama dan
  menandainya sebagai data tersimpan, bukan status terkini yang sehat.
- **Perbarui status** hanya membaca ulang inbox/status. Tidak memaksa retry,
  memanggil AI Vision, mengirim WA, atau mengubah invoice/pembayaran.

Audit read-only 17 Oktober 2026 pukul 08.13 WIB menemukan antrean aktif 0, media
aktif belum aman 0, dan run terbaru SUCCESS dengan `checked=0/retried=0`.
Sebelas rincian terdiri dari lima file arsip 5 Oktober yang URL sumbernya sudah
404 (belum tersimpan di R2), serta enam PENDING_REVIEW yang sudah tersimpan.
Seluruh Pending AI saat pemeriksaan berjumlah 76. Ini snapshot audit, bukan
angka default yang dipakai aplikasi. File arsip tetap perlu diperiksa manual;
kode tampilan ini tidak memulihkan file 404 atau mengubah status media tersebut.

Pembaruan tampilan hasil retry di atas tidak memerlukan migrasi baru. Penguatan
penerimaan webhook berikutnya **memerlukan migrasi 214 sebelum backend dirilis**;
lihat [WA_INGRESS_RELIABILITY.md](WA_INGRESS_RELIABILITY.md). Preview terisolasi:
`/preview/payment-health/index.html` (data sintetis, tanpa akses API).
Validasi: unit/API `paymentMediaHealth.test.js`, smoke desktop/mobile
`scripts/smoke-payment-health.mjs` dan integrasi Invoice
`scripts/smoke-payment-inbox.mjs`. Semua simulasi memblokir akses produksi,
panggilan AI dan perubahan pembayaran.
