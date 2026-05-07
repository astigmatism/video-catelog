ALTER TABLE catalog_items
  DROP CONSTRAINT IF EXISTS catalog_items_hover_preview_revision_check;

ALTER TABLE catalog_items
  ADD CONSTRAINT catalog_items_hover_preview_revision_check
  CHECK (hover_preview_revision >= -1);

UPDATE catalog_items
SET hover_preview_revision = -1;