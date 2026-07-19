---
name: distill
description: Destilasi pelajaran sesi ini ke docs/AGENT_PLAYBOOK.md / CLAUDE.md agar sistem terus belajar. Jalankan di AKHIR tugas ketika ada asumsi yang ternyata salah, gotcha baru, insiden/bug produksi + akarnya, atau fakta dokumentasi yang ketahuan basi. Juga saat user bilang "catat pelajarannya" / "update playbook".
---

# Distill — tulis pelajaran sesi ini ke playbook

Tujuan: pelajaran non-obvious dari sesi ini tidak hilang saat sesi berakhir. Model tidak punya
ingatan antar sesi — SATU-SATUNYA cara sistem ini "belajar" adalah menulis pelajaran ke repo.

## Langkah

1. **Kumpulkan kandidat pelajaran dari sesi ini.** Scan percakapan/diff untuk:
   - Klaim yang sempat salah lalu dikoreksi (oleh user, oleh verifikasi, oleh error)
   - Perilaku library/API/DB yang tidak terduga dan menghabiskan waktu
   - Akar bug yang baru ditemukan (bukan gejalanya)
   - Fakta CLAUDE.md / AGENT_PLAYBOOK.md / memory yang ternyata beda dengan kode nyata
   Kalau TIDAK ada satupun → laporkan "tidak ada pelajaran baru" dan BERHENTI. Jangan mengarang
   pelajaran demi terlihat produktif.

2. **Saring dengan 3 uji.** Sebuah kandidat layak masuk hanya jika LOLOS SEMUA:
   - **Terverifikasi**: ada bukti (file:baris, hasil query, output reproduksi) — bukan dugaan.
   - **Akan terulang**: relevan untuk tugas masa depan, bukan kejadian satu kali.
   - **Non-obvious**: tidak bisa diturunkan dari membaca kode 2 menit. (Struktur kode, isi git
     log, hal yang sudah tercakup dokumen = TIDAK layak.)

3. **Cek duplikasi**: grep AGENT_PLAYBOOK.md + CLAUDE.md untuk topik terkait. Sudah tercakup →
   perbaiki/pertajam baris yang ada, jangan tambah baris baru.

4. **Tulis di tempat yang tepat** (jangan bikin file baru):
   - Jebakan kode/API → baris baru di tabel **Anti-Pattern Checklist** (AGENT_PLAYBOOK.md)
   - Aturan proses per tipe tugas → § playbook yang relevan (A–F)
   - Fakta repo yang basi → koreksi langsung di CLAUDE.md
   - Format: padat, imperatif, sertakan "karena" singkat. Tanggal relatif → absolut.

5. **Jaga anggaran ukuran**: playbook maks ~250 baris, CLAUDE.md maks ~300 baris (`wc -l`).
   Lewat batas → gabungkan/pangkas baris lama yang paling jarang relevan SEBELUM menambah.

6. **Tunjukkan diff-nya ke user** di laporan akhir (pelajaran apa, ditaruh di mana, apa yang
   dipangkas). Perubahan ikut alur commit pekerjaan — jangan commit sendiri tanpa diminta.
