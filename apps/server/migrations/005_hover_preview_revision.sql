ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS hover_preview_revision integer NOT NULL DEFAULT 0 CHECK (hover_preview_revision >= 0);

UPDATE catalog_items
SET hover_preview_revision = 0
WHERE hover_preview_revision IS NULL;

ALTER TABLE catalog_items
  ALTER COLUMN hover_preview_revision SET DEFAULT 0,
  ALTER COLUMN hover_preview_revision SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_items_hover_preview_revision
  ON catalog_items (hover_preview_revision);
