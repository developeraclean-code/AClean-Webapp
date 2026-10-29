# Migrasi produksi AClean — status 29 Oktober 2026

Status: **cutover teknis live di VPS, penerimaan bisnis masih terbatas**. `app.aclean.id` melayani web/API Coolify produksi; `sb.aclean.id` melayani Supabase VPS. Proyek web Vercel lama dipause dan scheduler VPS tunggal aktif. Proyek Supabase managed **jangan dihapus**: website perusahaan `aclean.id` terpisah masih menggunakannya. Uji transaksi nyata, seluruh peran, dan callback Fonnte nyata belum dinyatakan lulus.

## Perbaikan izin view Finance 29 Oktober sekitar 11.45 WIB

- Audit baca-saja menemukan `public.finance_cash_events` di database VPS dapat dibaca oleh `anon` dan `authenticated`, bertentangan dengan `migrations/212_reviewed_payment_withholding.sql`. View memuat nama pelanggan dan angka pembayaran. Probe `HEAD` anonim melalui `sb.aclean.id/rest/v1/finance_cash_events?select=id&limit=1` merespons **200**; probe SQL anonim membuktikan ada setidaknya satu baris. Isi baris tidak diambil.
- Atas persetujuan Owner, satu transaksi produksi mencabut seluruh privilege view tersebut dari `PUBLIC`, `anon`, dan `authenticated`; assertion dalam transaksi memastikan keduanya tidak lagi punya `SELECT` dan `service_role` tetap punya `SELECT`. Transaksi **COMMIT**. Probe HTTP anonim setelahnya **401**.
- Fungsi `get_finance_summary_v2()` tetap berhasil dalam transaksi `READ ONLY` dengan peran `authenticated` dan UID Owner aktif; `get_my_role()` mengembalikan `Owner`. Tidak ada payload Finance dicetak dan tidak ada data bisnis diubah. View `lab_team_directory` tidak diubah: akses anonim sebelumnya **401** dan proyeksi pengguna aktifnya sengaja terbatas. Dua warning Advisor tidak boleh disamakan dengan dua eksploitasi.
- Migrasi forward `225_restore_finance_view_access_guard.sql` lulus uji produksi dengan rollback, lalu diterapkan dan COMMIT. Probe REST anonim sesudahnya tetap **401**; ACL dibaca ulang sebagai `anon=false`, `authenticated=false`, `service_role=true`. Migrasi hanya mengubah privilege dan tidak mengubah baris bisnis.
- **Risiko sisa:** penyebab ACL produksi menyimpang dari migrasi belum terbukti; restore berikutnya harus menegakkan ulang revoke sebelum REST gateway dibuka. Uji browser Finance/peran staf setelah perubahan masih perlu. Catatan operasional tanpa secret ada di `docs/PRODUCTION_FINANCE_VIEW_ACCESS_2026-10-29.md`.

## Temuan 29 Oktober 11.18 WIB — submit laporan staf terblokir guard profil

- Screenshot staf memperlihatkan `Only your own status may be changed` pada submit job `WA-1793242965084`. Pemeriksaan SSH ke `aclean-live-db` menggunakan transaksi `READ ONLY` mengonfirmasi definisi live `submit_service_report_atomic` memperbarui status seluruh `assigned_members` atau teknisi/helper utama; trigger aktif `trg_guard_staff_profile_update` menolak update profil selain `auth.uid()` untuk staf. Keduanya berbenturan pada laporan dengan beberapa anggota tim, termasuk saat nilai status sudah `active`.
- Order tersebut masih `CONFIRMED`, ditugaskan kepada Mulyadi dan Aris; query `service_reports` untuk job ini mengembalikan nol baris. Kedua profil aktif. Error trigger membatalkan transaksi submit atomik, sehingga laporan dan perubahan status order tidak tersimpan dari percobaan tersebut. Akun pengirim spesifik tidak dibuktikan dari screenshot; tidak melakukan replay submit atau mutasi untuk diagnosis.
- Sumber kode sesuai definisi live: `migrations/201_report_access_all_assigned_crew.sql` (update status kru di RPC), `ops/supabase/forward/20261028162001_production_access_guard.sql` (guard profil), `src/lib/submitLaporan.js` (pesan kegagalan RPC). Patch lokal `migrations/223_field_report_accountability_lock.sql` kini membatasi satu pengirim awal per job, mengunci laporan `SUBMITTED`, membuka koreksi hanya untuk pengirim awal setelah `REVISION`, serta melepas status kru lewat scope transaksi sempit tanpa membuka UPDATE profil langsung. Uji PostgreSQL/WASM sintetis enam skenario, 1.643 Vitest, lint, typecheck, build, dan pemeriksaan migrasi lulus. Patch belum diterapkan ke produksi, belum dideploy, dan job nyata tidak direplay.

## Checkpoint 29 Oktober 07.46 WIB — domain produksi dan scheduler VPS aktif

- Owner menghentikan resource maintenance Coolify; pemeriksaan Docker menunjukkan hanya container `aclean-web-production` untuk aplikasi pada route itu, healthy. Setelah owner mengonfirmasi URL webhook Fonnte baru tersimpan, proyek Vercel web lama `a-clean-webapp` dipause secara spesifik. `status.aclean.id` merespons **503**; `app.aclean.id/api/health` **200** dengan build `5834dc3`, DB/Auth/Fonnte/AI OK; `aclean.id` **200** dan `www.aclean.id` redirect **308**. TLS pada domain yang diuji valid. Tidak mengubah apex/www atau proyek website perusahaan.
- Vercel Cron Jobs telah dinyatakan Disabled oleh owner, dua workflow bisnis GitHub OFF, dan `pg_cron` sumber aktif **0**. Timer target `aclean-production-tick.timer` diaktifkan hanya setelah guard membuktikan web Vercel lama 503 dan health build target cocok. Timer setiap 5 menit; tick pertama 05.50 WIB dan beberapa tick berikutnya sampai 07.45 WIB selesai dengan `Result=success`, status 200 dari handler. Marker root-only `/etc/aclean-prod-migration/cutover-activated.json` membatasi build yang boleh dijalankan. Ini bukan bukti setiap pekerjaan bisnis internal melakukan efek yang diharapkan.
- Browser publik Owner baca-saja login dan Dashboard → Customer → Order Masuk → Invoice → Finance → Dashboard **PASS**; nol error JS, nol dependency 5xx, nol request sumber lama, lima mutasi diblokir harness. Webhook dengan token diuji memakai **receipt sintetis yang sengaja diabaikan**, bukan kiriman Fonnte nyata; tidak ada data pelanggan ditulis. Callback Fonnte nyata belum teramati.
- Rekonsiliasi ulang TLS sumber ↔ VPS sesudah browser: 25 profil, 551 pembayaran, 1.547 customer, 3.054 order, 2.909 invoice, 3.000 laporan sama jumlah dan fingerprint; Auth 26 sama isi kecuali timestamp `updated_at`/`last_sign_in_at` akibat login target. `pg_cron` sumber tetap 0. Ini tidak membuktikan secara matematis semua penulis eksternal sudah berhenti; pernyataan freeze staf dan pemindahan Fonnte bersumber dari konfirmasi owner.
- Backup produksi harian terenkripsi ke bucket R2 migrasi privat dipasang untuk pukul 02.15 WIB (+ acak 0–15 menit), tanpa catch-up saat host mati. Backup pertama snapshot **`b37533a1`** sukses 05.49 WIB; mencakup pg_dump kustom, global roles, pgsodium root key, konfigurasi Supabase/gateway, Storage lokal/Functions, serta core secret/key backup aplikasi. `restic check --read-data` membaca ulang 18/18 pack, tanpa error. Password restic sudah disimpan owner di luar VPS. Bucket media legacy `aclean-files` yang tersendiri **tidak** termasuk backup ini. Restore lintas-VPS dan uji beban 48 jam ditunda sesuai keputusan owner, bukan lulus.
- **Klasifikasi:** route dan integrasi inti sudah live; belum klaim 95%/siap tanpa pengawasan. Sebelum menganggap seluruh bisnis selesai: transaksi fiktif/terkendali lewat domain publik (order→invoice→media→pembayaran), login role staf nyata, satu pesan Fonnte uji nyata, pemeriksaan log/backup harian berikutnya, dan rencana delta rollback setelah penulisan baru. Jangan restart source Vercel atau cron lama bersamaan dengan target. Jangan menghapus Supabase managed selama website perusahaan masih membacanya.

