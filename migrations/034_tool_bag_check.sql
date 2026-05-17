-- ═══════════════════════════════════════════════════════════
-- Migration 034: Tas Teknisi (Tool Bag Check)
-- Identifier: Tas 1 .. Tas 10 (bukan nama teknisi — agar fleksibel saat pergantian orang)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tool_bag_checklist (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bag_id      text NOT NULL,           -- "Tas 1", "Tas 2", ..., "Tas 10"
  tool_name   text NOT NULL,
  qty_min     int  NOT NULL DEFAULT 1,
  is_priority boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(bag_id, tool_name)
);

CREATE TABLE IF NOT EXISTS tool_bag_checks (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bag_id          text NOT NULL,
  session_type    text NOT NULL CHECK (session_type IN ('pagi','pulang')),
  checked_at      timestamptz DEFAULT now(),
  photo_url       text,
  sender_phone    text NOT NULL,
  ai_raw_response text,
  tools_found     jsonb DEFAULT '[]',
  tools_missing   jsonb DEFAULT '[]',
  status          text NOT NULL DEFAULT 'OK'
                  CHECK (status IN ('OK','WARNING','CRITICAL','ERROR')),
  warning_sent    boolean DEFAULT false,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tbc_bag    ON tool_bag_checks(bag_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_tbc_status ON tool_bag_checks(status, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_tbc_date   ON tool_bag_checks(checked_at DESC);

ALTER TABLE tool_bag_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_bag_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_full" ON tool_bag_checks;
CREATE POLICY "service_full" ON tool_bag_checks USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "service_full" ON tool_bag_checklist;
CREATE POLICY "service_full" ON tool_bag_checklist USING (true) WITH CHECK (true);

-- ─── SEED: 24 alat untuk Tas 1 - Tas 10 ───
DO $$
DECLARE
  bag_num int;
  bag_id_text text;
  tools jsonb := '[
    {"name":"Tang Ampere","qty_min":1,"is_priority":true},
    {"name":"Manifold","qty_min":1,"is_priority":true},
    {"name":"Kunci Inggris Ukuran 10","qty_min":1,"is_priority":false},
    {"name":"Kunci Inggris Ukuran 8","qty_min":1,"is_priority":false},
    {"name":"Kunci L Set","qty_min":1,"is_priority":false},
    {"name":"Palu","qty_min":1,"is_priority":false},
    {"name":"Pahat","qty_min":1,"is_priority":false},
    {"name":"Tang Lancip","qty_min":1,"is_priority":false},
    {"name":"Tang Kombinasi","qty_min":1,"is_priority":false},
    {"name":"Tang Potong","qty_min":1,"is_priority":false},
    {"name":"Obeng Standar","qty_min":1,"is_priority":false},
    {"name":"Obeng Cebol","qty_min":1,"is_priority":false},
    {"name":"Obeng Minus","qty_min":1,"is_priority":false},
    {"name":"Water Pass","qty_min":1,"is_priority":false},
    {"name":"Meteran Roll 5 Meter","qty_min":1,"is_priority":false},
    {"name":"Flaring Tool","qty_min":1,"is_priority":false},
    {"name":"Cutter Pipa AC","qty_min":1,"is_priority":false},
    {"name":"Mata Las Hicook","qty_min":1,"is_priority":false},
    {"name":"Kunci Pas 10","qty_min":1,"is_priority":false},
    {"name":"Kunci Pas 12","qty_min":1,"is_priority":false},
    {"name":"Kabel Roll","qty_min":1,"is_priority":false},
    {"name":"Test Pen Kecil","qty_min":1,"is_priority":false},
    {"name":"Gergaji Besi","qty_min":1,"is_priority":false},
    {"name":"Cutter Standar","qty_min":1,"is_priority":false}
  ]';
  tool jsonb;
BEGIN
  FOR bag_num IN 1..10 LOOP
    bag_id_text := 'Tas ' || bag_num;
    FOR tool IN SELECT * FROM jsonb_array_elements(tools) LOOP
      INSERT INTO tool_bag_checklist (bag_id, tool_name, qty_min, is_priority)
      VALUES (bag_id_text, tool->>'name', (tool->>'qty_min')::int, (tool->>'is_priority')::boolean)
      ON CONFLICT (bag_id, tool_name) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO app_settings (key, value) VALUES
  ('tool_bag_check_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
