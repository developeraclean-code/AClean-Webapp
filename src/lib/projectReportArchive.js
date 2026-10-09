// Laporan reguler yang disalin ke Project tetap ada sebagai jejak historis.
// Migrasi ditandai di edit_log; kehadiran project_id saja bukan bukti arsip.
export const isProjectReportArchive = (report) =>
  Array.isArray(report?.editLog) && report.editLog.some(entry =>
    entry?.field === "project_migration" && entry?.old === "VERIFIED"
  );
