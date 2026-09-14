-- 170 — Satu sumber kebenaran untuk audit kirim dokumen dan mutasi stok material.
--
-- A. Marker Invoice / Report Card hanya ditulis SETELAH provider WA mengembalikan sukses.
--    Increment dilakukan di PostgreSQL agar dua pengiriman bersamaan tidak kehilangan hitungan.
-- B. Konfirmasi dan buka-koreksi Material Harian menjadi satu transaksi database:
--    status sesi, ledger inventory_transactions, dan inventory_units.stock sukses semua
--    atau rollback semua. Tidak ada lagi sesi CONFIRMED tanpa potongan stok.
-- C. Tambah/edit/restock master material biasa memakai ledger sebagai sumber mutasi stok.

BEGIN;

-- ── A. Audit pengiriman dokumen ────────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS wa_last_sent_by text,
  ADD COLUMN IF NOT EXISTS wa_last_sent_method text;

ALTER TABLE public.service_reports
  ADD COLUMN IF NOT EXISTS report_card_sent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_card_last_sent_mode text,
  ADD COLUMN IF NOT EXISTS report_card_last_sent_method text;

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS source_transaction_id bigint
    REFERENCES public.inventory_transactions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_source_transaction
  ON public.inventory_transactions(source_transaction_id)
  WHERE source_transaction_id IS NOT NULL;

-- Rapikan marker lama hanya dari timestamp audit yang memang sudah ada. Kolom `sent`
-- sengaja tidak dijadikan dasar karena versi lama pernah mengisinya saat approve saja.
UPDATE public.invoices
   SET sent = true,
       sent_at = coalesce(sent_at, wa_last_sent_at),
       wa_sent_count = CASE WHEN coalesce(wa_sent_count, 0) = 0 THEN 1 ELSE wa_sent_count END
 WHERE wa_last_sent_at IS NOT NULL;

UPDATE public.service_reports
   SET report_card_sent_count = 1,
       report_card_last_sent_mode = coalesce(report_card_last_sent_mode, 'legacy')
 WHERE report_card_sent_at IS NOT NULL
   AND report_card_sent_count = 0;

CREATE OR REPLACE FUNCTION public.record_invoice_wa_sent(
  p_invoice_ids text[],
  p_mode text DEFAULT 'single',
  p_batch text DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_method text DEFAULT 'fonnte'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_role text;
  actor_name text;
  result jsonb;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','Finance','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin/Finance yang dapat mencatat pengiriman invoice' USING ERRCODE = '42501';
  END IF;
  IF coalesce(array_length(p_invoice_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Invoice ID wajib diisi';
  END IF;
  IF p_mode NOT IN ('single','merged','reminder','approval') THEN
    RAISE EXCEPTION 'Mode pengiriman invoice tidak valid';
  END IF;
  IF nullif(trim(p_method), '') IS NULL THEN RAISE EXCEPTION 'Metode pengiriman invoice wajib diisi'; END IF;

  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name), ''), actor_role);

  WITH changed AS (
    UPDATE public.invoices i
       SET sent = true,
           sent_at = now(),
           wa_sent_count = coalesce(i.wa_sent_count, 0) + 1,
           wa_last_sent_at = now(),
           wa_last_sent_mode = p_mode,
           wa_last_sent_batch = p_batch,
           wa_last_sent_by = actor_name,
           wa_last_sent_method = lower(trim(p_method))
     WHERE i.id = ANY(p_invoice_ids)
     RETURNING i.*
  )
  SELECT coalesce(jsonb_agg(to_jsonb(changed)), '[]'::jsonb) INTO result FROM changed;

  IF jsonb_array_length(result) <> array_length(p_invoice_ids, 1) THEN
    RAISE EXCEPTION 'Sebagian invoice tidak ditemukan; audit dibatalkan';
  END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.record_invoice_wa_sent(text[],text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_wa_sent(text[],text,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_report_card_wa_sent(
  p_report_id uuid,
  p_mode text DEFAULT 'single',
  p_actor_name text DEFAULT NULL,
  p_method text DEFAULT 'fonnte'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_role text;
  actor_name text;
  result jsonb;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mencatat pengiriman Report Card' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('single','invoice_view','schedule') THEN
    RAISE EXCEPTION 'Mode pengiriman Report Card tidak valid';
  END IF;
  IF nullif(trim(p_method), '') IS NULL THEN RAISE EXCEPTION 'Metode pengiriman Report Card wajib diisi'; END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name), ''), actor_role);

  UPDATE public.service_reports r
     SET report_card_sent_at = now(),
         report_card_sent_by = actor_name,
         report_card_sent_count = coalesce(r.report_card_sent_count, 0) + 1,
         report_card_last_sent_mode = p_mode,
         report_card_last_sent_method = lower(trim(p_method)),
         updated_at = now()
   WHERE r.id = p_report_id
   RETURNING to_jsonb(r) INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Service Report tidak ditemukan'; END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.record_report_card_wa_sent(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_report_card_wa_sent(uuid,text,text,text) TO authenticated, service_role;

