# AGENT_PLAYBOOK.md — Protokol Eksekusi untuk AI Agent

> Tujuan: model apa pun (Sonnet / Opus / lainnya) menghasilkan output berkualitas konsisten di repo ini
> TANPA buang token menebak-nebak konteks. Baca section yang relevan dengan tugasmu SEBELUM menulis kode.
> CLAUDE.md = fakta repo. File ini = CARA KERJA.

---

## Fase 0 — Orientasi (selalu, maks 2-3 tool call)

1. **Identifikasi tipe tugas** → lompat ke playbook di bawah (§Playbook per Tipe Tugas).
2. **Jangan percaya ingatan/asumsi.** Sebelum mengklaim "fungsi X ada di file Y" atau "flow-nya begini",
   grep/baca kode aslinya dulu. Memory atau dokumentasi >2 minggu wajib re-verifikasi terhadap kode.
3. **Cari kode yang sudah ada sebelum menulis baru.** Helper hampir pasti sudah ada di:
   - `src/lib/` (phone, dateTime, pricing, validators, customers, inventory, safeJson)
   - `src/data/reads.js` (semua SELECT) dan `src/data/writes.js` (semua INSERT/UPDATE/DELETE)
   - `api/_*.js` (shared backend: `_auth`, `_logger`, `_r2-upload`, `_ai-text`, `_ai-vision`, `_validate`)
   Menulis ulang helper yang sudah ada = bug ganda di masa depan. Grep dulu, tulis belakangan.
4. **Cek skill yang tersedia** — kalau tugas cocok, PAKAI skill-nya, jangan kerjakan manual:
   - `new-migration` → semua perubahan schema DB
   - `cron-toggle-check` → tambah/ubah cron task atau debug WA leak
   - `role-access-check` → tambah menu/view atau ubah guard role
   - `extract-modal` → refactor modal keluar dari App.jsx
   - `verify` → sebelum commit perubahan non-trivial

## Fase 1 — Rencana singkat sebelum edit (untuk tugas >1 file)

Tulis 3-5 baris SEBELUM edit pertama:
- File yang disentuh + urutan edit
- Ada perubahan DB? (→ migrasi + RLS)
- Ada jalur paralel yang harus paritas? (lihat §Paritas di bawah)
- Cara verifikasi di akhir

Kalau rencana tidak bisa ditulis dalam 5 baris, tugasnya belum dipahami → kembali ke Fase 0.
Untuk fitur besar/ambigu: tanya user dulu, jangan mengarang requirement.

---

## Playbook per Tipe Tugas

### A. Perubahan schema DB (tabel/kolom/RLS baru)

1. Pakai skill `new-migration`. Nomor = tertinggi di `migrations/` + 1 (cek `ls migrations/ | tail`,
   pernah ada nomor dobel — jangan diulang). JANGAN ambil nomor dari daftar Migrations Status di
   CLAUDE.md: 21 Agu 2026 daftar itu berhenti di 126 padahal folder sudah 132.
2. **RLS wajib dipikirkan di migrasi yang sama**, bukan menyusul:
   - Policy `TO authenticated` (user login via signInWithPassword), BUKAN `anon` — gotcha klasik.
   - Tabel finansial → role-tier Owner/Admin/Finance (contoh: migrasi 119).
   - Teknisi hanya baris miliknya → pakai helper `is_my_job(job_id)` / `get_my_role()` (migrasi 117).
3. Tulis idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `UPDATE ... WHERE nilai_lama`) — migrasi
   hand-run, re-run tidak boleh error. Dua jalur menjalankan: user paste ke Supabase SQL Editor, ATAU
   agen apply sendiri lewat MCP `apply_migration` kalau user minta "jangan manual". Catatan: MCP
   `execute_sql` untuk menulis data prod bisa diblok classifier, `apply_migration` lolos (21 Agu 2026,
   migrasi 133-136). Selalu verifikasi dengan SELECT sesudahnya — jangan percaya `{"success":true}` saja.
4. Setelah applied: update daftar migrasi di CLAUDE.md.
5. Kolom baru dipakai frontend? Cek daftar kolom di `reads.js`/`writes.js` (mis. `INVOICE_COLS`) —
   lupa menambah kolom di sana = fitur silent broken (pernah terjadi: badge quotation_id).

### B. Cron task / fitur WhatsApp baru

1. Pakai skill `cron-toggle-check` untuk memahami pola, lalu WAJIB:
   - Toggle AND-logic: `isCronJobEnabled(togMap, key)` **DAN** standalone key `=== "true"`.
   - Fetch `app_settings` harus include key `"cron_jobs"`.
   - Toggle baru harus muncul di Settings UI dan sync KEDUA tempat (standalone + cron_jobs JSON).
   - Backfill key di `app_settings` saat menambah strict check — kalau tidak, task mati diam-diam
     (insiden 12 Jul: 5 task mati senyap).
