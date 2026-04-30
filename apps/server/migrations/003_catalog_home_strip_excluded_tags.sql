ALTER TABLE catalog_home_strips
  ADD COLUMN IF NOT EXISTS excluded_tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE catalog_home_strips
SET excluded_tag_ids = '[]'::jsonb
WHERE excluded_tag_ids IS NULL;

ALTER TABLE catalog_home_strips
  ALTER COLUMN excluded_tag_ids SET DEFAULT '[]'::jsonb,
  ALTER COLUMN excluded_tag_ids SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_home_strips_excluded_tag_ids_is_array'
      AND conrelid = 'catalog_home_strips'::regclass
  ) THEN
    ALTER TABLE catalog_home_strips
      ADD CONSTRAINT catalog_home_strips_excluded_tag_ids_is_array
      CHECK (jsonb_typeof(excluded_tag_ids) = 'array');
  END IF;
END $$;
