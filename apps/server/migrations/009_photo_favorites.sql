ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

UPDATE photos
SET is_favorite = false
WHERE is_favorite IS NULL;

ALTER TABLE photos
  ALTER COLUMN is_favorite SET DEFAULT false,
  ALTER COLUMN is_favorite SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photos_collection_favorites
  ON photos (collection_id, sort_order ASC, created_at ASC)
  WHERE is_favorite = true;