Checkpoint di bawah adalah riwayat sebelum cutover teknis, bukan status terkini.

## Checkpoint 29 Oktober 05.25 WIB — route baru aktif, webhook/sumber lama belum dialihkan

- Owner mengonfirmasi Vercel Cron Jobs proyek web lama **Disabled**. GitHub dua workflow bisnis dan cron DB sumber sudah OFF. Rekonsiliasi baca-saja 05.12 WIB: enam tabel bisnis sama fingerprint/jumlah (25 profil, 551 pembayaran invoice, 1.547 customer, 3.054 order, 2.909 invoice, 3.000 laporan); Auth 26 akun sama isi, kecuali `updated_at` dan `last_sign_in_at` karena login uji target. Ini belum membuktikan tab lama/webhook Fonnte berhenti menulis.
- Gateway `sb.aclean.id` dialihkan dari rehearsal ke Caddy API produksi: TLS valid, `/auth/v1/health` 200 dengan anon key, baca customer anonim kosong, root/Studio/Functions 404, DB/Studio tetap di jaringan privat dan tanpa port host.
- Resource `aclean-web-production` telah menerima 27 env utama/preview0; OpenAI/Anthropic runtime dan kunci backup aplikasi baru ditambahkan tanpa nilai di log. Kunci backup baru tersimpan root-only dan snapshot restic R2 `8ff810ef` lulus read-back byte-for-byte. Owner men-deploy commit `5834dc3` lewat UI; deploy terbaru Finished/Healthy, domain `app.aclean.id` 200, `/api/health` 200 dengan Database/Auth/Fonnte/AI OK. Cron anonim 401 dan webhook POST tanpa secret 401. Ini bukan bukti callback Fonnte nyata sudah dialihkan.
- Domain Coolify metadata maintenance sudah kosong dan domain aplikasi baru terpasang. Namun container maintenance **masih berjalan dengan label route lama yang sama**; API Stop ditolak 403, sehingga owner diminta klik **Stop** di UI. Belum boleh menganggap route stabil sampai container itu berhenti dan aplikasi tetap 200.
- Scheduler target systemd sudah terpasang root-owned tetapi **disabled/inactive**. Webhook Fonnte masih harus dialihkan ke URL baru yang dicetak hanya pada Terminal owner. Proyek Vercel lama masih harus dipause setelah webhook berpindah, untuk mencegah penulis ganda. Belum membuka transaksi staf.

Checkpoint di bawah adalah riwayat sebelumnya, bukan status terkini.

## Checkpoint 29 Oktober 00.10 WIB — build dan uji media lulus, belum cutover

Owner menyetujui patch media dan push hanya cabang `staging`. Commit
**`5834dc3eb169c491b77a6b6d10f55ecd9db1d465`** sudah dipush dari worktree
terpisah, lalu di-deploy owner melalui UI Coolify. Deployment
`ghk97qpraytdqanjvupqmg1f` Finished pada **00.03 WIB, 29 Oktober**. Tidak
memerlukan klik Deploy lagi untuk patch ini. Main dan perubahan lokal user
tidak di-commit/push. Detail kontrak patch: worktree terpisah
`/private/tmp/aclean-media-forward.fLmw90N5/docs/SELF_HOSTED_MEDIA_AUTH.md`.

- App `aclean-web-production` running:healthy, commit5834dc3, domain **null**,
  23 env utama/preview0. Flag runtime `ACLEAN_MEDIA_AUTH_REQUIRED=true`
  memperluas guard dari bucket staging ke API media produksi. Secret tetap
  server-only. Tes lokal patch: **1672 Vitest, 12 selfhost, lint/typecheck/build PASS**.
- Health runtime build baru: Database/Auth/Fonnte **OK**; AI **not_configured**.
  Status Fonnte ini validasi token baca-saja, bukan bukti webhook sudah pindah
  atau pesan bisnis berhasil dikirim.
- Browser Owner dengan akun nyata melalui tunnel privat menuju build baru
  dan endpoint HTTPS `sb.aclean.id`: Dashboard → Customer → Order Masuk →
  Invoice → Finance → Dashboard **PASS**, 0 error JS, 0 dependency5xx,
  5 request mutasi dicegah harness. Tidak ada panggilan source lama. Ini bukan
  tes alur tulis atau seluruh peran, dan bukan tes route publik app final.
- Audit media API build baru: anonim dan cookie invalid401; Owner/Admin
  boleh foto/invoice; Finance hanya invoice; Teknisi/Helper hanya laporan
  order yang ditugaskan, bukan invoice/order lain. Klaim Owner palsu pada UID
  staf tetap ditolak; profil nonaktif403. Untuk key fiktif yang diizinkan,
  respons404 menunjukkan lolos otorisasi, **bukan** file berhasil diunduh.
  Satu media nyata Owner **200/123074 byte**, cache private/no-store; media
  yang sama anonim401. Audit staf memakai kapabilitas server 120 detik,
  bukan membaca password atau menguji login Auth staf. Tidak mengubah baris
  bisnis, objek R2, atau public access bucket. **URL R2 legacy tetap publik**;
  guard API bukan penghapusan akses langsung URL lama. Prefix workflow lain
  perlu tes kompatibilitas; jangan klaim semua media/alur bisnis sudah lulus.
