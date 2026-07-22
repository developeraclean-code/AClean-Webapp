// Indonesia timezone (UTC+7) helpers.
const OFFSET_MS = 7 * 60 * 60 * 1000;

export const getLocalDate = () =>
  new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);

export const getLocalDateObj = () =>
  new Date(Date.now() + OFFSET_MS);

export const getLocalISOString = () =>
  new Date(Date.now() + OFFSET_MS).toISOString();

// Sisa hari menuju `dateStr` (negatif = sudah lewat). null bila tanggal kosong.
// Di lib bersama supaya MaintenanceView & modal laporan pakai definisi yang SAMA
// tanpa saling impor (impor dari MaintenanceView akan menyeret view 3.9k baris itu
// ke bundle modal laporan & merusak code-splitting).
export const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
};

export const isWorkingHours = () => {
  // Parse ISO string to extract local (UTC+7) date/time components
  const iso = new Date(Date.now() + OFFSET_MS).toISOString();
  const localHour = parseInt(iso.slice(11, 13));
  const localMinute = parseInt(iso.slice(14, 16));
  // Separate date calc: determine local day of week
  const localDate = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const localDay = new Date(localDate.getTime() + OFFSET_MS).getUTCDay();
  const timeMinutes = localHour * 60 + localMinute;
  return localDay >= 1 && localDay <= 6 && timeMinutes >= 480 && timeMinutes < 1140;
};
