# Prompt Desain Infografis — Cara Pengisian Report Pekerjaan

> **Cara pakai file ini:** dump seluruh isi file ini sebagai prompt ke Claude (design/artifact mode). Ini bukan draft infografisnya — ini BRIEF lengkap supaya AI desain punya semua fakta yang benar tentang alur 4-langkah laporan teknisi di aplikasi, tanpa perlu menebak.

## 1. Peran & Tugas
Anda adalah desainer infografis. Buat **satu infografis compact** (target 1 halaman/1 layar) yang menjelaskan **4 langkah (wizard 4 step)** pengisian Laporan Pekerjaan (service report) oleh teknisi di HP, dari order sampai submit ke Owner/Admin.

## 2. Tujuan
Teknisi/Helper sering bolak-balik bingung kenapa tombol "Lanjut" terkunci, atau lupa mencentang hal yang berdampak ke harga (misal Deep Cleaning). Infografis harus jadi **panduan cepat 1 lihat** yang menjawab: apa yang wajib diisi di tiap step, dan syarat apa yang harus dipenuhi supaya bisa lanjut ke step berikutnya.

## 3. Audiens
**Teknisi & Helper** (pengguna HP di lapangan). Bahasa Indonesia, praktis, checklist-style — bukan paragraf panjang.

## 4. Konteks alur (jangan hilang saat didesain)
- Ini wizard **4 langkah** (Step 1 → 2 → 3 → 4), ada progress bar di app.
- Validasi ketat di tiap step — tombol "Lanjut" akan **diblokir** kalau data belum lengkap. Infografis harus menjelaskan syarat lolos tiap step supaya tim tidak bingung kenapa tidak bisa lanjut.
- Untuk job **Install**: Step 2 (Detail Per Unit) **di-skip otomatis**, langsung ke Step 3 versi "Form Instalasi" (item berbeda dari Cleaning/Repair/Complain). Tandai ini sebagai **cabang khusus** di diagram (mis. anak panah bercabang setelah Step 1).
- Setelah submit di Step 4 → status laporan jadi **SUBMITTED**, dikirim ke Owner/Admin untuk **verifikasi + pembuatan invoice** — bukan langsung final/dibayar.

## 5. STEP 1 — Konfirmasi Unit
- Kalau customer pernah diservis sebelumnya, muncul **kotak referensi riwayat AC** otomatis di atas (tipe unit lalu, kondisi lalu, rekomendasi lalu) — dipakai sebagai contekan, bukan wajib diisi ulang.
- Untuk **setiap unit AC** di order, isi 3 hal **WAJIB** (border hijau kalau sudah terisi benar, merah kalau belum):
  - **Nama Ruangan\*** — posisi unit (mis. "Kamar Utama", "Ruang Tamu"). Ada saran otomatis tapi boleh ketik bebas.
  - **Tipe AC\*** — **WAJIB pilih dari dropdown resmi**, tidak boleh ketik manual, karena ini yang menentukan harga cleaning per PK.
  - **Merk AC\*** — mis. Daikin, Panasonic, Mitsubishi.
  - Model (opsional, kode unit indoor/outdoor).
- Bisa **+ Tambah Unit AC** (maksimal 30 unit) kalau ternyata di lokasi lebih banyak unit dari order asal — Admin otomatis dinotifikasi untuk verifikasi selisih jumlah.
- Untuk customer Maintenance/B2B atau yang sudah punya "Unit Tersimpan" — bisa pilih unit dari daftar tersimpan (tombol 🏢/🔧), otomatis terisi tipe/merk/model tanpa ketik ulang.
- ⚠️ **Syarat lolos ke Step 2:** semua unit harus lengkap Tipe AC (dari dropdown) + Nama Ruangan + Merk — kalau ada yang kurang, sistem akan sebutkan unit mana yang bermasalah.

## 6. STEP 2 — Detail Per Unit (di-skip otomatis untuk job Install)
- Kalau unit lebih dari 1, pilih tab unit yang mau diisi — tab jadi hijau + centang kalau unit itu sudah lengkap.
- Isi **3 checklist** per unit:
  - **⚠️ Kondisi Sebelum** (centang semua yang sesuai): AC Normal · AC Tidak Dingin · AC Bau Tidak Sedap · AC Bocor Air · AC Mampet Karna Lendir/Lumut · AC Bunyi Berisik · AC Tidak Menyala · Freon Habis/Kurang · Kompresor Bermasalah · AC Error.
  - **🔧 Pekerjaan Dilakukan** (centang yang benar-benar dikerjakan) — daftar berbeda sesuai jenis servis (Cleaning/Install/Repair/Complain). Contoh Cleaning: Service Cleaning · **Deep Cleaning (Service Besar)** · Cleaning Indoor dan Outdoor · Kuras Vacum Freon · Penambahan Freon · Bersihkan Drain/Talang · Pemasangan Sparepart · Pekerjaan Lainnya.
    - 🌟 **Highlight khusus:** "Deep Cleaning (Service Besar)" **WAJIB dicentang** kalau memang mengerjakan deep-clean — begitu dicentang, harga jasa unit itu **otomatis** dihitung pakai tarif Jasa Service Besar (bukan tarif cleaning biasa). Kalau lupa centang, harga yang kepakai salah (lebih murah dari seharusnya).
  - **✓ Kondisi Sesudah**: AC Dingin Kembali · AC Masih Terkendala · Perlu Pergantian Sparepart · AC Rusak Perlu Pergantian Unit · Semua Fungsi Normal · Perlu Test Press · Perlu Pengisian/Tambah Freon · Perlu Service Besar · Tidak Melakukan Cek Freon · Tidak Melakukan Cek Ampere.