- Gateway Supabase sementara hanya mengizinkan IP uji, Auth/login dan rute
  baca yang ditentukan; mutasi bisnis serta root/Studio503. Spoof XFF dari
  peer tidak dipercaya dan melalui Traefik tanpa NAT diuji ditolak503.
  Network final tetap internal, tidak ada port DB host, cron target0.
- Rekonsiliasi setelah login Owner: enam tabel bisnis dan isi Auth cocok
  terhadap sumber; Auth `updated_at`/`last_sign_in_at` berbeda setelah login
  dan dicatat eksplisit. Ini bukti titik-waktu, bukan bukti semua writer lama
  berhenti. Jangan mengambil dump baru berulang tanpa keputusan kebutuhan.
- Pemeriksaan 00.10 WIB: **app publik503 maintenance**, sbroot503/health200,
  staging401 Basic Auth. Maintenance tidak dipindah, token deploy403 tidak
  dilewati. VPS tersedia sekitar3,8GB RAM/52GB disk saat pemeriksaan awal;
  bukan sertifikasi kapasitas produksi.

Bukti root-only baru di `/etc/aclean-prod-migration/`:
`production-media-access-verified.json`, `production-runtime-media-patch-verified.json`,
`production-test-gateway.json`, `production-source-reconciliation-post-browser.json`.
Report runtime lama16948e1 tetap historis; hasil media patch ini menggantikannya.

**Sisa urutan cutover esensial, NO-GO sampai selesai:**

1. Buktikan freeze writer lama termasuk Vercel Cron/webhook/in-flight, lalu
   pastikan konsistensi snapshot yang sudah direstore. GitHub dan pg_cron
   sudah OFF; pernyataan owner freeze tetap perlu verifikasi teknis.
2. Lengkapi integrasi yang dipakai operasional (AI belum ada, callback Fonnte
   masih perlu dialihkan dengan secret baru), konfigurasi backup aplikasi
   dan rollback termasuk delta setelah target menerima transaksi. Tentukan
   satu scheduler target; jangan aktifkan cron yang masih merujuk Vercel lama.
3. Buka rute API target sesuai scope produksi, pindahkan domain dari resource
   maintenance ke app bisnis lewat Coolify, lakukan deploy UI bila diperlukan,
   uji login/baca/tulis terkontrol melalui domain publik, baru buka operasional.

Belum melakukan langkah pembukaan transaksi. Jangan menghapus source managed:
apex/www perusahaan masih menggunakannya. Uji lintas-VPS dan48jam ditunda
owner dan **bukan** gerbang yang diminta ulang. Tidak menerbitkan angka95%
atau menyatakan live hanya karena build hijau. Seluruh checkpoint di bawah
bersifat historis; angka env/deploy/domain di sana bukan keadaan terkini.

## Checkpoint historis 23.28 WIB — target final berhasil direstore dan diamankan, belum release

SSH pulih setelah owner memuat key. Master koneksi baru diverifikasi; jangan
meminta ssh-add lagi berdasarkan checkpoint kedaluwarsa di bawah tanpa tes.
Tidak ada dump DB baru: memakai snapshot **`a95a23cb`** yang sudah tersedia.

- Restore bersih benar-benar dijalankan pada **`aclean-production`**, direktori
  `/home/ubuntu/supabase-production`, container `aclean-live-*`. Bukan kandidat
  gladi dan bukan lab. Roles/schema/data masuk satu transaksi setelah migrasi
  internal Auth/Storage; trigger impor dinonaktifkan sesuai runbook resmi.
  **138 tabel COPY cocok jumlah baris dan fingerprint** terhadap snapshot.
  Hasil: **3.054 order, 2.909 invoice, 1.547 customer, 26 Auth, 65 metadata Storage**.
  Parser awal tidak mengenali identifier berpetik dan berhenti **sebelum**
  container dibuat; parser diperbaiki, lima unit test lulus, baru restore sukses.
  Tidak ada reset stack atau dump ulang untuk mengatasi masalah parser.
- Empat Vault diekspor baca-saja dengan TLS lalu dibackup terenkripsi sebagai
  **`2c03b520`**; source tidak diubah. Keempat nilai dipulihkan dengan client
  COPY stdin (bukan server file read), cocok4/4; satu profil terenkripsi legacy
  terdekripsi1/1 tanpa nilai dicetak. Tidak ada secret Vault di Git/chat.
- Backup Storage terbaru **`8b4900e4`** lulus download/checksum/integritas R2.
  Sebanyak **65 file / 5.397.173 byte** dipulihkan memakai REST Storage melalui
  IP Docker privat, kemudian diunduh ulang dan SHA256 sama65/65. Bucket `fotos`
  kosong. Keyset dan ID metadata tetap sama. API update memperbarui metadata
  file, sehingga fingerprint Storage pasca-upload tidak diklaim identik mentah
  dengan dump. Ini bukan penyalinan bucket R2 produksi `aclean-files`4,83GB;
  objek R2 tersebut tidak ditulis/dihapus.
- Sembilan layanan inti final healthy; network **internal**, **0 published
  host ports**, cron launchOFF dan0cronaktif. SMTP/Functions/pooler belum
  diaktifkan. `sb.aclean.id` masih gateway **maintenance**, bukan API terbuka.
- Forward migration dibuat melalui CLI `migration new`, diarsipkan sebagai
  `forward/20261028162001_production_access_guard.sql`, lalu applied melalui
  runner yang memeriksa namespace final, snapshot dan isolasi. Guard SQL
  kandidat lama tidak diubah/dilewati. Perbaikan cast order, NULL-role RPC,
  profil aktif, RLS order/customer/laporan/profil, trigger anti-promosi diri
  dan direktori kolom aman memakai kontrak frontend yang sudah diuji kandidat.
  **Simulasi RLS Owner/Admin/Finance/Teknisi/Helper PASS**, sesi tanpa profil
  dan profil nonaktif ditolak, anon tidak punya EXECUTE orderRPC. Enam tabel
  bisnis sama sebelum/sesudah DDL dan sesudah tes rollback. Tidak membuat akun
  Auth uji baru atau fixture persisten. Ini **bukan** browser/login Auth nyata
  seluruh peran pada deployment final.
