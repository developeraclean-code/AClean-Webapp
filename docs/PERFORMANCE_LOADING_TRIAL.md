# Trial Performa Loading AClean

Status: **lokal dahulu**. Migration `167_dashboard_snapshot_rpc.sql` belum boleh
diterapkan ke production sebelum angka dan tampilan Dashboard disetujui.

## Perubahan

- Login menunggu dataset kritis saja: order 14 hari terakhir + 60 hari ke depan,
  invoice 14 hari terakhir + seluruh invoice actionable, laporan 14 hari terakhir
  + seluruh antrean `SUBMITTED/REVISION`, inventory, settings, dan user profile.
- Riwayat besar dimuat satu kali ketika menu terkait dibuka.
- Konfigurasi LLM hanya dimuat saat membuka ARA atau Pengaturan.
- Dashboard memakai RPC `get_dashboard_snapshot` untuk mengganti lima full-fetch.
  Selama migration 167 belum aktif, UI otomatis memakai fallback lama.

## Melihat instrumentasi

Buka DevTools → Console, lalu jalankan:

```js
console.table(window.__ACLEAN_PERF__)
```

Metrik utama:

- `bootstrap.session_check`: validasi sesi.
- `bootstrap.critical`: waktu sampai app siap dipakai.
- `bootstrap.background`: settings/data pendukung selesai.
- `dashboard.snapshot_rpc`: waktu satu RPC Dashboard.
- `view_data.*`: waktu data penuh sebuah menu saat pertama dibuka.

## Baseline dan target

| Indikator | Sebelum | Trial lokal | Target setelah RPC aktif |
|---|---:|---:|---:|
| Bootstrap data sampai siap | 12.266 ms | 2.111 ms | < 3.000 ms |
| Waktu klik login sampai siap | — | 3.768 ms | < 5.000 ms |
| Payload sampai siap | 12,7 MB | 1,25 MB | < 1,5 MB |
| Request sampai siap | 39 | 16 | < 20 |

Catatan: benchmark lokal memakai koneksi nyata ke Supabase. Selama migration 167
belum aktif, panel analitik akan memuat fallback lama **setelah** bootstrap siap;
fallback ini tidak menahan interaksi pengguna.

## Gate sebelum main

1. Jalankan migration 167 di transaksi dan cek role Owner/Admin.
2. Bandingkan angka Dashboard RPC dengan Dashboard live lama untuk bulan berjalan
   dan enam bulan terakhir.
3. Pastikan login, Planning Order, Invoice, Customer, Inventory, Tim Teknisi, dan
   Statistik lolos smoke test.
4. Push ke `main` hanya bila selisih angka = 0 dan p95 bootstrap < 5 detik.
