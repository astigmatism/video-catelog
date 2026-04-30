ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

DO $$
DECLARE
  sort_constraint_name text;
BEGIN
  FOR sort_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'catalog_home_strips'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%sort_category%'
  LOOP
    EXECUTE format('ALTER TABLE catalog_home_strips DROP CONSTRAINT %I', sort_constraint_name);
  END LOOP;

  ALTER TABLE catalog_home_strips
    ADD CONSTRAINT catalog_home_strips_sort_category_check
    CHECK (sort_category IN (
      'none',
      'uploadedAt',
      'name',
      'duration',
      'viewCount',
      'usedCount',
      'downloadCount',
      'lastViewedAt',
      'lastUsedAt',
      'lastDownloadedAt',
      'resolution',
      'random'
    ));
END $$;
