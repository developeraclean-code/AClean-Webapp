-- Migration 248: serialize stock writers before row locks and preserve relative movements.
-- A short shared inventory lock also protects the first-unit transition and SUM mirror.
-- Existing ledger columns and the aggregate-negative policy are unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Refuse to overwrite an RPC changed since the read-only 15 Nov capture.
-- Accept captured production/patched definitions and the reviewed older staging
-- variant whose only difference is the missing NULL check; business bodies match.
DO $preflight$
DECLARE expected record; target regprocedure; actual_hash text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
      ('public.adjust_inventory_item_atomic(text,numeric,numeric,numeric,text)','0a8a82315657d8e3e13c1a02e61ac870','5ae43ec262121148c7e116fc1e121b84','e1c079c689adbd87722bbf314f933681'),
      ('public.adjust_inventory_usage_actual_atomic(bigint,numeric,text)','3405cc232dc6dbed14a9598ce54ab204','f93a0bb3d176d22349bc6cff399c8b08','c9bafc3f111c615606b13a8c43a9e3e5'),
      ('public.confirm_material_checkout_atomic(uuid,jsonb,timestamp with time zone,jsonb,jsonb,text,text)','345e9039023ed07a80ea7d5661ce2f0c','512a933937dafce0cba446c7d1bb78e0','a1c55c795b9510a606a67c7f81af8a25'),
      ('public.link_expense_to_stock(uuid,text,numeric)','a28304f3fcc2d5358a721840c8fb93d1','bd87993563129900e7b24952ab93b3cf',NULL),
      ('public.reopen_material_checkout_atomic(uuid,text,text)','fb1f787965e96b29b0adc785c3ef8407','514f985640dd64592cdca2a02606d4e9','da5f991093b3044405aa0dda947cf09d'),
      ('public.restock_inventory_atomic(text,numeric,numeric,date,text,boolean,text)','9db3a877816f255a5181876ed029b1db','732bcd63aa88e1066f556378ae2d856c','310acff22afa012e91abf7a48ae43d94'),
      ('public.restore_inventory_stock()','b85758feb7e7036aa7f3b1ec2533fdea','fd7367c803f534b56c0b45a1c3649135',NULL),
      ('public.sync_inventory_from_units()','5ccba6f5d937c689a551c3cfee2add63','794a1c79e722d4b91749ba56a86aa60f',NULL),
      ('public.update_inventory_stock()','b192cf120cc91742d59d9a5e8e6bcd5b','7ee883db5ba479603402aff1abfa7d23',NULL)
    ) AS fingerprints(signature,original_hash,patched_hash,reviewed_legacy_hash)
  LOOP
    target:=to_regprocedure(expected.signature);
    IF target IS NULL THEN RAISE EXCEPTION 'Missing prerequisite function: %',expected.signature USING ERRCODE='55000'; END IF;
    actual_hash:=md5(pg_get_functiondef(target::oid));
    IF actual_hash NOT IN (expected.original_hash,expected.patched_hash,coalesce(expected.reviewed_legacy_hash,expected.original_hash)) THEN
      RAISE EXCEPTION 'Definition drift: %. Review the current function before applying this migration',expected.signature USING ERRCODE='55000';
    END IF;
  END LOOP;
END $preflight$;

CREATE OR REPLACE FUNCTION public.serialize_inventory_write_240()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(146389940,240);
  RETURN NULL; -- statement-level trigger
END $$;
REVOKE ALL ON FUNCTION public.serialize_inventory_write_240() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE TRIGGER trg_fsm_stock_serialize_240
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory
  FOR EACH STATEMENT EXECUTE FUNCTION public.serialize_inventory_write_240();
CREATE OR REPLACE TRIGGER trg_fsm_stock_serialize_240
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_units
  FOR EACH STATEMENT EXECUTE FUNCTION public.serialize_inventory_write_240();
CREATE OR REPLACE TRIGGER trg_fsm_stock_serialize_240
  BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION public.serialize_inventory_write_240();

