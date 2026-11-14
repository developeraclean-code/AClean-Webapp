-- Categorize supplementary SOP points without changing their text, images, or
-- existing Owner/Admin write and authenticated read policies.
BEGIN;

ALTER TABLE public.team_guidelines
  ADD COLUMN category text NOT NULL DEFAULT 'umum';

ALTER TABLE public.team_guidelines
  ADD CONSTRAINT team_guidelines_category_check
  CHECK (category IN ('umum', 'cleaning', 'cek_unit', 'test_press', 'program_promo'));

-- The sole existing supplementary SOP is titled "Bonus Program". Place it in
-- the matching category while keeping its content and image references intact.
UPDATE public.team_guidelines
  SET category = 'program_promo'
  WHERE section = 'sop' AND role_scope = 'all'
    AND content ILIKE 'Bonus Program%';

NOTIFY pgrst, 'reload schema';
COMMIT;
