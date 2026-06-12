-- 082_orders_service_allow_project.sql
-- APPLIED (via MCP, 2026-06-12)
--
-- Izinkan service='Project' di tabel orders. SERVICE_TYPES (frontend) sudah punya
-- "Project" tapi check constraint DB belum → insert order project ditolak.
-- Dipakai oleh panel "Project Berjalan" di Planning Order (assign tim per hari →
-- order type=Project, project_id, ikut konflik + jadwal + bulk dispatch WA).

alter table orders drop constraint if exists orders_service_check;
alter table orders add constraint orders_service_check
  check (service is null or service = any (array['Cleaning','Install','Repair','Complain','Survey','Project']));