CREATE OR REPLACE FUNCTION public.update_inventory_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Tracked items derive aggregate stock from physical units.
  IF EXISTS (SELECT 1 FROM public.inventory_units u
             WHERE u.inventory_code=NEW.inventory_code) THEN
    RETURN NEW;
  END IF;

  UPDATE public.inventory i
  SET stock = i.stock + NEW.qty,
      status = CASE WHEN i.stock + NEW.qty <= 0 THEN 'OUT'
                    WHEN i.stock + NEW.qty <= i.min_alert THEN 'CRITICAL'
                    WHEN i.stock + NEW.qty <= i.reorder THEN 'WARNING'
                    ELSE 'OK' END,
      updated_at = now()
  WHERE i.code=NEW.inventory_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown inventory code' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_inventory_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory_units u
             WHERE u.inventory_code=OLD.inventory_code) THEN
    RETURN OLD;
  END IF;
  UPDATE public.inventory i
  SET stock = i.stock - OLD.qty,
      status = CASE WHEN i.stock - OLD.qty <= 0 THEN 'OUT'
                    WHEN i.stock - OLD.qty <= i.min_alert THEN 'CRITICAL'
                    WHEN i.stock - OLD.qty <= i.reorder THEN 'WARNING'
                    ELSE 'OK' END,
      updated_at = now()
  WHERE i.code=OLD.inventory_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown inventory code' USING ERRCODE='23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.update_inventory_stock() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_inventory_stock() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.sync_inventory_from_units()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE kode text; codes text[]; total numeric;
BEGIN
  IF TG_OP='INSERT' THEN codes:=ARRAY[NEW.inventory_code];
  ELSIF TG_OP='DELETE' THEN codes:=ARRAY[OLD.inventory_code];
  ELSE codes:=ARRAY[OLD.inventory_code,NEW.inventory_code]; END IF;
  FOR kode IN SELECT DISTINCT v FROM unnest(codes) u(v) WHERE v IS NOT NULL ORDER BY v LOOP
    SELECT coalesce(sum(stock),0) INTO total FROM public.inventory_units
      WHERE inventory_code=kode AND coalesce(archived,false)=false;
    UPDATE public.inventory SET stock=total,
      status=CASE WHEN total<=0 THEN 'OUT' WHEN total<=min_alert THEN 'CRITICAL'
                  WHEN total<=reorder THEN 'WARNING' ELSE 'OK' END,updated_at=now()
      WHERE code=kode;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_inventory_from_units() FROM PUBLIC,anon;

