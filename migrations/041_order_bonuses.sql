-- Migration 041: Tabel order_bonuses — komisi per order
-- Dibayar TERPISAH dari payroll, setelah 30–45 hari warranty period.
-- Bisa di-VOID jika customer complain kasus yang sama.

CREATE TABLE IF NOT EXISTS order_bonuses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        text REFERENCES orders(id) ON DELETE SET NULL,
  order_date      date NOT NULL,

  -- Tipe bonus
  bonus_type      text NOT NULL,
  -- 'margin_1jt'   → profit >1jt  → Rp 50.000 / tim
  -- 'margin_2jt'   → profit >2jt  → Rp 100.000 / tim
  -- 'margin_3jt'   → profit >3jt  → Rp 200.000 / tim
  -- 'freon'        → isi freon     → Rp 25.000 / tim
  -- 'kapasitor'    → kapasitor     → Rp 35.000 / tim
  -- 'install_2'    → pasang >2 unit/hari → Rp 100.000 / tim
  -- 'install_3'    → pasang >3 unit/hari → Rp 200.000 / tim
  -- 'install_4'    → pasang >4 unit/hari → Rp 300.000 / tim
  -- 'manual'       → bonus manual dari owner/admin

  -- Untuk tipe margin: simpan data profit
  gross_revenue   numeric,                            -- omset (dari invoice)
  material_cost   numeric,                            -- input manual admin
  profit          numeric GENERATED ALWAYS AS (
    CASE WHEN gross_revenue IS NOT NULL AND material_cost IS NOT NULL
    THEN gross_revenue - material_cost ELSE NULL END
  ) STORED,

  -- Tim yang dapat bonus (nama, dibagi rata)
  team_members    text[] NOT NULL DEFAULT '{}',       -- ['Mulyadi','Rian','Albana']
  member_count    int GENERATED ALWAYS AS (array_length(team_members, 1)) STORED,
  total_amount    numeric NOT NULL DEFAULT 0,         -- total bonus seluruh tim
  amount_per_person numeric GENERATED ALWAYS AS (
    CASE WHEN array_length(team_members, 1) > 0
    THEN total_amount / array_length(team_members, 1)
    ELSE 0 END
  ) STORED,

  note            text,

  -- Status: PENDING → ELIGIBLE → PAID | VOID
  -- PENDING  = dalam masa warranty (<30 hari dari order_date)
  -- ELIGIBLE = sudah >30 hari, siap dibayar
  -- PAID     = sudah dibayarkan
  -- VOID     = dibatalkan (customer complain)
  status          text NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','ELIGIBLE','PAID','VOID')),

  -- Pembayaran (satu per satu, admin/owner checklist)
  paid_at         timestamptz,
  paid_by         text,

  -- Void
  void_reason     text,
  voided_at       timestamptz,
  voided_by       text,

  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_bonuses_order    ON order_bonuses(order_id);
CREATE INDEX IF NOT EXISTS idx_order_bonuses_status   ON order_bonuses(status);
CREATE INDEX IF NOT EXISTS idx_order_bonuses_date     ON order_bonuses(order_date);

COMMENT ON TABLE order_bonuses IS 'Komisi per order. Dibayar terpisah dari payroll setelah 30–45 hari. Bisa VOID jika customer complain.';

-- Auto-update status PENDING → ELIGIBLE setelah 30 hari
-- (dijalankan oleh cron atau trigger)
CREATE OR REPLACE FUNCTION fn_auto_eligible_bonuses()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE order_bonuses
  SET status = 'ELIGIBLE', updated_at = now()
  WHERE status = 'PENDING'
    AND order_date <= CURRENT_DATE - INTERVAL '30 days';
END;
$$;
