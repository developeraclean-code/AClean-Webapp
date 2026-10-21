// Do not diagnose a missing migration from a generic database/network timeout.
export function dashboardReadError(error) {
  const code = String(error?.code || error?.status || '');
  const raw = String(error?.message || '');
  if (['PGRST202','42883'].includes(code)) return {
    kind: 'missing_function', message: 'Fungsi rekap belum tersedia di database. Periksa penerapan migrasi rekap Dashboard.', code,
  };
  if (code === '57014' || /statement timeout|APP_READ_TIMEOUT/i.test(raw)) return {
    kind: 'timeout', message: 'Query rekap melewati batas waktu. Data belum berhasil dimuat; ini bukan tanda migrasi hilang.', code: code || 'TIMEOUT',
  };
  if (['42501','401','403','PGRST301'].includes(code)) return {
    kind: 'access', message: 'Akses rekap belum diizinkan atau sesi berakhir. Periksa akun dan hak akses.', code,
  };
  if (['429','502','503','504','APP_READ_PAUSED','APP_READ_NETWORK','APP_READ_QUEUE_TIMEOUT','APP_READ_QUEUE_FULL'].includes(code)
    || /failed to fetch|network|connection|timeout|aborted/i.test(raw)) return {
    kind: 'unavailable', message: 'Layanan data sedang lambat/terputus. Tunggu layanan pulih sebelum mencoba lagi.', code: code || 'NETWORK',
  };
  return { kind: 'unknown', message: 'Rekap belum berhasil dimuat. Periksa koneksi atau laporkan kode error jika berulang.', code: code || 'UNKNOWN' };
}