- Rekonsiliasi read-only TLS terhadap source23.25WIB: jumlah+fingerprint enam
  tabel bisnis sama (`orders`, `invoices`, `customers`, `invoice_payments`551,
  `user_profiles`25, `service_reports`3000). Auth26akun cocok semua kolom sumber
  **kecuali `updated_at`**; perbedaan timestamp tetap tercatat. Tidak mengklaim
  Auth exactmatch atau freeze semua writer dari pemeriksaan titik-waktu ini.
- Konfigurasi produksi diambil melalui API Vercel **yang memang mengizinkan
  pembacaan nilai encrypted**, hanya allowlist Owner/Fonnte/R2. Nilai sensitive
  /shown-once tidak dibaca lewat jalur lain. Transfer SSH stdin tersembunyi
  lalu Coolify API write biasa: **22 env utama, preview0**, secret server
  runtime-only, CDN publik build-only. Tidak ada pesan WA atau objek R2 ditulis.
  AI/SMTP/app-backup keys serta verifikasi integrasi runtime masih belum lengkap.
- App bisnis `aclean-web-production` tetap **0 deployment, domainnull**,
  commit16948e1. Token deploy403 tidak dibypass melalui Docker/DB/queue.
  Owner diminta klik **Deploy sekali pada resource produksi bisnis ini** untuk
  build internal; bukan mengalihkan domain atau membuka trafik pelanggan.
  Maintenance app dan staging tidak diubah. Mac kini memverifikasi TLS valid:
  app503, sbhealth200/sbREST503, staging401 (BasicAuth disengaja); propagasi DNS
  sb pada resolver kerja sudah menuju gateway VPS.

Bukti root-only di `/etc/aclean-prod-migration/`:
`production-db-restore-verified.json`, `production-vault-media-verified.json`,
`production-access-verified.json`, `production-source-reconciliation.json`,
`production-integrations-configured.json`. Backup konfigurasi target tetap
`d1624da3`; belum mencakup semua22env aplikasi Coolify. Berkas SQL forward
harus disertakan saat pemulihan dari dump sebelum hardening.

Verifikasi lokal: parser5/5, selfhost11/11. Uji HTTP pertama tertahan sandbox
`listen EPERM`; pengulangan dengan izin listener localhost PASS, bukan bug
aplikasi. Syntax Python/Node dan `git diff --check` PASS. Tidak commit/push.

**Sisa gerbang:** build/runtime produksi; ingress Supabase dengan allowlist
rute (Studio/DB tetap privat); browser/login/media lintas peran melalui
deployment final; integrasi/worker/webhook dan satu scheduler; kelengkapan
backup konfigurasi; freeze Vercel/webhook/browser/in-flight dan keputusan
konsistensi snapshot; rollback/delta. Website perusahaan apex/www masih
membaca managed lama, jangan matikan/hapus source. Dua tes yang ditunda owner
tidak diminta ulang. Skor75/100 di bagian lama adalah checkpoint historis,
bukan penilaian ulang tahap ini. Tetap **NO-GO**, meski restore inti sudah PASS.

Semua bagian berikut adalah riwayat checkpoint; pernyataan "target0container",
"SSHexpired", "belumrestore" di bawah sudah digantikan bukti terbaru di atas.

## Lanjutan sekitar22.58 WIB — akses SSH perlu dimuat ulang

Owner meminta lanjut memakai snapshot `a95a23cb`, tanpa dumpDBulang. Pemeriksaan
VPS sempat berhasil: target `aclean-production` masih **0 container**, Compose
internal/no ports, RAM available4246MB dan disk kosong53GB. Belum ada restore
atau start target; kandidat/staging tidak ditimpa.

Koneksi kontrol SSH kemudian hilang; login baru dengan identity khusus ditolak
`Permission denied (publickey)`. Pemeriksaan agent Mac di luar sandbox memberi
`The agent has no identities.` Ini kendala autentikasi nyata, bukan asumsi
dari history. Owner perlu memuat kembali key via ssh-add; socket lama di store
dibatalkan, jangan dipakai ulang. Tidak meminta private key/passphrase di chat.

Pembaruan skrip Storage latest-precutover dan JIT-off pada pembaca Vault ada
**lokal**, syntaxPASS. SCP Storage gagal sebelum terkirim, jadi VPS masihversi
lama; jangan menjalankan argumenbaru sebelum uploadulang. Ekspor empat Vault
dicoba baca-saja tetapi receiverSSHgagal (EXPORT_FAILED), **tidak ada snapshot
Vault baru**. Tidak menampilkan nilainya atau membuat dumpDB baru. Source
scheduler tetap sesuai checkpoint OFF; jangan membuka target/cron saat menunggu.

## Pembaruan sekitar22.50 WIB — dump terbaru BERHASIL, belum final tersertifikasi

Satu proses ekspor baru `prod-precutover-export.sh --latest-precutover` memakai
CLI2.122.0 melalui koneksi PostgreSQL session-pooler/TLS langsung dari VPS,
**bukan Data API/Vercel**. Roles, schema dan data selesai. Snapshot R2 restic
**`a95a23cb`** (full ID
`a95a23cb73f461ce1f15c7c0a1fd0a085564bcdfaf31c8426c7f02dd30631713`),
tag `aclean-prod-latest-precutover`, berisi **154.042.168 byte SQL**. Repository
integrity penuhPASS; ketiga file SQL dibaca ulang dari R2 dan SHA256 cocok3/3.
Tidak ada source mutation di proses dump. Password hanya lewat SSHstdin,
tidak argv/log; plaintext sementara dibersihkan setelah verifikasi.
Manifest VPS `/etc/aclean-prod-migration/latest-db-export-verified.json`.

User menginterupsi sesi lalu mengirim panduan usulan `pg_dump`/`psql` manual.
Saat diperiksa, ketiga tahap ekspor sudah selesai; hanya backup/read-back yang
masih berjalan, lalu selesai sukses. Tidak memulai dump kedua atau restore
mentah dari panduan itu. Kutipan prompt "sudah restore manual" **bukan bukti
restore terjadi**. Jangan meminta password diURL atau membuka5432 ke publik.

Snapshot ini **belum bersertifikasi final**: freeze Vercel/webhook/browser/
in-flight belum lengkap verifikasi, media/Vault terbaru belum satu paket dan
restore bersih/rekonsiliasi belum dilakukan. Jangan melabeli ulang sebagai
final hanya karena berhasil dump. Owner meminta tidak mengulang pengambilan
dump; gunakan hasil ini untuk pemeriksaan berikutnya, jangan memulai dump
baru tanpa arahan/keputusan data konsisten. DB final belum start/import dan
resource produksi bisnis belum deploy/domain; maintenance tetap.

## Pembaruan22.34 WIB — target config offsite PASS, source restarting