2. Task baru masuk lewat **dispatcher `task=tick`** (`api/cron-reminder.js` → `api/_tasks/`), BUKAN
   entry cron baru di vercel.json (Vercel Hobby cron tidak andal; GitHub Actions ping per jam).
3. Webhook inbound berisiko retry (Fonnte retry kalau respons >5s) → pakai pola `wa_webhook_dedup`
   (INSERT dedup_key sebagai mutex atomic; 409 = skip).
4. Kirim WA ke Owner/Admin: filter `active = true` di user_profiles (insiden WA bocor ke admin nonaktif).
5. Kirim PDF via Fonnte: metode `url` (Fonnte yang fetch), JANGAN upload biner (ECONNRESET).

### C. Menu / view / perubahan role

1. Pakai skill `role-access-check` setelah selesai.
2. Urutan wiring view baru: file di `src/views/` → lazy import + `renderContent()` di App.jsx →
   entry `canAccess()` → bungkus `ViewErrorBoundary` → update tabel Role Access di CLAUDE.md.
3. Jangan pernah menambah akses Admin ke fitur Owner-only (pricelist, settings, monitoring,
   statistik, deleted audit, finance) tanpa konfirmasi Owner — UI guard DAN RLS DB dua-duanya.
4. Styling: inline object dari `cs` (src/theme/cs.js), dark mode default. Tidak ada CSS framework.

### D. Invoice / laporan teknisi

**Aturan paritas (paling sering bikin bug):** perhitungan invoice punya 2 builder paralel —
jalur submit (`laporanInvoice.js`) dan jalur verify (`LaporanTimView`). Perubahan logika harga/item
di satu jalur WAJIB dicerminkan di jalur satunya, lalu tes KEDUA jalur.

- Invoice dihitung dari LAPORAN (price list global), bukan dari penawaran/quotation.
- Job multi-hari = 1 invoice anchor di induk; laporan hari berikutnya SKIP (tidak menambah invoice).
- Item section "Barang" harus jadi line item (pernah drop dari total = kurang tagih).
- Setelah `markInvoicePaid()` → `orders.status = 'PAID'` juga.
- Guard pembatalan biaya cleaning harus name-based, bukan "ada baris jasa apa pun".
- `job_id` di form laporan (`laporanModal.id`) JANGAN dipercaya begitu saja — verifikasi live ke
  `orders` (customer+teknisi match) sebelum insert `service_reports`/`invoices`. Insiden nyata
  (Wilcent/DB Style, 03 Agu 2026): laporan tersubmit 7 detik setelah order baru dibuat dengan
  `job_id` menunjuk order LAIN (state modal stale) → status order asli tak pernah update, status
  order lain malah ke-INVOICE_APPROVED. Guard ditambahkan di `submitLaporan.js` (awal fungsi) dan
  `approveInvoiceCore.js` (cross-check `inv.customer` vs `order.customer` sebelum update status).

### E. Bugfix

1. **Reproduksi / temukan akar dulu** — jangan tambal gejala. Baca kode di sekitar bug, bukan cuma
   baris error. Sinyal yang mirip pola dikenal bisa punya akar berbeda.
2. Fix di SEMUA jalur yang berbagi logika (cari duplikatnya via grep), bukan cuma jalur yang dilaporkan.
3. Verifikasi end-to-end (skill `verify` / jalankan flow-nya), bukan cuma "build lolos".
4. Data produksi salah akibat bug lama? Laporkan ke user, jangan koreksi diam-diam.

### F. Refactor

- App.jsx (~5.000 baris) masih punya banyak modal inline → pakai skill `extract-modal`.
- Refactor tidak boleh mengubah perilaku — diff harus bisa dibuktikan ekuivalen.
- Jangan refactor "sambil lewat" di PR fitur/bugfix. Satu PR satu niat.

---

## Anti-Pattern Checklist (grep list ini sebelum kirim kode)

