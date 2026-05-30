// Jenis layanan utama yang tampil di form order, filter invoice, dropdown.
// Maintenance tidak termasuk di sini karena hanya muncul di beberapa konteks
// (cek PRICE_LIST_DEFAULT.Maintenance untuk harganya).
// Project = order untuk pekerjaan project (lihat modul Project). Laporan harian
// & keuangannya dikelola di modul Project, bukan di Laporan Tim utama.
export const SERVICE_TYPES = ["Cleaning", "Install", "Repair", "Complain", "Survey", "Project"];
