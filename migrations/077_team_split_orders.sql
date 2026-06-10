-- 077: Team-split orders untuk job maintenance PT yang ramai (4-8 orang).
-- 1 project dipecah jadi beberapa sub-order paralel di hari sama, tiap sub-order
-- = 1 pasangan teknisi+helper + subset unit. Dimensi terpisah dari multi-DAY
-- (is_multi_day) supaya label & logika invoice tidak bentrok.
--
-- Konvensi grup:
--   - Semua anggota grup punya job_group_id = id parent (sub-order pertama).
--   - Parent = order dgn id === job_group_id. Anak = id !== job_group_id.
--   - is_team_split = true untuk semua anggota grup.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS job_group_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_team_split boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_job_group_id ON orders (job_group_id) WHERE job_group_id IS NOT NULL;

COMMENT ON COLUMN orders.job_group_id IS 'Penanda grup tim-split: semua sub-order 1 project share nilai ini (= id parent). Parent: id === job_group_id.';
COMMENT ON COLUMN orders.is_team_split IS 'true bila order bagian dari project tim-split (maintenance PT ramai). Beda dimensi dari is_multi_day.';