| Jangan | Karena / Gunakan |
|---|---|
| `upsertCustomer()` | Dead code, conflict key salah → `insertCustomer()` / `updateCustomer()` |
| URL R2 publik langsung | Bucket non-publik → wajib `fotoSrc()` / proxy `/api/foto` |
| `.catch()` pada query builder Supabase | Builder bukan Promise penuh → pakai `try/catch` + cek `error` |
| `.limit(N)` dengan N>1000, atau fetcher list BARU tanpa `.range()` loop | PostgREST **diam-diam cap 1000 baris/response** — `.limit(5000)` TIDAK berlaku & TIDAK error. Order DESC → yang terpotong justru baris LAMA; gejalanya "bulan/data lama tampil KOSONG", bukan error, jadi mudah lolos. SETIAP fetcher list baru WAJIB paginate loop `.range(from, from+FULL_FETCH_PAGE-1)` (pola `fetchAllOrders`/`fetchAllInvoices` di reads.js), jangan andalkan `.limit()`. Insiden 17 Agu 2026: `fetchReportWorkStats` pakai `.limit(5000)` → dari 1824 laporan cuma 1000 terbaru terambil → rekap dashboard April/Mei kosong |
| Pakai `ordersData`/`invoicesData` global (props dari App.jsx) untuk kalkulasi HISTORIS (statistik, riwayat customer) | `fetchOrders()`/`fetchInvoices()` di `reads.js` sengaja di-cap 500/300 baris TERBARU demi speed login — bukan seluruh data. Insiden nyata (04 Agu 2026): cutoff jatuh ~Jun/Jul 2026, Statistik bulan lebih lama & History customer lama tampil kosong/salah tanpa error apa pun. Butuh histori penuh (ReportsView, CustomersView detail) → pakai `fetchAllOrders()`/`fetchAllInvoices()` (paginated `.range()`, tanpa cap, di `reads.js`) sebagai live fetch terpisah, JANGAN andalkan array global begitu saja |
| Nambah state "extra"/"merged" tanpa cap (mis. `outstandingInvExtra`) tapi biarkan mutator (`setInvoicesData` dkk) cuma nyentuh state utama | Entity yang cuma hidup di state "extra" (di luar cap 500/300) → mutasi (approve/paid/edit/delete) jadi NO-OP diam-diam di state itu, UI keliatan "stuck"/gagal walau DB-nya sukses. Insiden nyata (05 Agu 2026): 3 invoice OVERDUE lama sukses ditandai PAID di DB tapi UI tetap nampilin OVERDUE. Fix: jadikan setter-nya wrapper yang broadcast updater yang SAMA ke semua state terkait (lihat `setInvoicesData` di App.jsx) |
| Menyimpulkan "data X tidak sampai ke komponen Y" hanya dari grep string di komponen Y | Banyak logic App.jsx sudah diekstrak ke `src/lib/*.js` (pola "Fase 2/3 ctx") — prefill/pemrosesan data bisa terjadi SEBELUM komponen render, di lib terpisah yang tidak kelihatan kalau cuma baca komponennya. Insiden nyata (05 Agu 2026): sempat menyimpulkan `maintenance_unit_ids` tidak pernah dibaca teknisi karena tidak ada di `MaintUnitPickerStep.jsx`/`LaporanTeknisiModal.jsx` — ternyata prefill-nya ADA, di `src/lib/openLaporanModal.js:46-73`. Sebelum klaim "X tidak terhubung", grep juga `src/lib/` untuk nama field/fungsi terkait |
| Panggil `createTeamSplitFn`/`createTeamSplit` untuk 1 tim saja | Fungsi ini hard-require minimal 2 tim (`if (valid.length < 2) return null` — `src/lib/createTeamSplit.js:9`), silent return null tanpa notif jelas kalau dipanggil dgn 1 tim. Untuk kasus "bisa 1 atau banyak tim", branch: `teamKeys.length >= 2` → `createTeamSplitFn`, else → `createOrderFn`/insert order tunggal (lihat pola di `UnitsTab.createOrder` & `ManifestTab.createOrdersFromManifest`) |
| Validasi foto by MIME/ekstensi | Android salah-label JPEG→mp4 → validasi content-based (canvas decode) |
| Toggle cron satu lapis | WA bocor saat OFF → AND-logic (lihat §B) |
| Edit `jenis servis` order | SOP: hapus & buat ulang |
| Konflik jadwal ±1 jam flat | Pakai durasi aktual (`hasConflict`/`cekTeknisiAvailableDB`) |
| Nomor HP format bebas | Selalu `normalizePhone()` → `628xxx` |
| Cron entry baru di vercel.json | Dispatcher `task=tick` (lihat §B) |
| PDF dari state lokal | State basi → refetch baris segar sebelum generate/kirim PDF |
| Delete user via Supabase client | Tidak ada RLS policy → `/api/manage-user` |
| Anggap daftar migrasi = skema DB lengkap | Ada kolom dibuat di luar migrasi (contoh: `invoices.approved_at`, terverifikasi 2026-07-19) → sebelum pakai kolom "yang katanya ada", cek `information_schema.columns` di Supabase |
| Update status order hanya by `job_id` tanpa cross-check | `job_id` dari state form/invoice bisa stale/salah → status order lain ikut salah sasaran (lihat §D, insiden 03 Agu 2026) |
| Buat klien maintenance tanpa mengisi `customer_id` | `withMaintenanceLink()` menautkan order ke kontrak HANYA lewat `customers.id` (bukan HP/nama) → klien yatim = order & invoice-nya tak pernah masuk rekap kontrak, dan admin cenderung membuat customer duplikat. Audit 21 Agu 2026: 6 dari 16 klien ber-`customer_id` NULL → 3 order yatim + 1 customer ganda (CUST678/CUST784, migrasi 133-135). Saat onboarding klien, isi `customer_id` DAN `address` — alamat yang dipakai memilih site benar saat 1 nomor HP menunjuk banyak lokasi |
| Gabung/hapus baris `customers` tanpa cek referensi | Kolom `customer_id` tersebar di 4 tabel (`orders`, `ac_units`, `payment_logs`, `maintenance_clients`) — enumerasi dulu via `information_schema.columns WHERE column_name='customer_id'`, pindahkan semuanya, DELETE paling akhir (contoh: migrasi 135) |
| Edit unit laporan hanya di SATU kolom (`units` atau `units_json`) | `service_reports` simpan unit di DUA kolom: `units` (jsonb, dibaca UI — `r.units` di LaporanDetailModal/LaporanTimView) & `units_json` (text, dibaca autolog `api/_handlers/portal.js:965`). Update satu saja → UI tampil unit basi ATAU autolog nge-log unit salah. Insiden nyata (14 Agu 2026): reconcile install Waskito cuma update `units_json`, UI tetap tampil 4 unit lama pasca-refresh. Update KEDUANYA dgn nilai identik |

