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
4. **Kunci RLS wajib DISIMULASIKAN sebagai sesi asli, bukan dibaca saja** — di dalam
   `BEGIN; set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>"}'; ... ROLLBACK;`
   Uji DUA sisi: serangan (harus ditolak) DAN kerja normal (harus tetap lolos), lalu SELECT
   ulang untuk membuktikan rollback bersih. 25 Agu 2026 simulasi ini menangkap cacat rancangan
   sendiri: `WITH CHECK` yang memaksa nilai akhir (`confirm_status = 'PENDING'`) menolak UPDATE
   yang memang tidak menyertakan kolom itu di payload — teknisi jadi tak bisa menyunting barisnya
   sendiri. Aturan turunannya: **`WITH CHECK` untuk menyaring BARIS, arah perpindahan nilai
   diserahkan ke trigger** (trigger bisa banding OLD vs NEW, `WITH CHECK` tidak).
5. Setelah applied: update daftar migrasi di CLAUDE.md.
6. Kolom baru dipakai frontend? Cek daftar kolom di `reads.js`/`writes.js` (mis. `INVOICE_COLS`) —
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
| Filter `.in("status", [...])` / enum lain dengan nilai hasil TEBAKAN | `orders.status` dkk tidak punya CHECK constraint — nilai karangan tidak error, cuma mengembalikan 0 baris SELAMANYA. Insiden 25 Agu 2026: dropdown "Link ke Job" & kandidat job AI vision memakai `SCHEDULED/IN_PROGRESS/ON_SITE/WORKING/DONE` — kelimanya TIDAK PERNAH ADA (0 baris sepanjang riwayat), jadi fitur mati sejak lahir & terbaca sebagai "tidak ada data". Nilai nyata: `PENDING, CONFIRMED, REPORT_SUBMITTED, INVOICE_APPROVED, COMPLETED, PAID, CANCELLED`. Sebelum menulis whitelist: `SELECT status, count(*) FROM <tabel> GROUP BY 1` — dan lebih aman pakai blacklist (`.neq("status","CANCELLED")`) daripada whitelist |
| Menentukan KATEGORI dari nama (`classifyMaterial(nama)`) di jalur stok/uang | Nama tidak selalu menyebut jenisnya → salah kategori = lolos gerbang. Insiden 25 Agu 2026: baris hasil Link-ke-Job bernama `"A4"` (aslinya pipa) → `classifyMaterial("A4") === "lain"` → lolos `dropHarian` → nyaris dipotong DUA KALI (sekali lewat laporan, sekali lewat Konfirmasi Material). Selamat cuma karena "A4" kebetulan tak cocok nama inventory mana pun. Pakai `isHarianManagedItem()` (`materialRecon.js`) yang **mendahulukan `material_type` eksplisit**, tebakan nama hanya cadangan; dan saat menulis baris baru, isi nama yang menyebut jenisnya ("Pipa A4") |
| Atribusi entity pakai `array[0]` (mis. `order_id: row.job_ids[0]`) | Diam-diam benar saat isinya 1, diam-diam SALAH saat 0 atau >1 — tanpa error. Audit 25 Agu 2026: 16 dari 38 sesi material memotong stok dengan `job_ids` KOSONG → `order_id` NULL (42% potongan tanpa keterangan job), sisanya menempel ke 1 job padahal teknisi rata-rata 2,33 job/hari. Kalau relasinya jamak, minta pembagian eksplisit (lihat `src/lib/materialSplit.js`) dan tulis satu baris per relasi |
| Memakai `inventory.price` sebagai biaya/HPP | `price` = harga **JUAL** (fallback material ke invoice, `pricing.js:302`) dan nilainya **0 di SELURUH 27 item** (terverifikasi 28 Agu 2026) — itu sebabnya "Total Cost" laporan pipa/kabel/freon di MatTrack selalu Rp 0 tanpa error. Harga beli ada di kolom terpisah `inventory.purchase_price` (HPP, rata-rata bergerak — `src/lib/hpp.js`). Sebelum mengalikan kolom harga dengan qty, cek dulu `SELECT count(*) FILTER (WHERE <kolom> > 0)` — kolom yang isinya nol semua bikin fitur mati diam-diam |
| Menaruh kolom bernilai UANG di tabel tanpa memeriksa `pg_policies` tabel itu dulu | Beberapa tabel operasional cuma punya policy **blanket** `FOR ALL USING (auth.role() = 'authenticated')` tanpa pembedaan role — artinya Teknisi/Helper pun bisa UPDATE. Terbukti 28 Agu 2026: `inventory_all` membuat teknisi bisa `UPDATE inventory SET purchase_price=1` (1 baris terubah), padahal HPP itu dasar bonus margin. Cek `SELECT policyname, cmd, qual FROM pg_policies WHERE tablename='<t>'` SEBELUM menambah kolom uang. Kalau kolom lain di tabel itu harus tetap bisa ditulis role rendah (mis. `stock` dipotong saat teknisi submit laporan), kuncinya **trigger per-kolom** (`trg_guard_inventory_price`, migrasi 154), bukan mempersempit policy |
| Menghitung pemakaian material pakai `qty_actual ?? qty` | Koreksi timbang freon menulis **DUA** baris: baris asli di-set `qty_actual = -aktual` DAN dibuat baris `adjustment` berisi selisihnya (`MatTrackView.jsx:735`). Menjumlahkan `qty_actual ?? qty` = koreksi terhitung dua kali. Pemakaian bersih = **Σ `qty`** saja (konsisten dgn pergerakan stok) — lihat `netUsageByItem()` di `src/lib/hpp.js` |
| Memanggil AI provider tanpa mencatat ke `ai_usage` | Biaya jadi "gelap" — Monitoring cuma melihat sebagian. Audit 29 Agu 2026: **6 dari 10** titik panggilan Anthropic tak mencatat (4 di `_handlers/wa.js`, `_tool-bag-vision.js`, `_handlers/misc.js`); yang tercatat hanya $3,53 dari perkiraan ~$5 belanja Agustus. Setiap `fetch` ke `api.anthropic.com` WAJIB diikuti `logAiUsageRest()` (`api/_logger.js`) — fail-silent, tidak memblok webhook |
| Menambah model AI tanpa entri di `AI_PRICING` (`api/_logger.js`) | Model tak dikenal jatuh ke `_default` ($1/$5) → biaya tercatat SALAH tanpa error. Terbukti 29 Agu 2026: `claude-opus-4-7` tertulis $15/$75 (aslinya $5/$25, 3× lebih tinggi) dan `opus-5`/`sonnet-5` tidak ada sama sekali. Tabel harga = SATU tempat di `_logger.js`; jangan duplikasi konstanta harga di modul lain (dulu `_ai-vision.js` punya salinan sendiri) |
| Mengandalkan prompt caching di Haiku 4.5 | Minimum prefix cache Haiku 4.5 = **4096 token**; prompt di bawah itu **gagal cache diam-diam** (`cache_creation_input_tokens: 0`, tanpa error). System prompt `_ai-vision.js` ~1.612 token → caching mustahil di sana. Verifikasi lewat `usage.cache_read_input_tokens`, jangan diasumsikan |
| Menyusun prompt statis padahal fiturnya di-toggle per grup/user | Blok aturan untuk intent yang OFF tetap terkirim dan dibayar, padahal hasilnya dibuang gate `ai_*_enabled` di `persistClassification()`. Audit 29 Agu 2026: 56% token input `wa-group-vision` adalah system prompt. `buildPrompt()` kini menyusun aturan + field HANYA dari intent aktif (−63% token utk grup 1-intent). Prompt yang bercabang harus ikut bercabang isinya, bukan cuma daftar intentnya |
| Menganggap mematikan satu toggle AI = panggilan berhenti | Gerbangnya `anyAiOn` (`_handlers/wa.js:1006`) = OR dari ketiga toggle — panggilan baru berhenti kalau **semua** intent grup itu OFF. Mematikan 1 dari 3 hanya mengubah hasil klasifikasi (jadi `unknown`), biaya tetap jalan. Sebelum menjanjikan penghematan, cek gerbang mana yang benar-benar memutus `fetch` |
| `parseAmt()` (api/_ai-vision.js) untuk qty | Fungsi itu membuang SEMUA non-digit karena dirancang untuk rupiah → `"4,8 kg"` jadi 48, `"1,0 PCS"` jadi 10. Qty material justru sering pecahan (freon 0,7 kg). Pakai `parseQty()` di file yang sama |
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
4. Setelah push ke prod: cek `curl -s <prod>/api/health | jq -r .version` dan **bandingkan
   dengan `git rev-parse --short HEAD`** — webhook deploy Vercel pernah terlewat. Menunggu
   endpoint membalas `200` TIDAK membuktikan apa-apa: deploy lama tetap melayani 200 selama
   build berjalan (kejadian 28 Agu 2026 — loop `until 200` berhenti seketika dan sempat
   melaporkan versi lama sebagai "sudah live"). Yang ditunggu = `version` berubah.
5. Commit hanya kalau diminta user. Pesan commit pola repo: `feat(scope): ...` / `fix(scope): ...`
   (bahasa Indonesia, lihat `git log`).

## Aturan Output (laporan ke user)

- Mulai dari HASIL ("apa yang berubah / ketemu apa"), bukan proses.
- Sebut file:baris untuk setiap klaim tentang kode. Tanpa bukti = jangan klaim.
- Kalau ada langkah manual tersisa (run migrasi di SQL Editor, set env, toggle Settings), tulis
  eksplisit sebagai daftar "Langkah manual" — jangan dikubur di paragraf.
- Kalau tidak yakin / asumsi → nyatakan eksplisit sebagai asumsi, jangan disajikan sebagai fakta.
- Bahasa: ikuti bahasa user (umumnya Indonesia).
