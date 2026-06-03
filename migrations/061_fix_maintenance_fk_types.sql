-- Migration 061: fix tipe kolom referensi maintenance.
-- orders.id & customers.id bertipe TEXT (mis. "JOB-xxx"), bukan uuid.
-- Migrasi 059 awal keliru memberi uuid → diperbaiki ke text.
-- Aman: kolom masih kosong saat fix ini dijalankan.

ALTER TABLE maintenance_logs    ALTER COLUMN order_id    TYPE text USING order_id::text;
ALTER TABLE maintenance_clients ALTER COLUMN customer_id TYPE text USING customer_id::text;