Lanjutan22.43WIB: metadata sourceACTIVE_HEALTHY; SQL ringan viaMCP/PG TLS
berhasil dan startupDB15:34:27.623UTC. Count bisnis masih pernah57014. Lima
cronDB source terinventaris masihaktif dan kini dinonaktifkan melalui native
`cron.alter_job` (ID+nama tepat, satu transaksi). Baca-ulang semua enam jobOFF;
job6 tidak diubah. Guard agregat percobaan awal timeout sebelum perubahan,
dibuktikan dengan baca-ulang sebelum metode native; tidak mengklaim berhasil
dari respons timeout. GitHubdua schedulerOFF sebelumnya. Vercel/webhook/
browser/in-flight tetap belum lengkap verifikasi, dump final masihbelum ada.

Owner memberi persetujuan "Jalankan" untuk backup target dan melakukan Restart
Project source manual. API source masih `RESTARTING`; probe PG belum terhubung.
Tidak dikirim restart kedua, reset atau perubahan data. Status restart ini
belum boleh disebut kegagalan pemulihan sebelum verifikasi setelah selesai.

Snapshot R2 terenkripsi **`d1624da3`**, tag
`aclean-prod-target-config-precutover`, kini berisi lima file konfigurasi/kunci
target (17.238KiB). Unggahan diterima setelah konteks persetujuan baru; integritas
repository penuh `restic check --read-data` PASS dan SHA256 baca-ulang5/5 sama,
tanpa isi rahasia dicetak. Ini menutup penolakan upload target sebelumnya,
**bukan** final dump DB/media atau restore bersih. Password restic sudah
disimpan owner di luar VPS. Detail/path bukti pada dokumen resource produksi.

## Lanjutan final dump sekitar22.27 WIB — source masih timeout

Owner mengizinkan endpoint/secret target, dump final dan restore bersih serta
rekonsiliasi. Preflight baru melalui PostgreSQL10s, SQL Management API dan
Storage S3 tetap gagal: timeout/HTTP544. **Tidak ada dump DB/media final baru**;
snapshot latihan tidak dilabeli ulang. Source metadata masihACTIVE_HEALTHY,
tetapi bukan bukti jalur data sehat; query log agregat tidak memberi bukti akar
sebab. Tidak ada source restart/reset/password change. Freeze selain dua
workflow GitHub masih perlu diverifikasi setelah source pulih.

Owner membuat recordDNS `sb` yang benar; seluruh record lain utuh. Ingress
Supabase baru maintenance-only sudah berjalan tanpa network DB. TLS ke VPS
lulus22.26 WIB, health200 dan REST503 disengaja; DNS Cloudflare sudahVPS tetapi
resolver sistem Mac masihVercel404, jadi propagasi belum penuh. Target final
`/home/ubuntu/supabase-production` memiliki kunci baru/namespace terpisah,
Compose internal/no published ports/cronOFF, **belum dimulai atau diimpor**.
Enam env inti target ditambahkan ke Coolify produksi (total15, preview0),
server secret runtime-only, tidak deploy. Integrasi/owner phone belum lengkap.

Auto-review memblokir unggahan `.env`/tiga secret app target ke R2 karena butuh
persetujuan eksplisit payload rahasia itu; **backup ini belum dieksekusi**, tidak
dicoba jalur lain. Backup empat Vault source yang disetujui sebelumnya adalah
payload berbeda. Perlu persetujuan owner untuk backup target terenkripsi dan
arah pemulihan source (restart bukan reset; koneksi/website lama dapat terputus).
Detail [status resource](../coolify/PRODUCTION_PREPARATION_STATUS.md).

## Persiapan Coolify sekitar 22.09 WIB — checkpoint sesuai scope owner

DNS `app A 129.226.209.14` TTL60 sudah dibuat owner dan diverifikasi. Resource
kosong yang dibuat owner di UI diadopsi menjadi `aclean-web-production`
(`xsehtou4dfqqmjwca1irjkmz`), environment production; Dockerfile/port3000,
commit `16948e1`, auto-deploy/preview OFF, sembilan env nonrahasia saja.
Domain bisnis sengaja belum diaktifkan dan tidak ada deploy bisnis.
Resource `aclean-app-maintenance` (`3ajskmpau4nd7lm29pkbnaaa`) disiapkan untuk
`https://app.aclean.id` tanpa database/secret. Deployment pertama sempat502
karena label proxy menunjuk80 sementara Caddy sehat di8080. Port dan regenerasi
label dikoreksi lewat API normal, kemudian owner redeploy UI kedua
`pvmdjpn3v4lnb48mahw7lmdu` (Finished22.07 WIB). Verifikasi22.08 WIB lulus:
container/proxy8080 sehat, TLS valid, HTTP302, root503 + Retry-After/noindex,
`/healthz`200 `maintenance-only`, `/api/health`503 tanpa API bisnis.
Tidak perlu deploy maintenance lagi. Token agen menolak deploy403 dan tidak
dilewati. `sb.aclean.id` belum punya record khusus: mengikuti wildcard Vercel
ke64.29.17.1/64.29.17.65, bukan Supabase VPS; gateway produksi belum dibuat.
Produksi bisnis tetap nol deployment/domain, staging tetapRunning/Healthy
dengan delapan deployment yang tidak berubah.
Dua scheduler GitHub kini terverifikasi `disabled_manually`; tidak perlu
meminta owner menonaktifkannya lagi. Staging tetap sehat/tidak diubah.
Tidak ada dump/restart source/cutover pada checkpoint ini.
Lihat [status resource produksi](../coolify/PRODUCTION_PREPARATION_STATUS.md).

## Blocker baru sekitar 20.35 WIB — permintaan dump lebih awal

Owner mengonfirmasi penulis berhenti dan freeze dapat dipertahankan. Namun dua
scheduler GitHub masih `active` pada inventaris (`Cron Dispatcher` ID296998220,
`Payment Media Retry` ID386146003); status cron source belum dapat diverifikasi.
Percobaan dump DB terbaru gagal (exit1), koneksi pg Mac timeout, dan query
metadata read-only via Supabase Management API juga timeout. Port TCP pooler
dari VPS terbuka; direct endpoint tidak dapat diraih pada jalur IPv6 VPS.
Backup Storage terbaru gagal dengan `DatabaseTimeout` HTTP544 sebelum snapshot
baru dibuat. Metadata project `ACTIVE_HEALTHY` tidak cocok dengan kesehatan
jalur data yang teramati; akar sebab belum dipastikan. Tidak ada dump final
baru, switch, mutasi DNS/env/scheduler produksi, atau reset source dilakukan.
Jangan mengangkat snapshot latihan menjadi final. Checklist aman ada pada
[FAST_TRACK_CUTOVER_2026-10-28.md](FAST_TRACK_CUTOVER_2026-10-28.md).

