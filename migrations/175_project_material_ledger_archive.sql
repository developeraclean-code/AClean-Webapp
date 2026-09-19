-- 175 — Project material stock: ledger, archive, atomic mutations, and audit-safe usage.
-- Additive migration. Existing balances are preserved and recorded once as opening snapshots.

BEGIN;

ALTER TABLE public.project_materials
  ADD COLUMN IF NOT EXISTS group_name text,
  ADD COLUMN IF NOT EXISTS variant_label text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by text,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.project_usage
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS mutation_key text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by text,
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_usage_mutation_key
  ON public.project_usage(mutation_key) WHERE mutation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_usage_project_date
  ON public.project_usage(project_id, tanggal DESC);

CREATE TABLE IF NOT EXISTS public.project_material_transactions (
  id bigserial PRIMARY KEY,
  material_id text NOT NULL REFERENCES public.project_materials(id) ON DELETE RESTRICT,
  project_id text REFERENCES public.project_projects(id) ON DELETE RESTRICT,
  usage_id text REFERENCES public.project_usage(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN
    ('OPENING','RESTOCK','ALLOCATE','RETURN','USAGE','ADJUSTMENT','ARCHIVE','RESTORE')),
  warehouse_delta numeric NOT NULL DEFAULT 0,
  allocation_delta numeric NOT NULL DEFAULT 0,
  qty numeric NOT NULL DEFAULT 0,
  unit text,
  unit_cost bigint NOT NULL DEFAULT 0,
  notes text,
  actor_name text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_material_tx_has_effect CHECK (
    warehouse_delta <> 0 OR allocation_delta <> 0 OR movement_type IN ('ARCHIVE','RESTORE')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_material_tx_idempotency
  ON public.project_material_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_material_tx_material_date
  ON public.project_material_transactions(material_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_material_tx_project_date
  ON public.project_material_transactions(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.project_material_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.project_material_transactions TO authenticated;
DROP POLICY IF EXISTS project_material_transactions_read ON public.project_material_transactions;
CREATE POLICY project_material_transactions_read ON public.project_material_transactions
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('Owner','Admin'));

-- Mutasi langsung ditutup. Client hanya membaca; seluruh perubahan saldo wajib
-- melewati SECURITY DEFINER RPC di bawah agar balance dan ledger selalu atomik.
DROP POLICY IF EXISTS auth_full_project_materials ON public.project_materials;
DROP POLICY IF EXISTS project_materials_read ON public.project_materials;
CREATE POLICY project_materials_read ON public.project_materials FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_full_project_alokasi ON public.project_alokasi;
DROP POLICY IF EXISTS project_alokasi_read ON public.project_alokasi;
CREATE POLICY project_alokasi_read ON public.project_alokasi FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS auth_full_project_usage ON public.project_usage;
DROP POLICY IF EXISTS project_usage_read ON public.project_usage;
CREATE POLICY project_usage_read ON public.project_usage FOR SELECT TO authenticated USING (true);

-- Explicit grouping replaces the fragile UI rule that stripped trailing digits.
UPDATE public.project_materials
SET group_name = coalesce(nullif(trim(group_name), ''),
  nullif(trim(regexp_replace(nama, '[[:space:]_.\x2D]+[0-9]+[[:space:]]*$', '')), ''), nama),
    variant_label = coalesce(nullif(trim(variant_label), ''),
      nullif(substring(nama from '([0-9]+)[[:space:]]*$'), ''))
WHERE group_name IS NULL OR trim(group_name) = '';

-- One truthful cut-over snapshot; no attempt is made to invent historical movements.
INSERT INTO public.project_material_transactions
  (material_id, movement_type, warehouse_delta, qty, unit, unit_cost, notes, actor_name, idempotency_key)
SELECT m.id, 'OPENING', m.gudang, abs(m.gudang), m.satuan, m.harga,
       'Saldo gudang saat aktivasi ledger migration 175', 'migration-175', 'm175:opening:warehouse:' || m.id
FROM public.project_materials m
WHERE m.gudang <> 0
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

INSERT INTO public.project_material_transactions
  (material_id, project_id, movement_type, allocation_delta, qty, unit, unit_cost, notes, actor_name, idempotency_key)
SELECT a.material_id, a.project_id, 'OPENING', a.qty, abs(a.qty), m.satuan, m.harga,
       'Saldo alokasi saat aktivasi ledger migration 175', 'migration-175', 'm175:opening:allocation:' || a.id
FROM public.project_alokasi a
JOIN public.project_materials m ON m.id = a.material_id
WHERE a.qty <> 0
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

CREATE OR REPLACE FUNCTION public.project_actor_name(p_fallback text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
  SELECT coalesce((SELECT name FROM public.user_profiles WHERE id = auth.uid()),
                  nullif(trim(p_fallback), ''), public.get_my_role(), 'System')
$$;
REVOKE ALL ON FUNCTION public.project_actor_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_actor_name(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_project_material_manager()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE r text;
BEGIN
  r := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF r NOT IN ('Owner','Admin','service_role') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengubah stok material project' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_project_material_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_project_material_manager() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_project_materials_atomic(
  p_rows jsonb, p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE x jsonb; mid text; actor text; result jsonb := '[]'::jsonb; q numeric; idx int := 0;
BEGIN
  PERFORM public.assert_project_material_manager(); actor := public.project_actor_name(p_actor_name);
  IF jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_rows,'[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'Minimal satu material wajib diisi';
  END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    idx := idx + 1; mid := coalesce(nullif(x->>'id',''), gen_random_uuid()::text);
    q := round(coalesce(nullif(x->>'gudang','')::numeric,0),3);
    IF length(trim(coalesce(x->>'nama',''))) < 2 OR q < 0 THEN RAISE EXCEPTION 'Nama/stok awal material tidak valid'; END IF;
    INSERT INTO public.project_materials
      (id,nama,sub,satuan,gudang,min_qty,harga,group_name,variant_label,is_active,updated_at)
    VALUES(mid,trim(x->>'nama'),coalesce(nullif(trim(x->>'sub'),''),'Lainnya'),nullif(trim(x->>'satuan'),''),q,
      coalesce(nullif(x->>'min','')::numeric,0),coalesce(nullif(x->>'harga','')::bigint,0),
      coalesce(nullif(trim(x->>'groupName'),''),trim(x->>'nama')),nullif(trim(x->>'variantLabel'),''),true,now());
    IF q <> 0 THEN
      INSERT INTO public.project_material_transactions
        (material_id,movement_type,warehouse_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
      VALUES(mid,'OPENING',q,q,nullif(trim(x->>'satuan'),''),coalesce(nullif(x->>'harga','')::bigint,0),
        'Stok awal material',actor,coalesce(nullif(p_mutation_key,''),gen_random_uuid()::text)||':'||idx);
    END IF;
    result := result || jsonb_build_array(mid);
  END LOOP;
  RETURN jsonb_build_object('material_ids',result,'count',jsonb_array_length(result));
END $$;

CREATE OR REPLACE FUNCTION public.update_project_material_atomic(
  p_material_id text, p_name text, p_sub text, p_unit text, p_min numeric, p_price bigint,
  p_group_name text DEFAULT NULL, p_variant_label text DEFAULT NULL,
  p_target_stock numeric DEFAULT NULL, p_reason text DEFAULT NULL,
  p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE m public.project_materials%ROWTYPE; delta numeric; actor text;
BEGIN
  PERFORM public.assert_project_material_manager(); actor := public.project_actor_name(p_actor_name);
  SELECT * INTO m FROM public.project_materials WHERE id=p_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material tidak ditemukan'; END IF;
  IF NOT m.is_active THEN RAISE EXCEPTION 'Material sudah diarsipkan'; END IF;
  IF length(trim(coalesce(p_name,'')))<2 OR coalesce(p_min,0)<0 OR coalesce(p_price,0)<0 THEN RAISE EXCEPTION 'Data material tidak valid'; END IF;
  delta := coalesce(p_target_stock,m.gudang)-m.gudang;
  IF coalesce(p_target_stock,m.gudang)<0 THEN RAISE EXCEPTION 'Stok tidak boleh negatif'; END IF;
  IF delta<>0 AND length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Alasan koreksi stok minimal 5 karakter'; END IF;
  UPDATE public.project_materials SET nama=trim(p_name),sub=coalesce(nullif(trim(p_sub),''),'Lainnya'),
    satuan=nullif(trim(p_unit),''),min_qty=coalesce(p_min,0),harga=coalesce(p_price,0),
    group_name=coalesce(nullif(trim(p_group_name),''),trim(p_name)),variant_label=nullif(trim(p_variant_label),''),
    gudang=coalesce(p_target_stock,gudang),updated_at=now() WHERE id=p_material_id;
  IF delta<>0 THEN
    INSERT INTO public.project_material_transactions(material_id,movement_type,warehouse_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
    VALUES(p_material_id,'ADJUSTMENT',delta,abs(delta),p_unit,p_price,trim(p_reason),actor,nullif(p_mutation_key,''));
  END IF;
  RETURN (SELECT to_jsonb(x) FROM public.project_materials x WHERE x.id=p_material_id);
END $$;

CREATE OR REPLACE FUNCTION public.restock_project_materials_atomic(
  p_rows jsonb, p_notes text DEFAULT NULL, p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE x jsonb; m public.project_materials%ROWTYPE; q numeric; actor text; idx int:=0; n int:=0;
BEGIN
  PERFORM public.assert_project_material_manager(); actor:=public.project_actor_name(p_actor_name);
  FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    idx:=idx+1; q:=round(coalesce(nullif(x->>'qty','')::numeric,0),3);
    IF q<=0 THEN RAISE EXCEPTION 'Qty restock harus lebih dari 0'; END IF;
    SELECT * INTO m FROM public.project_materials WHERE id=x->>'materialId' FOR UPDATE;
    IF NOT FOUND OR NOT m.is_active THEN RAISE EXCEPTION 'Material tidak ditemukan/diarsipkan'; END IF;
    UPDATE public.project_materials SET gudang=gudang+q,updated_at=now() WHERE id=m.id;
    INSERT INTO public.project_material_transactions(material_id,movement_type,warehouse_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
    VALUES(m.id,'RESTOCK',q,q,m.satuan,m.harga,coalesce(nullif(trim(p_notes),''),'Restock gudang'),actor,
      coalesce(nullif(p_mutation_key,''),gen_random_uuid()::text)||':'||idx);
    n:=n+1;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'Minimal satu restock wajib diisi'; END IF;
  RETURN jsonb_build_object('count',n);
END $$;

CREATE OR REPLACE FUNCTION public.allocate_project_materials_atomic(
  p_project_id text, p_rows jsonb, p_notes text DEFAULT NULL, p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE x jsonb; m public.project_materials%ROWTYPE; q numeric; actor text; idx int:=0; n int:=0;
BEGIN
  PERFORM public.assert_project_material_manager(); actor:=public.project_actor_name(p_actor_name);
  IF NOT EXISTS(SELECT 1 FROM public.project_projects WHERE id=p_project_id) THEN RAISE EXCEPTION 'Project tidak ditemukan'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    idx:=idx+1; q:=round(coalesce(nullif(x->>'qty','')::numeric,0),3);
    IF q<=0 THEN RAISE EXCEPTION 'Qty alokasi harus lebih dari 0'; END IF;
    SELECT * INTO m FROM public.project_materials WHERE id=x->>'materialId' FOR UPDATE;
    IF NOT FOUND OR NOT m.is_active THEN RAISE EXCEPTION 'Material tidak ditemukan/diarsipkan'; END IF;
    IF m.gudang<q THEN RAISE EXCEPTION 'Stok % tidak cukup: tersedia %, diminta %',m.nama,m.gudang,q; END IF;
    UPDATE public.project_materials SET gudang=gudang-q,updated_at=now() WHERE id=m.id;
    INSERT INTO public.project_alokasi(material_id,project_id,qty) VALUES(m.id,p_project_id,q)
      ON CONFLICT(material_id,project_id) DO UPDATE SET qty=project_alokasi.qty+excluded.qty;
    INSERT INTO public.project_material_transactions(material_id,project_id,movement_type,warehouse_delta,allocation_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
    VALUES(m.id,p_project_id,'ALLOCATE',-q,q,q,m.satuan,m.harga,coalesce(nullif(trim(p_notes),''),'Alokasi ke project'),actor,
      coalesce(nullif(p_mutation_key,''),gen_random_uuid()::text)||':'||idx);
    n:=n+1;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'Minimal satu alokasi wajib diisi'; END IF;
  RETURN jsonb_build_object('count',n);
END $$;

CREATE OR REPLACE FUNCTION public.record_project_material_usage_atomic(
  p_project_id text, p_date date, p_rows jsonb, p_used_by text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE x jsonb; m public.project_materials%ROWTYPE; a public.project_alokasi%ROWTYPE; q numeric; actor text;
  uid text; idx int:=0; n int:=0; line_key text;
BEGIN
  PERFORM public.assert_project_material_manager(); actor:=public.project_actor_name(p_actor_name);
  IF NOT EXISTS(SELECT 1 FROM public.project_projects WHERE id=p_project_id) THEN RAISE EXCEPTION 'Project tidak ditemukan'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    idx:=idx+1; q:=round(coalesce(nullif(x->>'qty','')::numeric,0),3); uid:=coalesce(nullif(x->>'id',''),gen_random_uuid()::text);
    line_key:=coalesce(nullif(p_mutation_key,''),gen_random_uuid()::text)||':'||idx;
    IF q<=0 OR length(trim(coalesce(x->>'material','')))<1 THEN RAISE EXCEPTION 'Material/qty pemakaian tidak valid'; END IF;
    IF nullif(x->>'materialId','') IS NOT NULL THEN
      SELECT * INTO m FROM public.project_materials WHERE id=x->>'materialId' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Material stok tidak ditemukan'; END IF;
      SELECT * INTO a FROM public.project_alokasi WHERE material_id=m.id AND project_id=p_project_id FOR UPDATE;
      IF NOT FOUND OR a.qty<q THEN
        RAISE EXCEPTION 'Alokasi % tidak cukup: tersedia %, diminta %',m.nama,coalesce(a.qty,0),q;
      END IF;
      UPDATE public.project_alokasi SET qty=qty-q WHERE id=a.id;
    ELSE m:=NULL; END IF;
    INSERT INTO public.project_usage(id,project_id,tanggal,material,material_id,qty,qty_num,satuan,harga,oleh,notes,mutation_key)
    VALUES(uid,p_project_id,coalesce(p_date,current_date),trim(x->>'material'),m.id,q::text,q,
      coalesce(nullif(x->>'satuan',''),m.satuan),coalesce(m.harga,0),nullif(trim(p_used_by),''),nullif(trim(p_notes),''),line_key);
    IF m.id IS NOT NULL THEN
      INSERT INTO public.project_material_transactions(material_id,project_id,usage_id,movement_type,allocation_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
      VALUES(m.id,p_project_id,uid,'USAGE',-q,q,coalesce(nullif(x->>'satuan',''),m.satuan),m.harga,
        coalesce(nullif(trim(p_notes),''),'Pemakaian project'),actor,line_key);
    END IF;
    n:=n+1;
  END LOOP;
  IF n=0 THEN RAISE EXCEPTION 'Minimal satu pemakaian wajib diisi'; END IF;
  RETURN jsonb_build_object('count',n);
END $$;

CREATE OR REPLACE FUNCTION public.void_project_material_usage_atomic(
  p_usage_id text, p_reason text, p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE u public.project_usage%ROWTYPE; m public.project_materials%ROWTYPE; actor text; q numeric;
BEGIN
  PERFORM public.assert_project_material_manager(); actor:=public.project_actor_name(p_actor_name);
  IF length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Alasan pembatalan minimal 5 karakter'; END IF;
  SELECT * INTO u FROM public.project_usage WHERE id=p_usage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pemakaian tidak ditemukan'; END IF;
  IF u.voided_at IS NOT NULL THEN RETURN jsonb_build_object('usage_id',u.id,'already_voided',true); END IF;
  q:=coalesce(u.qty_num,nullif(regexp_replace(coalesce(u.qty,''),'[^0-9.]','','g'),'')::numeric,0);
  IF u.material_id IS NOT NULL AND q>0 THEN
    SELECT * INTO m FROM public.project_materials WHERE id=u.material_id FOR UPDATE;
    INSERT INTO public.project_alokasi(material_id,project_id,qty) VALUES(u.material_id,u.project_id,q)
      ON CONFLICT(material_id,project_id) DO UPDATE SET qty=project_alokasi.qty+excluded.qty;
    INSERT INTO public.project_material_transactions(material_id,project_id,usage_id,movement_type,allocation_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
    VALUES(u.material_id,u.project_id,u.id,'RETURN',q,q,u.satuan,u.harga,'Batalkan pemakaian: '||trim(p_reason),actor,nullif(p_mutation_key,''));
  END IF;
  UPDATE public.project_usage SET voided_at=now(),voided_by=actor,void_reason=trim(p_reason) WHERE id=u.id;
  RETURN jsonb_build_object('usage_id',u.id,'restored_qty',q,'material_id',u.material_id);
END $$;

CREATE OR REPLACE FUNCTION public.set_project_material_archive_atomic(
  p_material_id text, p_archive boolean, p_reason text, p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE m public.project_materials%ROWTYPE; allocated numeric; actor text; kind text;
BEGIN
  PERFORM public.assert_project_material_manager(); actor:=public.project_actor_name(p_actor_name);
  IF length(trim(coalesce(p_reason,'')))<5 THEN RAISE EXCEPTION 'Alasan minimal 5 karakter'; END IF;
  SELECT * INTO m FROM public.project_materials WHERE id=p_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material tidak ditemukan'; END IF;
  SELECT coalesce(sum(qty),0) INTO allocated FROM public.project_alokasi WHERE material_id=p_material_id;
  IF p_archive AND (m.gudang<>0 OR allocated<>0) THEN
    RAISE EXCEPTION 'Arsip ditolak: stok gudang % dan alokasi % harus sama-sama 0',m.gudang,allocated;
  END IF;
  IF m.is_active = NOT p_archive THEN RETURN to_jsonb(m); END IF;
  UPDATE public.project_materials SET is_active=NOT p_archive,
    archived_at=CASE WHEN p_archive THEN now() ELSE NULL END,
    archived_by=CASE WHEN p_archive THEN actor ELSE NULL END,
    archived_reason=CASE WHEN p_archive THEN trim(p_reason) ELSE NULL END,updated_at=now()
  WHERE id=p_material_id RETURNING * INTO m;
  kind:=CASE WHEN p_archive THEN 'ARCHIVE' ELSE 'RESTORE' END;
  INSERT INTO public.project_material_transactions(material_id,movement_type,notes,actor_name,idempotency_key)
  VALUES(m.id,kind,trim(p_reason),actor,nullif(p_mutation_key,''));
  RETURN to_jsonb(m);
END $$;

CREATE OR REPLACE FUNCTION public.complete_project_stock_atomic(
  p_project_id text, p_notes text DEFAULT NULL, p_actor_name text DEFAULT NULL, p_mutation_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE a public.project_alokasi%ROWTYPE; m public.project_materials%ROWTYPE; actor text; idx int:=0; returned int:=0;
BEGIN
  PERFORM public.assert_project_material_manager(); actor:=public.project_actor_name(p_actor_name);
  PERFORM 1 FROM public.project_projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project tidak ditemukan'; END IF;
  FOR a IN SELECT * FROM public.project_alokasi WHERE project_id=p_project_id AND qty>0 FOR UPDATE LOOP
    idx:=idx+1; SELECT * INTO m FROM public.project_materials WHERE id=a.material_id FOR UPDATE;
    UPDATE public.project_materials SET gudang=gudang+a.qty,updated_at=now() WHERE id=m.id;
    INSERT INTO public.project_material_transactions(material_id,project_id,movement_type,warehouse_delta,allocation_delta,qty,unit,unit_cost,notes,actor_name,idempotency_key)
    VALUES(m.id,p_project_id,'RETURN',a.qty,-a.qty,a.qty,m.satuan,m.harga,
      coalesce(nullif(trim(p_notes),''),'Sisa alokasi dikembalikan saat project selesai'),actor,
      coalesce(nullif(p_mutation_key,''),gen_random_uuid()::text)||':'||idx);
    UPDATE public.project_alokasi SET qty=0 WHERE id=a.id; returned:=returned+1;
  END LOOP;
  UPDATE public.project_tools SET lokasi='',status='tersedia' WHERE lokasi=p_project_id;
  UPDATE public.project_projects SET status='SELESAI',selesai_at=now(),catatan_selesai=nullif(trim(p_notes),'') WHERE id=p_project_id;
  RETURN jsonb_build_object('returned_materials',returned);
END $$;

CREATE OR REPLACE FUNCTION public.get_project_material_reconciliation()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE actor_role text; issues jsonb;
BEGIN
  actor_role := CASE WHEN auth.role()='service_role' THEN 'service_role' ELSE public.get_my_role() END;
  IF actor_role NOT IN ('Owner','Admin','service_role') THEN RAISE EXCEPTION 'Akses ditolak' USING ERRCODE='42501'; END IF;
  WITH ledger_warehouse AS (
    SELECT material_id,sum(warehouse_delta) balance FROM public.project_material_transactions GROUP BY material_id
  ), ledger_alloc AS (
    SELECT material_id,project_id,sum(allocation_delta) balance FROM public.project_material_transactions
    WHERE project_id IS NOT NULL GROUP BY material_id,project_id
  ), diffs AS (
    SELECT 'warehouse' kind,m.id material_id,NULL::text project_id,m.gudang actual,coalesce(l.balance,0) expected
    FROM public.project_materials m LEFT JOIN ledger_warehouse l ON l.material_id=m.id
    WHERE abs(m.gudang-coalesce(l.balance,0))>=0.001
    UNION ALL
    SELECT 'allocation',coalesce(a.material_id,l.material_id),coalesce(a.project_id,l.project_id),
      coalesce(a.qty,0),coalesce(l.balance,0)
    FROM public.project_alokasi a FULL JOIN ledger_alloc l
      ON l.material_id=a.material_id AND l.project_id=a.project_id
    WHERE abs(coalesce(a.qty,0)-coalesce(l.balance,0))>=0.001
  )
  SELECT coalesce(jsonb_agg(to_jsonb(diffs)),'[]'::jsonb) INTO issues FROM diffs;
  RETURN jsonb_build_object('ok',jsonb_array_length(issues)=0,'issue_count',jsonb_array_length(issues),'issues',issues,'checked_at',now());
END $$;

DO $$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'create_project_materials_atomic(jsonb,text,text)',
    'update_project_material_atomic(text,text,text,text,numeric,bigint,text,text,numeric,text,text,text)',
    'restock_project_materials_atomic(jsonb,text,text,text)',
    'allocate_project_materials_atomic(text,jsonb,text,text,text)',
    'record_project_material_usage_atomic(text,date,jsonb,text,text,text,text)',
    'void_project_material_usage_atomic(text,text,text,text)',
    'set_project_material_archive_atomic(text,boolean,text,text,text)',
    'complete_project_stock_atomic(text,text,text,text)',
    'get_project_material_reconciliation()'
  ] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.'||sig||' TO authenticated, service_role';
  END LOOP;
END $$;

COMMIT;