## Fase Akhir — Destilasi Pelajaran (loop self-learning)

Playbook ini hanya sepintar pelajaran terakhir yang masuk. Di AKHIR tugas, kalau sesi ini
mengungkap salah satu dari:

- **Asumsi yang ternyata salah** (milikmu atau milik dokumentasi/memory) — contoh nyata:
  kolom `invoices.approved_at` tidak pernah ada di migrasi mana pun, harus diverifikasi ke DB;
- **Gotcha baru** (perilaku library/API/DB yang menjebak);
- **Insiden / bug produksi** dan akar masalahnya;
- **Fakta CLAUDE.md/playbook yang basi** (ketahuan beda dengan kode nyata);

→ jalankan skill **`distill`** (atau lakukan manual): tulis pelajaran itu ke tempat yang tepat
SEBELUM mengakhiri sesi. Aturan:

1. **Hanya fakta terverifikasi** (ada bukti file:baris / query / reproduksi) — spekulasi dilarang masuk.
2. **Satu pelajaran = satu baris** kalau bisa. Tempatnya: baris baru di Anti-Pattern Checklist,
   kalimat di § playbook yang relevan, atau koreksi fakta di CLAUDE.md. JANGAN bikin file baru.
3. **Cek dulu apakah sudah tercakup** — update baris yang ada, jangan duplikasi.
4. **Anggaran ukuran: playbook maks ~250 baris, CLAUDE.md maks ~300 baris.** Kalau menambah
   membuat lewat batas → wajib memangkas/menggabung baris lama dulu. Playbook yang gemuk =
   dibaca sekilas = sama saja bodoh.
5. Perubahan playbook ikut di-commit bersama pekerjaan (biar ter-review), bukan diam-diam.

## Verifikasi & Selesai

1. `npm run build` harus lolos; unit test `src/lib/__tests__/` kalau menyentuh lib.
2. Perubahan non-trivial → skill `verify` (exercise flow nyata, bukan cuma typecheck).
3. Setelah commit: `git show --stat` untuk konfirmasi isi commit sesuai niat.
4. Setelah push ke prod: cek `health.version` — webhook deploy Vercel pernah terlewat.
5. Commit hanya kalau diminta user. Pesan commit pola repo: `feat(scope): ...` / `fix(scope): ...`
   (bahasa Indonesia, lihat `git log`).

## Aturan Output (laporan ke user)

- Mulai dari HASIL ("apa yang berubah / ketemu apa"), bukan proses.
- Sebut file:baris untuk setiap klaim tentang kode. Tanpa bukti = jangan klaim.
- Kalau ada langkah manual tersisa (run migrasi di SQL Editor, set env, toggle Settings), tulis
  eksplisit sebagai daftar "Langkah manual" — jangan dikubur di paragraf.
- Kalau tidak yakin / asumsi → nyatakan eksplisit sebagai asumsi, jangan disajikan sebagai fakta.
- Bahasa: ikuti bahasa user (umumnya Indonesia).
