# Pemulihan penerimaan grup WhaCenter — 16 November 2026

## Perubahan

Format webhook terbaru WhaCenter memakai `is_group`, `id_group`, `from`,
`pushName` dan `message_type`. Sebelumnya grup dapat masuk sebagai chat pribadi,
sehingga whitelist/parser biaya/AI grup tidak dijalankan. Normalizer sekarang
memetakan format tersebut ke jalur grup AClean yang sudah ada. Field identitas
baru disimpan secara terbatas pada payload receipt. URL media signed dengan
parameter `path` dikenali sebagai gambar, PDF, audio atau video sesuai format.

LID tidak ditebak menjadi nomor telepon. Grup tanpa ID yang valid dan anggota
dengan identitas belum jelas dihentikan setelah receipt tersimpan, sebelum
lookup/proses bisnis. Whitelist grup dan pemeriksaan profil staf aktif tetap
berlaku. Log penerimaan menambah boolean grup/anggota/review untuk diagnosis,
tanpa menambahkan nomor, caption, atau URL privat ke log baru.

Patch tidak memerlukan migrasi, tidak mengubah toggle/grup, dan tidak replay
pesan atau biaya historis. Callback delivered/read, ID respons send, sinkronisasi
grup, typing dan MCP adalah pekerjaan terpisah dari patch ini.

## Verifikasi lokal

- 1.842 tes pada 161 file lulus, termasuk normalisasi payload resmi, caption
  biaya, bon melalui Vision ke expense PENDING_AI, duplikasi webhook,
  whitelist/profil staf, LID, jenis media, dan regresi Fonnte/WABLAS.
- Lint, typecheck, build, check:migrations dan test:cutover-routes lulus.
- Tes memakai fetch/AI/R2 sintetis, tanpa pesan WA, panggilan AI atau transaksi
  produksi. Kode AI/persist biaya yang sama dipakai pada uji handler.
- Basis patch origin/main `87ce144` (perubahan dari build produksi `196cfdc`
  hanya catatan/bukti rilis FSM); worktree user tidak diubah.

## Status rilis

Kandidat disiapkan pada branch `codex/whacenter-group-webhook-20261116`.
Staging dan produksi belum dinyatakan memakai patch sampai deploy dan hash
file runtime diverifikasi. Source Coolify staging yang dibaca sebelum rilis
masih branch FSM/pin `28f930a`; produksi branch main/pin `196cfdc`. Auto-deploy
keduanya OFF. Jangan menganggap push mengubah pin atau runtime Coolify.

## Uji saat operasional berjalan

Setelah kandidat staging lulus dan rilis production terverifikasi:

1. Kirim satu pesan teks biasa baru di AClean Grup, misalnya `cek grup
   WhaCenter`. Periksa receipt dikenali grup dan log grup muncul; pesan ini
   tidak menyatakan pengeluaran atau perintah bisnis.
2. Pada bon baru melalui pekerjaan normal, pastikan receipt grup, log grup,
   draft biaya PENDING_AI, nominal/kategori/nama dan foto benar. Caption seperti
   `Bensin 20k motor Rey` memakai parser teks dan dapat sengaja melewati Vision.
3. Review manusia tetap diperlukan sebelum persetujuan biaya. Jangan kirim
   ulang bon Rey 14 November atau melakukan backfill massal sebagai uji.
4. Bila receipt tidak masuk sama sekali, periksa forwarding webhook grup di
   sisi WhaCenter; perbaikan normalizer tidak menciptakan callback yang tidak
   dikirim provider.