CREATE OR REPLACE FUNCTION public.confirm_material_checkout_atomic(p_session_id uuid, p_movements jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_session_items jsonb DEFAULT NULL::jsonb, p_admin_adjustments jsonb DEFAULT '[]'::jsonb, p_confirm_notes text DEFAULT NULL::text, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
 SET lock_timeout TO '5s'
AS $function$
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
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengonfirmasi material' USING ERRCODE = '42501';
  END IF;
  -- Acquire before session/unit/parent row locks; matches statement triggers.
  PERFORM pg_advisory_xact_lock(146389940,240);
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
END $function$;

REVOKE ALL ON FUNCTION public.confirm_material_checkout_atomic(uuid,jsonb,timestamp with time zone,jsonb,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_material_checkout_atomic(uuid,jsonb,timestamp with time zone,jsonb,jsonb,text,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reopen_material_checkout_atomic(p_session_id uuid, p_reason text, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  actor_role text;
  actor_name text;
  sess public.teknisi_material_checkout%ROWTYPE;
  old_tx public.inventory_transactions%ROWTYPE;
  linked_adjustment public.inventory_transactions%ROWTYPE;
  tx_id_text text;
  restored integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  actor_role := CASE WHEN auth.role() = 'service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat membuka koreksi material' USING ERRCODE = '42501';
  END IF;
  -- Acquire before session/unit/parent row locks; matches statement triggers.
  PERFORM pg_advisory_xact_lock(146389940,240);
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
END $function$;

REVOKE ALL ON FUNCTION public.reopen_material_checkout_atomic(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_material_checkout_atomic(uuid,text,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.adjust_inventory_usage_actual_atomic(p_transaction_id bigint, p_actual_qty numeric, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  actor_role text;
  actor_name text;
  original public.inventory_transactions%ROWTYPE;
  correction numeric;
  new_unit_stock numeric;
  adjustment_id bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  -- Acquire before session/unit/parent row locks; matches statement triggers.
  PERFORM pg_advisory_xact_lock(146389940,240);
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
END $function$;

REVOKE ALL ON FUNCTION public.adjust_inventory_usage_actual_atomic(bigint,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_usage_actual_atomic(bigint,numeric,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.restock_inventory_atomic(p_code text, p_qty numeric, p_unit_cost numeric DEFAULT NULL::numeric, p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_create_expense boolean DEFAULT false, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
 SET lock_timeout TO '5s'
AS $function$
DECLARE actor_role text; actor_name text; item public.inventory%ROWTYPE; new_hpp numeric; total_cost_value numeric; result public.inventory%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  -- Acquire before session/unit/parent row locks; matches statement triggers.
  PERFORM pg_advisory_xact_lock(146389940,240);
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
END $function$;

REVOKE ALL ON FUNCTION public.restock_inventory_atomic(text,numeric,numeric,date,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.restock_inventory_atomic(text,numeric,numeric,date,text,boolean,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.adjust_inventory_item_atomic(p_code text, p_target_stock numeric, p_price numeric, p_reorder numeric, p_actor_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
 SET lock_timeout TO '5s'
AS $function$
DECLARE actor_role text; actor_name text; item public.inventory%ROWTYPE; delta numeric; result public.inventory%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(146389940,240);
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
END $function$;

REVOKE ALL ON FUNCTION public.adjust_inventory_item_atomic(text,numeric,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_atomic(text,numeric,numeric,numeric,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.link_expense_to_stock(p_expense_id uuid, p_inventory_code text, p_qty numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO pg_catalog, public
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  actor_role text := public.get_my_role();
  actor_name text;
  e public.expenses%ROWTYPE;
  i public.inventory%ROWTYPE;
  unit_cost_value numeric;
  new_hpp numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'Sesi tidak terautentikasi' USING ERRCODE='42501';
  END IF;
  IF actor_role IS NULL OR actor_role NOT IN ('Owner','Admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin boleh menautkan nota ke stok' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(146389940,240);
  IF p_qty IS NULL OR p_qty <= 0 THEN RAISE EXCEPTION 'Jumlah harus lebih dari 0'; END IF;

  SELECT name INTO actor_name FROM public.user_profiles WHERE id = auth.uid();
  SELECT * INTO e FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND OR e.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Nota tidak ditemukan'; END IF;
  IF e.category <> 'material_purchase' THEN RAISE EXCEPTION 'Nota bukan pembelian material'; END IF;
  IF e.stock_linked_at IS NOT NULL THEN RAISE EXCEPTION 'Nota sudah pernah ditautkan'; END IF;
  IF e.approval_status = 'PENDING_APPROVAL' OR e.validation_status = 'PENDING_AI' THEN
    RAISE EXCEPTION 'Nota harus disetujui sebelum menjadi stok';
  END IF;

  SELECT * INTO i FROM public.inventory WHERE code = p_inventory_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item inventori tidak ditemukan'; END IF;

  unit_cost_value := round((e.amount / p_qty)::numeric, 2);
  new_hpp := CASE WHEN coalesce(i.stock,0) + p_qty > 0
    THEN round(((coalesce(i.stock,0) * coalesce(i.purchase_price,0)) + (p_qty * unit_cost_value)) / (coalesce(i.stock,0) + p_qty), 2)
    ELSE unit_cost_value END;

  UPDATE public.expenses SET
    inventory_code = i.code, qty = p_qty, unit = i.unit, unit_cost = unit_cost_value,
    stock_linked_at = now(), stock_linked_by = coalesce(actor_name, actor_role),
    allocation_status = 'STOCK', last_changed_by = coalesce(actor_name, actor_role)
  WHERE id = e.id;

  UPDATE public.inventory SET
    purchase_price = new_hpp, purchase_price_last = unit_cost_value,
    purchase_price_source = 'nota', purchase_price_updated_at = now(), updated_at = now()
  WHERE code = i.code;

  INSERT INTO public.inventory_transactions
    (inventory_code, inventory_name, qty, type, unit_cost, total_cost, expense_id, notes, created_by, created_by_name)
  VALUES
    (i.code, i.name, p_qty, 'restock', unit_cost_value, e.amount, e.id,
     'Tautan nota: ' || coalesce(e.item_name, e.subcategory, 'pembelian') || ' (' || e.date || ')',
     auth.uid(), coalesce(actor_name, actor_role));

  RETURN jsonb_build_object(
    'expense', jsonb_build_object('inventory_code',i.code,'qty',p_qty,'unit',i.unit,'unit_cost',unit_cost_value,'stock_linked_at',now(),'stock_linked_by',coalesce(actor_name,actor_role),'allocation_status','STOCK'),
    'inventory', jsonb_build_object('code',i.code,'stock',coalesce(i.stock,0)+p_qty,'purchase_price',new_hpp,'purchase_price_last',unit_cost_value,'purchase_price_source','nota','purchase_price_updated_at',now())
  );
END $function$;

REVOKE ALL ON FUNCTION public.link_expense_to_stock(uuid,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_expense_to_stock(uuid,text,numeric) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
