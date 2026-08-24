// Nada warna badge "Kondisi Sesudah" di Service Report Card (HTML & PDF).
// Dulu SEMUA kondisi_setelah dicat HIJAU (positif) — keliru: kondisi bermasalah
// ("AC Masih Terkendala"), perlu-tindak-lanjut ("Perlu Pergantian Sparepart"),
// dan "Tidak Melakukan Cek ..." jadi tampil seolah hasil baik di mata customer.
// Klasifikasikan supaya report card jujur:
//   red     = bermasalah (rusak/terkendala/kompresor)  → merah
//   warn    = perlu tindak lanjut ("Perlu ...")         → kuning
//   neutral = tidak dilakukan cek ("Tidak ..."/"Belum ...") → abu-abu (bukan positif)
//   green   = benar-benar baik (AC dingin kembali, fungsi normal, dll)
import { RED_CONDITIONS, WARN_CONDITIONS } from "./maintenanceHealth.js";

const RED_LC = RED_CONDITIONS.map(s => s.toLowerCase());
const WARN_LC = WARN_CONDITIONS.map(s => s.toLowerCase());

export function condSetelahTone(k) {
  const s = String(k || "").trim().toLowerCase();
  if (!s) return "green";
  if (RED_LC.includes(s) || s.includes("terkendala") || s.includes("bermasalah") || s.includes("rusak")) return "red";
  if (WARN_LC.includes(s) || s.startsWith("perlu ")) return "warn";
  if (s.startsWith("tidak ") || s.startsWith("belum ")) return "neutral";
  return "green";
}