## Pembaruan kandidat privat, sekitar 20.00 WIB

- Owner memilih **`app.aclean.id`** sebagai alamat webapp baru. `aclean.id`/`www.aclean.id` adalah proyek website perusahaan berbeda dan **tidak** dialihkan. Domain webapp Vercel yang ditemukan adalah `status.aclean.id` serta `a-clean-webapp.vercel.app`; URL lama dan konsumen website harus ikut dipetakan. Tidak ada DNS produksi yang diubah.
- Stack `aclean-prod-candidate` dibuat dari source Supabase resmi terpin `bc27d2661edd09a5d0b8d76ce33da6d4071a756e` (`self-hosted/v0.8.3`), dengan key baru dan volume terpisah. Sembilan layanan inti healthy. Jaringan `aclean-prod-candidate_default` bersifat **internal**; `pg_cron` target OFF, SMTP kosong, Edge Functions dan pooler belum dimulai. Kandidat tidak dapat mengirim pesan pelanggan.
- DB snapshot `afd38399` dan empat secret snapshot `7778e005` berhasil masuk kandidat. Baseline restore: 3055 order, 2893 invoice, 1547 customer, 26 pengguna Auth, 65 metadata Storage. Owner uji sintetis kemudian ditambahkan; angka setelah uji tidak boleh dibandingkan mentah dengan baseline.
- Transfer file pertama terhenti karena Docker tidak memasang published port pada network internal. DB/Vault tidak dibatalkan. Pemulihan dilanjutkan melalui proxy **loopback-only** sementara `aclean-prod-candidate-loopback.service`, lalu `import-candidate-storage.sh`: seluruh **65 file / 5.397.173 byte** dari snapshot `e394334b` berhasil diunggah dan dibandingkan byte-nya. Ini checkpoint pemulihan gabungan, bukan klaim skrip full-restore pertama selesai tanpa error.
- Proxy sementara `127.0.0.1:28000` menuju gateway internal memakai socat, masa maksimum empat jam. IP container dapat berubah setelah recreate; periksa/segarkan tujuan sebelum memakai proxy. Ini bukan ingress produksi atau konfigurasi persisten Go-Live.
- Uji transaksi menemukan cast `time` pada RPC order sumber. Migrasi 222 diterapkan **hanya kandidat**, disusul SQL eksperimen `private-candidate-access-hardening.sql` (bukan migrasi produksi final). Guard NULL-role order dan daftar RPC sensitif diperketat; akun nonaktif kehilangan role efektif, akses pelanggan/laporan/order dibatasi assignment, field staff hanya membaca profil lengkap sendiri dan direktori kolom aman. Isi enam tabel historis dibandingkan dengan fingerprint sebelum/sesudah perbaikan: **tidak berubah**.
- **Smoke bisnis kandidat PASS:** Owner sintetis → order tanpa dispatch → retry idempoten → pelanggan lama ID teks → laporan → verifikasi/invoice Rp100.000 → approval → pembayaran → retry pembayaran. Ledger tepat satu baris, saldo nol, invoice/order PAID, akses anonim ditolak. Hanya data fiktif baru; tidak ada pembayaran/order historis diubah.
- **Tes sesi nyata kandidat PASS:** Admin/Finance insert, Teknisi/Helper hanya assigned read/update, larangan perubahan kolom order terlindungi dan self-promotion, profil/direktori minim data, akun tanpa profil, serta pencabutan akses pengguna nonaktif dengan JWT lama. Enam belas RPC laporan/dashboard/keuangan/inventori menolak sesi tanpa profil dengan `42501`; Admin sah masih dapat membaca dashboard/keuangan. Fixture role dibersihkan tepat berdasarkan ID uji.
- **Browser kandidat PASS pada commit `16948e1`:** image aplikasi dibangun ulang dari source commit staging dengan key/URL kandidat, lalu dijalankan sebagai `aclean-private-web-candidate` (bukan resource/domain produksi Coolify). Browser login Owner sintetis dan navigasi Dashboard → Customer → Order Masuk → Invoice → Finance → Dashboard lulus, tanpa uncaught error atau HTTP 5xx teramati. Seluruh request browser eksternal diblokir; tidak ada screenshot/trace/data pelanggan direkam. Salah selector menu pada percobaan pertama diperbaiki; hasil PASS berasal dari pengulangan lengkap. Ini belum browser semua peran, aksi edit end-to-end, atau domain/TLS produksi.
- **Probe baca terbatas kandidat PASS:** 48 request, konkurensi 3, sekitar 0,25 detik, p50 7,3 ms / p95 45,1 ms / maksimum 56,4 ms, nol HTTP gagal. DB/Auth/REST/app kandidat healthy, `OOMKilled=false`, restart 0. Angka ini hanya jalur lokal VPS dan query terpilih, bukan latency internet, uji semua worker atau sertifikasi kapasitas.
- **Restart terkontrol DB/app kandidat lulus:** PostgreSQL kembali menerima koneksi; `cron.launch_active_jobs=off`, nol cron aktif, 3055 order historis / 2893 invoice historis / 65 metadata Storage tetap ada. Penghitung restart setelah tes ini tidak lagi nol secara sengaja.
- Sesudah restart, pengulangan browser lengkap login/menu Owner kembali PASS, tanpa uncaught error atau HTTP 5xx teramati. `test:selfhost` lokal 11/11 PASS (perlu izin listener localhost di luar sandbox); pemeriksaan sintaks skrip dan `git diff --check` lulus. Tidak ada commit/push pada tahap ini.
- Audit baca-saja HTML publik dan `/js/analytics.js` pada `https://aclean.id` menemukan referensi project managed lama dan pembacaan `rest/v1/website_settings` serta `rest/v1/media_slot`. Tidak ditemukan verb tulis pada halaman/aset yang dipindai; ini **bukan** audit semua halaman admin/website. Source managed jangan dihapus/dimatikan setelah webapp pindah sebelum seluruh konsumennya dipetakan.
- Inventaris DNS Vercel saat diperiksa memiliki record spesifik `staging` dan `sb-staging` ke VPS, tetapi belum ada record spesifik `app`/`sb`. Menambahkan subdomain itu kelak tidak memerlukan pemindahan apex/nameserver. Ini hanya pembacaan inventaris; tidak ada mutasi DNS.
- Sampel kapasitas: 7685 MB RAM total, sekitar 3530 MB used / 4154 MB available; swap 158 MB; disk kosong 54 GB. Ini **bukan** uji beban produksi atau jaminan kapasitas.
- Kandidat mengandung data fiktif/kemungkinan antrean trigger dari gladi. **Jangan membuka egress/scheduler stack ini atau memakainya langsung sebagai final tanpa restore bersih, pemeriksaan antrean, dan rekonsiliasi pada freeze.**