- Isi 2 angka pengukuran (opsional tapi disarankan): **Tekanan Freon (psi)** dan **Ampere Akhir (A)**.
  - ℹ️ Ini murni catatan teknis untuk riwayat/kartu kesehatan unit — **tidak mempengaruhi tagihan invoice sama sekali**.
- **Catatan Unit** (opsional, teks bebas).
- **Foto khusus unit ini** (opsional — boleh juga foto umum nanti di Step 3).
- ⚠️ **Syarat lolos ke Step 3:** setiap unit harus punya minimal **1 pekerjaan** dicentang, **DAN** minimal 1 kondisi (sebelum ATAU sesudah) dicentang.

## 7. STEP 3 — Material & Foto (untuk Install: "Form Instalasi" khusus, item berbeda)
- Kalau job **Repair** dan sekalian ada unit yang dicuci: centang kotak **"🧽 Tambahan Cleaning"** — harga otomatis dari price list sesuai PK unit.
- **💰 Yang Ditagih ke Customer** (Jasa + Barang) — pilih item dari katalog via "+ Tambah Item," isi jumlah. Ini yang jadi baris invoice. *(Detail lengkap freon/material ada di file terpisah "Cara Input Material.")*
- **📊 Stok Terpakai (Tracking)** — catatan freon/pipa/kabel/sparepart yang dipakai; **tidak masuk invoice**. *(Detail lengkap di file "Cara Input Material.")*
- **📸 Foto Dokumentasi** (umum, maksimal 20 foto total termasuk foto per-unit) — tiap foto bisa dikasih label & ditandai untuk unit tertentu.
- **Rekomendasi untuk Customer** (opsional, teks bebas — akan tampil di laporan yang diterima customer).
- **Catatan ke Admin** (opsional, internal saja — tidak tampil ke customer).
- ⚠️ Tombol "Lanjut" akan **menunggu** kalau masih ada foto sedang upload, dan minta konfirmasi tambahan kalau ada foto yang gagal upload.

## 8. STEP 4 — Ringkasan & Submit
- Cek ringkasan: jumlah unit, kondisi & pekerjaan per unit, material, rekomendasi.
- Kalau job **Complain** dan ternyata perlu perbaikan tambahan (bukan cuma cek garansi) → ada tombol **"🔧 Upgrade ke Job Repair"** yang otomatis bikin job Repair baru terpisah, supaya ada invoice perbaikan sendiri (bukan gratis garansi).
- Tekan **"✓ Submit Laporan"** — sistem akan tampilkan **peringatan** (bukan blokir keras) kalau: unit AC kosong, job Repair tanpa jasa/barang sama sekali (nanti cuma kena Biaya Pengecekan otomatis), atau job Install tanpa detail instalasi diisi.
- Setelah submit → laporan berstatus **SUBMITTED**, dikirim ke Owner/Admin untuk **verifikasi dan pembuatan invoice**. Kalau Admin/Owner mengedit laporan setelah ini, invoice & report card ikut ter-update otomatis.

## 9. Struktur visual yang disarankan
- Format **4 kolom horizontal** (Step 1 → 2 → 3 → 4) atau **4 baris vertikal**, dengan progress bar mengikuti gaya app (garis aksen biru terisi bertahap).
- Tiap step: 1 ikon representatif + 3–5 bullet ringkas + **1 kotak kuning/oranye "⚠️ Syarat Lolos"** kecil di bawahnya, supaya tim langsung tahu kenapa tombol "Lanjut" kadang terkunci.
- 2 highlight box khusus (warna beda, jangan sampai kelewat dibaca):
  - Tipe AC **wajib** pilih dari dropdown resmi (bukan ketik bebas) — karena menentukan harga.
  - "Deep Cleaning (Service Besar)" **wajib** dicentang kalau memang kerja deep-clean — supaya harga otomatis benar.
- Cabang khusus Install ditandai jelas secara visual (anak panah bercabang setelah Step 1, karena Step 2 di-skip untuk Install).
- Compact, dominan ikon + checklist look (mirip tampilan checklist di app itu sendiri), hindari paragraf panjang.

## 10. Di luar scope (jangan dimasukkan)
- Proses verifikasi/edit laporan oleh Owner/Admin di back-office.
- Detail perhitungan harga di balik layar (price list matching, bracket PK, dsb) — cukup disebut "harga dihitung otomatis," tanpa rumus.
