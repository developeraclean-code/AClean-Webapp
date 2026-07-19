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
   pernah ada nomor dobel — jangan diulang).
2. **RLS wajib dipikirkan di migrasi yang sama**, bukan menyusul:
   - Policy `TO authenticated` (user login via signInWithPassword), BUKAN `anon` — gotcha klasik.
   - Tabel finansial → role-tier Owner/Admin/Finance (contoh: migrasi 119).
   - Teknisi hanya baris miliknya → pakai helper `is_my_job(job_id)` / `get_my_role()` (migrasi 117).
3. Migrasi dijalankan MANUAL di Supabase SQL Editor — tulis idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`).
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
| Query tanpa paginasi untuk data besar | PostgREST cap 1000 baris → `.range()` loop |
| Validasi foto by MIME/ekstensi | Android salah-label JPEG→mp4 → validasi content-based (canvas decode) |
| Toggle cron satu lapis | WA bocor saat OFF → AND-logic (lihat §B) |
| Edit `jenis servis` order | SOP: hapus & buat ulang |
| Konflik jadwal ±1 jam flat | Pakai durasi aktual (`hasConflict`/`cekTeknisiAvailableDB`) |
| Nomor HP format bebas | Selalu `normalizePhone()` → `628xxx` |
| Cron entry baru di vercel.json | Dispatcher `task=tick` (lihat §B) |
| PDF dari state lokal | State basi → refetch baris segar sebelum generate/kirim PDF |
| Delete user via Supabase client | Tidak ada RLS policy → `/api/manage-user` |

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