## Skor gerbang sementara: 75/100 — bukan peluang sukses, tetap NO-GO

Rubrik yang sama dengan snapshot kesiapan sebelumnya; dua tes yang ditunda owner
tidak dicatat sebagai PASS. Skor tidak menghapus blocker wajib, dan tidak berarti
75% kemungkinan berhasil atau menjamin cutover selesai dalam satu jam.

| Bagian | Skor | Dasar dan kekurangan utama |
| --- | ---: | --- |
| Platform | 18/20 | Inti Supabase dan web kandidat sehat; ingress produksi, image final/digest dan layanan opsional belum final. |
| Bisnis | 18/25 | Smoke transaksi idempoten dan menu Owner lulus; pembayaran parsial/gabungan, stok/biaya/modul lain dan browser semua peran belum lengkap pada kandidat. |
| Keamanan | 20/25 | Matriks izin terbatas dan 16 RPC negatif lulus; SQL forward final, seluruh RPC sensitif, media/integrasi serta gateway produksi belum selesai direview/diterapkan. |
| Pemulihan | 16/20 | Dump DB, 65 file dan empat secret terenkripsi/read-back/restore lulus; backup konfigurasi/key target, R2 media produksi dan RPO/RTO final belum lengkap. |
| Operasional/cutover | 3/10 | Jendela/domain dipilih dan source writer terinventaris sebagian; final resource/env/TLS, freeze semua writer, satu scheduler, redirect/consumer dan rollback delta belum terbukti. |

Berikutnya sebelum maintenance: finalisasi konfigurasi/resource **produksi** tanpa
route publik lebih dahulu; review/generasi migrasi forward dari SQL eksperimen;
uji media/integrasi dan pemicu terkontrol; inventaris writer dan konsumen lama;
siapkan freeze serta rollback. Setelah semuanya lulus dan owner mengonfirmasi
staf berhenti, barulah dump final/restore bersih/rekonsiliasi/alih domain dilakukan.
Jika belum selesai menjelang 22 WIB, **tunda**, bukan membuka kandidat gladi ini.

## Pembaruan persiapan 28 Oktober, sore hari

- `rclone` v1.60.1 telah dipasang di VPS. Kunci S3 Supabase managed telah divalidasi dan disimpan root-only setelah input awal ternyata memakai kunci R2 backup. Skrip setup kini menolak kunci R2 yang sama dan memvalidasi akses Supabase sebelum mengganti file. Cabut key sementara ini setelah migrasi.
- **File Storage lulus backup dan read-back:** bucket `web` berisi 65 objek, 5.397.173 byte; `fotos` kosong. Semua file diunduh ke temp root-only, dibandingkan isi byte lewat S3, lalu dibackup terenkripsi ke R2 sebagai snapshot `e394334b`. `restic check --read-data` lulus. Snapshot kemudian diunduh ulang dan seluruh 65 file hasil restore cocok dengan sumber melalui `rclone check --download`. Plaintext sementara dihapus. Ini backup latihan dari sumber yang masih aktif, bukan salinan final saat freeze.
- **S3 target staging lulus uji fungsional:** pembuatan bucket privat sementara, unggah tiga file sintetis (teks, biner, nama dengan spasi), pembandingan isi, unduh ulang, dan tiga metadata `storage.objects` lulus. Akses anonim melalui rute object biasa maupun public ditolak. Bucket dan file sintetis sudah dihapus; tidak ada file pelanggan dimasukkan ke Storage staging.
- S3 target harus menggunakan host yang cocok dengan `STORAGE_PUBLIC_URL=https://sb-staging.aclean.id`. Probe loopback `127.0.0.1:18000` semula memberi `SignatureDoesNotMatch`; probe lewat host publik lulus dengan kredensial yang sama. Ini perbedaan canonical host pada probe; konfigurasi layanan tidak diubah.
- **Vault lulus backup dan restore terisolasi:** owner memberi izin eksplisit untuk backup empat secret produksi ke bucket R2 migrasi privat. Ekspor baca-saja memakai TLS terverifikasi dan SSH stdin; nilainya tidak dicetak. Snapshot `7778e005` lulus integrity check dan checksum read-back. Gladi gabungan snapshot DB `afd38399` + Vault `7778e005` berhasil pada container tanpa jaringan; empat nilai cocok (4/4), dan satu ciphertext legacy profil terdekripsi (1/1), tanpa menampilkan plaintext. Database aktif tidak diubah dan container/temp dibersihkan. Pemeriksaan source menemukan nol referensi literal UUID secret di fungsi `public`/perintah cron; ini bukan bukti semua konsumen eksternal telah diaudit.
- Lima Edge Function aktif diperiksa kode sumbernya secara baca-saja. Tiga fungsi lama tidak melakukan pemeriksaan pemanggil sebelum memakai service role; jangan membuka salinan target tanpa guard. Rincian: [EDGE_FUNCTION_MIGRATION_AUDIT.md](EDGE_FUNCTION_MIGRATION_AUDIT.md). Tidak ada fungsi sumber yang dipanggil atau diubah dalam audit.
- Pemeriksaan kode lokal lulus: `test:selfhost` 11/11, Vitest 1643/1643 (144 berkas), TypeScript, ESLint, dan build Vite. `check:migrations` lulus tanpa nomor duplikat baru dan masih mencatat gap warisan 024/091. Ini tidak menggantikan pengujian integrasi terhadap data nyata.
- IP kerja berubah saat pengujian; owner menambah aturan SSH `114.10.39.0/32`. Koneksi SSH pulih dan memakai control socket privat agar sesi aktif dapat dipakai ulang. Jangan membuka port 22 ke seluruh internet.

## Keputusan owner

- Target akhir: web/API pindah ke Coolify pada `app.aclean.id` dan Supabase pindah ke Docker di VPS SumoPod yang sama. Domain produksi belum dialihkan; website perusahaan tetap pada hostingnya.
- Jendela operasional yang dipilih: 22.00–23.00 WIB, **bersyarat**. Mulai jeda hanya setelah dump, backup offsite terenkripsi, restore terisolasi, rekonsiliasi, dan rollback siap; jika belum lulus, tunda cutover tanpa mengganggu produksi.
- Owner tidak meminta uji restore di VPS kedua atau uji beban 48 jam. Ini penerimaan risiko, bukan bukti kedua uji tersebut lulus. Uji fungsional, restore terisolasi pada VPS yang sama, kapasitas sesaat, dan pengawasan ketat pasca-cutover tetap diperlukan.

## Bukti yang sudah ada