-- ── B. Konfirmasi Material Harian atomik ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_material_checkout_atomic(
  p_session_id uuid,
  p_movements jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_session_items jsonb DEFAULT NULL,
  p_admin_adjustments jsonb DEFAULT '[]'::jsonb,
  p_confirm_notes text DEFAULT NULL,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_role text;
  actor_name text;
  sess public.teknisi_material_checkout%ROWTYPE;
  movement jsonb;
  tx_id bigint;
  tx_ids jsonb := '[]'::jsonb;
  qty_value numeric;
  unit_uuid uuid;
  unit_row public.inventory_units%ROWTYPE;
  inventory_name_value text;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengonfirmasi material' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_movements, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Daftar mutasi material tidak valid';
  END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name), ''), actor_role);

  SELECT * INTO sess FROM public.teknisi_material_checkout
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesi material tidak ditemukan'; END IF;
  IF sess.session_type NOT IN ('pulang','pakai') THEN RAISE EXCEPTION 'Jenis sesi tidak dapat dikonfirmasi'; END IF;
  IF sess.confirm_status <> 'PENDING' THEN RAISE EXCEPTION 'Sesi sudah diproses oleh pengguna lain'; END IF;
  IF p_expected_updated_at IS NOT NULL AND sess.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Sesi berubah sejak dibuka; muat ulang sebelum konfirmasi';
  END IF;
  IF jsonb_array_length(coalesce(sess.deduct_tx_ids, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'Sesi sudah memiliki transaksi pemotongan';
  END IF;

  FOR movement IN SELECT value FROM jsonb_array_elements(coalesce(p_movements, '[]'::jsonb)) LOOP
    unit_row := NULL;
    BEGIN
      qty_value := round((movement->>'qty')::numeric, 3);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Qty mutasi material tidak valid';
    END;
    IF qty_value <= 0 THEN RAISE EXCEPTION 'Qty mutasi material harus lebih dari 0'; END IF;
    IF nullif(trim(movement->>'inventory_code'), '') IS NULL THEN
      RAISE EXCEPTION 'Kode inventori wajib diisi pada setiap mutasi';
    END IF;

    unit_uuid := nullif(movement->>'unit_id', '')::uuid;
    IF unit_uuid IS NOT NULL THEN
      SELECT * INTO unit_row FROM public.inventory_units WHERE id = unit_uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unit stok % tidak ditemukan', unit_uuid; END IF;
      IF unit_row.archived OR unit_row.is_active = false THEN
        RAISE EXCEPTION 'Unit % sudah nonaktif/diarsipkan', unit_row.unit_label;
      END IF;
      IF unit_row.inventory_code IS DISTINCT FROM movement->>'inventory_code' THEN
        RAISE EXCEPTION 'Unit % tidak cocok dengan kode inventori', unit_row.unit_label;
      END IF;
      IF unit_row.stock < qty_value THEN
        RAISE EXCEPTION 'Stok % tidak cukup: tersedia %, diminta %', unit_row.unit_label, unit_row.stock, qty_value;
      END IF;
    END IF;

    SELECT name INTO inventory_name_value FROM public.inventory WHERE code = movement->>'inventory_code' FOR UPDATE;
    IF inventory_name_value IS NULL THEN RAISE EXCEPTION 'Item inventori % tidak ditemukan', movement->>'inventory_code'; END IF;

    INSERT INTO public.inventory_transactions
      (inventory_code, inventory_name, qty, qty_actual, type, teknisi_name,
       job_date, order_id, unit_id, unit_label, notes, customer_name,
       created_by, created_by_name)
    VALUES
      (movement->>'inventory_code', coalesce(nullif(movement->>'inventory_name',''), inventory_name_value),
       -qty_value, -qty_value, 'usage', sess.teknisi_name,
       coalesce(nullif(movement->>'job_date','')::date, sess.checkout_date),
       nullif(movement->>'order_id',''), unit_uuid,
       coalesce(nullif(movement->>'unit_label',''), unit_row.unit_label),
       coalesce(nullif(movement->>'notes',''), 'Material Harian confirm oleh ' || actor_name),
       nullif(movement->>'customer_name',''), auth.uid(), actor_name)
    RETURNING id INTO tx_id;
    tx_ids := tx_ids || jsonb_build_array(tx_id);

    IF unit_uuid IS NOT NULL THEN
      UPDATE public.inventory_units
         SET stock = stock - qty_value, updated_at = now()
       WHERE id = unit_uuid;
    END IF;
  END LOOP;

  UPDATE public.teknisi_material_checkout
     SET confirm_status = 'CONFIRMED', confirmed_by = actor_name, confirmed_at = now(),
         deduct_tx_ids = tx_ids,
         items = coalesce(p_session_items, sess.items),
         admin_adjustments = coalesce(p_admin_adjustments, '[]'::jsonb),
         confirm_notes = nullif(trim(p_confirm_notes), ''), updated_at = now()
   WHERE id = sess.id;

  RETURN jsonb_build_object('session_id', sess.id, 'deduct_tx_ids', tx_ids,
    'movement_count', jsonb_array_length(coalesce(p_movements, '[]'::jsonb)));
END $$;

REVOKE ALL ON FUNCTION public.confirm_material_checkout_atomic(uuid,jsonb,timestamptz,jsonb,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_material_checkout_atomic(uuid,jsonb,timestamptz,jsonb,jsonb,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reopen_material_checkout_atomic(
  p_session_id uuid,
  p_reason text,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_role text;
  actor_name text;
  sess public.teknisi_material_checkout%ROWTYPE;
  old_tx public.inventory_transactions%ROWTYPE;
  linked_adjustment public.inventory_transactions%ROWTYPE;
  tx_id_text text;
  restored integer := 0;
BEGIN
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat membuka koreksi material' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'Alasan koreksi minimal 5 karakter'; END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  actor_name := coalesce(actor_name, nullif(trim(p_actor_name), ''), actor_role);

  SELECT * INTO sess FROM public.teknisi_material_checkout WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesi material tidak ditemukan'; END IF;
  IF sess.confirm_status <> 'CONFIRMED' THEN RAISE EXCEPTION 'Sesi sudah dibuka/diubah pengguna lain'; END IF;

  FOR tx_id_text IN SELECT value FROM jsonb_array_elements_text(coalesce(sess.deduct_tx_ids, '[]'::jsonb)) LOOP
    SELECT * INTO old_tx FROM public.inventory_transactions WHERE id = tx_id_text::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transaksi potongan % tidak ditemukan; koreksi dibatalkan', tx_id_text; END IF;
    INSERT INTO public.inventory_transactions
      (inventory_code, inventory_name, order_id, report_id, unit_id, unit_label,
       qty, qty_actual, type, teknisi_name, customer_name, job_date, notes,
       created_by, created_by_name)
    VALUES
      (old_tx.inventory_code, old_tx.inventory_name, old_tx.order_id, old_tx.report_id,
       old_tx.unit_id, old_tx.unit_label, abs(old_tx.qty), abs(coalesce(old_tx.qty_actual, old_tx.qty)),
       'adjustment', old_tx.teknisi_name, old_tx.customer_name, old_tx.job_date,
       'Buka koreksi Material Harian — stok dikembalikan oleh ' || actor_name || ' (' || trim(p_reason) || ')',
       auth.uid(), actor_name);
    IF old_tx.unit_id IS NOT NULL THEN
      UPDATE public.inventory_units SET stock = stock + abs(old_tx.qty), updated_at = now()
       WHERE id = old_tx.unit_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unit transaksi % tidak ditemukan', tx_id_text; END IF;
    END IF;

    -- Koreksi timbang adalah bagian dari mutasi yang sama. Balikkan juga koreksinya,
    -- sehingga buka-koreksi selalu kembali tepat ke stok sebelum konfirmasi.
    FOR linked_adjustment IN
      SELECT * FROM public.inventory_transactions
       WHERE source_transaction_id = old_tx.id AND type = 'adjustment'
       FOR UPDATE
    LOOP
      INSERT INTO public.inventory_transactions
        (inventory_code, inventory_name, order_id, report_id, unit_id, unit_label,
         qty, qty_actual, type, teknisi_name, customer_name, job_date, notes,
         created_by, created_by_name, source_transaction_id)
      VALUES
        (linked_adjustment.inventory_code, linked_adjustment.inventory_name,
         linked_adjustment.order_id, linked_adjustment.report_id,
         linked_adjustment.unit_id, linked_adjustment.unit_label,
         -linked_adjustment.qty, -coalesce(linked_adjustment.qty_actual, linked_adjustment.qty),
         'adjustment', linked_adjustment.teknisi_name, linked_adjustment.customer_name,
         linked_adjustment.job_date,
         'Pembalikan koreksi timbang transaksi ' || linked_adjustment.id || ' oleh ' || actor_name,
         auth.uid(), actor_name, linked_adjustment.id);
      IF linked_adjustment.unit_id IS NOT NULL THEN
        UPDATE public.inventory_units
           SET stock = stock - linked_adjustment.qty, updated_at = now()
         WHERE id = linked_adjustment.unit_id AND stock - linked_adjustment.qty >= 0;
        IF NOT FOUND THEN RAISE EXCEPTION 'Stok unit tidak valid saat membalik koreksi transaksi %', linked_adjustment.id; END IF;
      END IF;
    END LOOP;

    IF old_tx.qty_actual IS NOT NULL
       AND abs(abs(old_tx.qty_actual) - abs(old_tx.qty)) >= 0.001
       AND NOT EXISTS (
         SELECT 1 FROM public.inventory_transactions
          WHERE source_transaction_id = old_tx.id AND type = 'adjustment'
       ) THEN
      RAISE EXCEPTION 'Koreksi timbang lama untuk transaksi % belum memiliki tautan audit; buka-koreksi dibatalkan', old_tx.id;
    END IF;
    restored := restored + 1;
  END LOOP;

  UPDATE public.teknisi_material_checkout
     SET confirm_status = 'PENDING', confirmed_by = NULL, confirmed_at = NULL,
         deduct_tx_ids = '[]'::jsonb,
         confirm_notes = 'Dibuka untuk koreksi oleh ' || actor_name || ': ' || trim(p_reason),
         updated_at = now()
   WHERE id = sess.id;
  RETURN jsonb_build_object('session_id', sess.id, 'restored_count', restored);
END $$;

REVOKE ALL ON FUNCTION public.reopen_material_checkout_atomic(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_material_checkout_atomic(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adjust_inventory_usage_actual_atomic(
  p_transaction_id bigint,
  p_actual_qty numeric,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  actor_role text;
  actor_name text;
  original public.inventory_transactions%ROWTYPE;
  correction numeric;
  new_unit_stock numeric;
  adjustment_id bigint;
BEGIN
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  IF p_actual_qty IS NULL OR p_actual_qty < 0 THEN RAISE EXCEPTION 'Qty aktual tidak valid'; END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id=auth.uid(); actor_name:=coalesce(actor_name,nullif(trim(p_actor_name),''),actor_role);

  SELECT * INTO original FROM public.inventory_transactions WHERE id=p_transaction_id FOR UPDATE;
  IF NOT FOUND OR original.type <> 'usage' OR original.qty >= 0 THEN RAISE EXCEPTION 'Transaksi pemakaian tidak ditemukan'; END IF;
  IF original.qty_actual IS NOT NULL THEN RAISE EXCEPTION 'Qty aktual transaksi ini sudah pernah dikonfirmasi'; END IF;
  -- Ledger awal = -estimasi. Agar net menjadi -aktual, koreksi = estimasi - aktual.
  correction := round(abs(original.qty) - p_actual_qty, 3);

  UPDATE public.inventory_transactions SET qty_actual=-p_actual_qty WHERE id=original.id;
  IF abs(correction) >= 0.001 THEN
    INSERT INTO public.inventory_transactions
      (inventory_code,inventory_name,order_id,report_id,qty,qty_actual,type,unit_id,unit_label,
       notes,customer_name,teknisi_name,job_date,created_by,created_by_name,source_transaction_id)
    VALUES
      (original.inventory_code,original.inventory_name,original.order_id,original.report_id,
       correction,correction,'adjustment',original.unit_id,original.unit_label,
       'Koreksi timbang aktual dari '||abs(original.qty)||' → '||p_actual_qty||' (transaksi '||original.id||')',
       original.customer_name,original.teknisi_name,original.job_date,auth.uid(),actor_name,original.id)
    RETURNING id INTO adjustment_id;
    IF original.unit_id IS NOT NULL THEN
      UPDATE public.inventory_units SET stock=stock+correction,updated_at=now()
       WHERE id=original.unit_id AND stock+correction>=0 RETURNING stock INTO new_unit_stock;
      IF new_unit_stock IS NULL THEN RAISE EXCEPTION 'Stok unit tidak cukup untuk koreksi timbang'; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('transaction_id',original.id,'qty_actual',-p_actual_qty,
    'correction',correction,'adjustment_id',adjustment_id,'unit_id',original.unit_id,'unit_stock',new_unit_stock);
END $$;
REVOKE ALL ON FUNCTION public.adjust_inventory_usage_actual_atomic(bigint,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_usage_actual_atomic(bigint,numeric,text) TO authenticated, service_role;

-- ── C. Master material & restock atomik ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_inventory_item_atomic(
  p_code text, p_name text, p_unit text, p_price numeric, p_initial_stock numeric,
  p_reorder numeric, p_min_alert numeric, p_material_type text, p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE actor_role text; actor_name text; result public.inventory%ROWTYPE;
BEGIN
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  IF length(trim(coalesce(p_code,''))) < 2 OR length(trim(coalesce(p_name,''))) < 2 THEN RAISE EXCEPTION 'Kode/nama material tidak valid'; END IF;
  IF coalesce(p_initial_stock,0) < 0 OR coalesce(p_price,0) < 0 THEN RAISE EXCEPTION 'Stok/harga tidak boleh negatif'; END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id=auth.uid(); actor_name:=coalesce(actor_name,nullif(trim(p_actor_name),''),actor_role);
  INSERT INTO public.inventory(code,name,unit,price,stock,reorder,min_alert,material_type)
  VALUES(upper(trim(p_code)),trim(p_name),coalesce(nullif(trim(p_unit),''),'pcs'),coalesce(p_price,0),0,coalesce(p_reorder,5),coalesce(p_min_alert,2),coalesce(nullif(trim(p_material_type),''),'other'));
  IF coalesce(p_initial_stock,0)>0 THEN
    INSERT INTO public.inventory_transactions(inventory_code,inventory_name,qty,type,notes,created_by,created_by_name)
    VALUES(upper(trim(p_code)),trim(p_name),p_initial_stock,'restock','Stok awal',auth.uid(),actor_name);
  END IF;
  SELECT * INTO result FROM public.inventory WHERE code=upper(trim(p_code));
  RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.create_inventory_item_atomic(text,text,text,numeric,numeric,numeric,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_inventory_item_atomic(text,text,text,numeric,numeric,numeric,numeric,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adjust_inventory_item_atomic(
  p_code text, p_target_stock numeric, p_price numeric, p_reorder numeric,
  p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE actor_role text; actor_name text; item public.inventory%ROWTYPE; delta numeric; result public.inventory%ROWTYPE;
BEGIN
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  SELECT * INTO item FROM public.inventory WHERE code=p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material tidak ditemukan'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_units WHERE inventory_code=p_code) AND p_target_stock IS DISTINCT FROM item.stock THEN
    RAISE EXCEPTION 'Stok material ber-unit harus diubah dari tabung/roll fisiknya';
  END IF;
  IF coalesce(p_target_stock,0)<0 OR coalesce(p_price,0)<0 THEN RAISE EXCEPTION 'Stok/harga tidak boleh negatif'; END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id=auth.uid(); actor_name:=coalesce(actor_name,nullif(trim(p_actor_name),''),actor_role);
  delta:=p_target_stock-item.stock;
  UPDATE public.inventory SET price=p_price,reorder=p_reorder,updated_at=now() WHERE code=p_code;
  IF delta<>0 THEN
    INSERT INTO public.inventory_transactions(inventory_code,inventory_name,qty,type,notes,created_by,created_by_name)
    VALUES(item.code,item.name,delta,CASE WHEN delta>0 THEN 'restock' ELSE 'correction' END,'Koreksi stok manual',auth.uid(),actor_name);
  END IF;
  SELECT * INTO result FROM public.inventory WHERE code=p_code; RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.adjust_inventory_item_atomic(text,numeric,numeric,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_atomic(text,numeric,numeric,numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restock_inventory_atomic(
  p_code text, p_qty numeric, p_unit_cost numeric DEFAULT NULL, p_date date DEFAULT current_date,
  p_notes text DEFAULT NULL, p_create_expense boolean DEFAULT false, p_actor_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE actor_role text; actor_name text; item public.inventory%ROWTYPE; new_hpp numeric; total_cost_value numeric; result public.inventory%ROWTYPE;
BEGIN
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  IF coalesce(p_qty,0)<=0 OR coalesce(p_unit_cost,0)<0 THEN RAISE EXCEPTION 'Qty/harga tidak valid'; END IF;
  SELECT * INTO item FROM public.inventory WHERE code=p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material tidak ditemukan'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_units WHERE inventory_code=p_code) THEN
    RAISE EXCEPTION 'Material ini memakai tabung/roll fisik; tambahkan unit baru agar identitas stok tetap jelas';
  END IF;
  SELECT name INTO actor_name FROM public.user_profiles WHERE id=auth.uid(); actor_name:=coalesce(actor_name,nullif(trim(p_actor_name),''),actor_role);
  total_cost_value:=CASE WHEN coalesce(p_unit_cost,0)>0 THEN round(p_qty*p_unit_cost) ELSE NULL END;
  new_hpp:=CASE WHEN coalesce(p_unit_cost,0)>0 AND coalesce(item.stock,0)+p_qty>0
    THEN round(((coalesce(item.stock,0)*coalesce(item.purchase_price,0))+(p_qty*p_unit_cost))/(coalesce(item.stock,0)+p_qty),2)
    ELSE item.purchase_price END;
  INSERT INTO public.inventory_transactions(inventory_code,inventory_name,qty,type,unit_cost,total_cost,notes,created_by,created_by_name)
  VALUES(item.code,item.name,p_qty,'restock',nullif(p_unit_cost,0),total_cost_value,coalesce(nullif(trim(p_notes),''),'Restock manual'),auth.uid(),actor_name);
  IF coalesce(p_unit_cost,0)>0 THEN
    UPDATE public.inventory SET purchase_price=new_hpp,purchase_price_last=p_unit_cost,
      purchase_price_source='restock',purchase_price_updated_at=now(),updated_at=now() WHERE code=item.code;
  END IF;
  IF p_create_expense AND total_cost_value>0 THEN
    INSERT INTO public.expenses(category,subcategory,amount,date,description,item_name,inventory_code,qty,unit,unit_cost,
      stock_linked_at,stock_linked_by,created_by,last_changed_by,source,allocation_status)
    VALUES('material_purchase',CASE WHEN item.material_type='freon' THEN 'Freon' WHEN item.material_type='pipa' THEN 'Pipa AC' WHEN item.material_type='kabel' THEN 'Kabel' ELSE 'Material Lain' END,
      total_cost_value,coalesce(p_date,current_date),coalesce(nullif(trim(p_notes),''),'Restock '||item.name||' '||p_qty||' '||item.unit),
      item.name||' '||p_qty||' '||item.unit,item.code,p_qty,item.unit,p_unit_cost,now(),actor_name,actor_name,actor_name,'restock','STOCK');
  END IF;
  SELECT * INTO result FROM public.inventory WHERE code=item.code;
  RETURN jsonb_build_object('inventory',to_jsonb(result),'expense_created',p_create_expense AND total_cost_value>0);
END $$;
REVOKE ALL ON FUNCTION public.restock_inventory_atomic(text,numeric,numeric,date,text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_inventory_atomic(text,numeric,numeric,date,text,boolean,text) TO authenticated, service_role;

COMMIT;
