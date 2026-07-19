# AGENT_BENCHMARK.md — Tolok Ukur Protokol untuk Model Non-Fable

Tujuan: mengukur apakah model (Sonnet 5 / Opus 4.8) di sesi BARU otomatis mengikuti
Protokol Eksekusi (CLAUDE.md → docs/AGENT_PLAYBOOK.md) tanpa disuruh, pada tugas tipikal repo ini.

**PENTING:** Brief di bawah sengaja TIDAK menyebut playbook/skill/pola apa pun.
Jangan tambahkan petunjuk saat paste — itu justru yang sedang diuji.

---

## Cara menjalankan

1. Buka sesi Claude Code BARU di repo ini (bukan lanjutan sesi lain).
2. `/model` → pilih model yang diuji (mis. Sonnet 5).
3. Pastikan di branch uji: `git checkout -b benchmark/sonnet-1` (hasil kerja akan dibuang, jangan merge/push).
4. Paste brief di bawah apa adanya.
5. Setelah selesai, isi rubrik. Buang branch: `git checkout main && git branch -D benchmark/sonnet-1`.
6. Migrasi/SQL yang dihasilkan JANGAN dijalankan di Supabase — cukup dinilai di atas kertas.

## Brief (paste verbatim)

```
tolong tambahkan reminder WA otomatis ke saya (owner) tiap hari Jumat jam 16:00 WIB,
isinya daftar invoice yang masih UNPAID lebih dari 3 hari sejak di-approve
(no invoice, nama customer, nominal, umur hari). harus bisa saya matikan/nyalakan
dari Settings seperti reminder lain. jangan commit dulu, saya mau review.
```

---

## Rubrik Penilaian

### A. Proses (60 poin) — apakah protokol diikuti tanpa disuruh

| # | Kriteria | Poin | Skor |
|---|---|---|---|
| A1 | Membaca `docs/AGENT_PLAYBOOK.md` (atau §B-nya) SEBELUM edit pertama | 10 | |
| A2 | Menulis rencana singkat (file yang disentuh + urutan + verifikasi) sebelum edit | 5 | |
| A3 | Task ditaruh di `api/_tasks/` via dispatcher `task=tick` — BUKAN entry cron baru di vercel.json | 10 | |
| A4 | Toggle AND-logic: `isCronJobEnabled(togMap, key)` DAN standalone key `=== "true"`, fetch include `"cron_jobs"` | 10 | |
| A5 | Toggle sync DUA tempat: standalone key + `cron_jobs` JSON, dan muncul di Settings UI | 10 | |
| A6 | Reuse helper existing (sendWA/`_shared`, query pola `reads.js`) — tidak menulis ulang fetch/kirim WA dari nol | 5 | |
| A7 | Jadwal Jumat 16:00 dicek dengan logika WIB yang benar (konsisten dgn task lain di `_tasks/`) | 5 | |
| A8 | Verifikasi dijalankan: minimal `npm run build`; nilai penuh jika exercise flow / pakai skill `verify` | 5 | |

### B. Kualitas hasil & laporan (40 poin)

| # | Kriteria | Poin | Skor |
|---|---|---|---|
| B1 | Definisi "UNPAID >3 hari sejak approve" benar (pakai tanggal approve, bukan created_at; status UNPAID/OVERDUE dipertimbangkan) | 10 | |
| B2 | Tidak menyentuh file di luar kebutuhan; tidak refactor "sambil lewat" | 5 | |
| B3 | Tidak commit (sesuai instruksi brief) | 5 | |
| B4 | Laporan akhir: mulai dari hasil, sebut file:baris, ada daftar "Langkah manual" (backfill key `app_settings`, toggle Settings) | 10 | |
| B5 | Menyebut eksplisit perlunya backfill key toggle di `app_settings` (gotcha task mati senyap) | 10 | |

### C. Metrik efisiensi (catat, tanpa poin)

- Jumlah tool call SEBELUM edit pertama: ____ (target ≤ 8; Fable-baseline isi setelah uji pembanding)
- Durasi total: ____ menit
- Pertanyaan tak perlu ke user: ____ (target 0)
- Salah jalan / edit yang di-revert sendiri: ____ (target 0)

## Interpretasi & keputusan

- **≥ 85** — protokol bekerja; Sonnet layak jadi model eksekusi rutin. Lanjut pakai.
- **65–84** — cek item mana yang gagal. Jika A1/A3/A4 gagal → prosa tidak cukup dipatuhi, naikkan ke
  enforcement (hooks / perkuat deskripsi skill agar auto-trigger). Jika hanya B → tambahkan aturan
  spesifik itu ke playbook.
- **< 65** — model ini jangan dipakai tanpa supervisi untuk tugas sejenis; rutinkan review oleh model
  kuat, atau pecah tugas jadi lebih kecil.

Item paling fatal kalau gagal: **A3, A4, A5** (risiko WA bocor / task mati senyap di produksi).

## Log hasil

| Tanggal | Model | Skor A | Skor B | Total | Catatan |
|---|---|---|---|---|---|
| | | | | | |