- Sumber managed: project `apsbeppcmsxeldnejibz`, PostgreSQL 17.6.1.084; inventaris baca-saja: sekitar 183 MB DB, 26 akun Auth, 65 objek Supabase Storage, 5 `pg_cron` aktif, 5 Edge Functions, 3055 order, 2893 invoice, dan 1547 customer. Angka ini berubah selama produksi berjalan.
- Sertifikat CA sumber `prod-ca-2021.crt` valid sampai April 2031; koneksi sumber diuji dengan TLS terverifikasi. Password dari `SUPABASE_DB_PASSWORD` lokal bekerja; password yang tertanam dalam `SUPABASE_DB_URL` lokal tidak cocok. Jangan mencetak nilai keduanya.
- VPS: sekitar 56 GB ruang disk bebas dan 4,9 GiB RAM tersedia saat diperiksa. Supabase CLI 2.122.0 diunduh ke `/tmp/aclean-cli-2.122.0` dan SHA-256 arsip resmi cocok. Sertifikat CA publik telah disalin ke VPS.
- Bucket privat `aclean-prod-migration-backup` dan token khusus bucket dibuat oleh owner. Skrip root-only `setup-prod-migration-r2.sh` telah dijalankan dan melaporkan repository restic terenkripsi berhasil diinisialisasi. Password pemulihan harus disimpan di luar VPS sebelum ekspor.
- Owner mengonfirmasi password pemulihan telah disimpan di luar VPS. Ekspor latihan roles/schema/data melalui CLI 2.122.0 berhasil; snapshot restic `afd38399` (145,505 MiB input; 13,105 MiB tersimpan setelah kompresi/deduplikasi) lolos `restic check --read-data` tanpa error. File plaintext sementara dihapus oleh trap skrip. Peringatan FK melingkar pada `orders`, `invoices`, `quotations`, dan `inventory_transactions` perlu dibuktikan pada restore.
- **Gladi restore lulus:** snapshot `afd38399` dibaca ulang dari R2, checksum seluruh file SQL cocok, lalu roles/schema/data dipulihkan dalam satu transaksi ke container PostgreSQL 17 disposable tanpa jaringan atau port publik. Migrasi skema Auth v2.197.0 dan Storage v1.81.0 dijalankan hanya pada container tersebut; `pg_cron` diarahkan ke database uji dengan tugas aktif dimatikan. Hasil query target: 3055 order, 2893 invoice, 1547 customer, 26 pengguna Auth, 65 metadata Storage, 105 tabel `public`. Peringatan FK melingkar tidak menggagalkan restore. Container dan plaintext sementara sudah dipastikan bersih setelah uji; Supabase lab dan Coolify tetap `healthy`. Ini **belum** membuktikan file Storage, Vault, Edge Functions, atau kesiapan cutover.
- `aclean-files` adalah bucket media produksi dengan akses publik; arsip parsial lama di sana **bukan** backup lengkap Supabase dan tidak dipakai untuk dump ini.
- `supabase_vault` aktif dengan **4 secret** (`aclean_cron_dispatcher_secret`, `aclean_field_report_worker_secret`, `aclean_payment_worker_secret`, `user_profiles_password_key`). CLI memfilter skema `vault` dari dump; backup terpisah dan gladi pemulihannya kini lulus (lihat pembaruan di atas). Nilai belum dimasukkan ke database produksi target. Jangan mencetaknya di log/chat.
- Lima Edge Function produksi berstatus aktif; daftar fungsi menunjukkan `verify_jwt=false` untuk semuanya. Implementasi otorisasi di dalam masing-masing fungsi harus diaudit sebelum endpoint target dipublikasikan.
- Rincian Supabase Storage: seluruh 65 objek berada di bucket `web` (sekitar 5,4 MB); bucket `fotos` saat ini kosong. Ini berbeda dari bucket Cloudflare R2 `aclean-files` yang menyimpan beberapa GB media aplikasi.
- Risiko operasional baru: pada pemeriksaan lokal, nilai kredensial dari `.env.local` sempat tampil dalam keluaran tool diagnostik. Jangan salin nilainya ke dokumen/chat. Anggap berpotensi tercatat dalam riwayat sesi dan rencanakan rotasi kredensial terkait secara terkoordinasi setelah semua konsumen dan jalur rollback siap; jangan rotasi mendadak saat produksi masih berjalan.

## Urutan kerja yang belum selesai

1. **Selesai sebagai gladi:** password restic disimpan di luar VPS; ekspor *live-source* roles/schema/data dengan TLS `verify-full` diunggah terenkripsi ke bucket privat dan `restic check --read-data` lulus. Ekspor ini tidak konsisten lintas tiga dump saat source masih menerima write, sehingga bukan snapshot cutover final.
2. **Selesai sebagai gladi:** baca-ulang snapshot R2 dan restore ke container disposable tanpa port/jaringan pada VPS yang sama lulus; tabel inti dan Auth/Storage metadata cocok dengan angka ekspor. Tidak ada data nyata yang dimasukkan ke lab staging. Ini bukan uji restore lintas-VPS dan bukan snapshot final yang konsisten saat sumber masih menerima write.
3. **Backup/read-back DB, file, dan Vault serta restore kandidat sudah lulus sebagai gladi.** Finalisasi SQL forward yang direview (jangan mengedit migrasi historis), hardening Edge Functions, Auth/provider/SMTP, JWT/redirect, 5 cron, R2 media, env/secrets, webhook, domain API dan resource Coolify produksi. Inventaris website perusahaan yang masih memakai source belum tuntas. Jangan menyalakan scheduler/egress pelanggan di target uji.
4. **API kandidat bisnis, matriks peran terbatas, dan browser Owner baca/menu PASS** seperti rincian di atas; browser semua peran/aksi edit, media aplikasi kandidat, cron/webhook terkontrol, dan restart target tetap harus dituntaskan. Port proxy/browser privat bukan konfigurasi Go-Live. Bandingkan baris/totals dan referensi media, bukan hanya status HTTP.
5. Menjelang cutover: umumkan dan bekukan **semua** writer sumber (browser, API, webhook, GitHub/Vercel cron, `pg_cron`), tunggu in-flight selesai, ambil dump final dan upload R2, restore target kosong, rekonsiliasi. Hanya setelah lulus, pindahkan domain/env web/API ke Coolify dan hidupkan tepat satu scheduler target. Siapkan prosedur balik yang memperhitungkan write setelah cutover; rollback DNS saja tidak aman.

Rujukan prosedur teknis: [RESTORE_RUNBOOK.md](RESTORE_RUNBOOK.md), [CRON_CUTOVER.md](CRON_CUTOVER.md), dan [panduan resmi Supabase](https://supabase.com/docs/guides/self-hosting/restore-from-platform).
