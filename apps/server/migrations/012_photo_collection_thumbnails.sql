ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS thumbnail_source_photo_id uuid;

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS thumbnail_relative_path text;

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS thumbnail_mime_type text;

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS thumbnail_size_bytes bigint CHECK (thumbnail_size_bytes IS NULL OR thumbnail_size_bytes >= 0);

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS thumbnail_width integer CHECK (thumbnail_width IS NULL OR thumbnail_width > 0);

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS thumbnail_height integer CHECK (thumbnail_height IS NULL OR thumbnail_height > 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_collections_thumbnail_relative_path_unique
  ON photo_collections (thumbnail_relative_path)
  WHERE thumbnail_relative_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_photo_collections_thumbnail_source_photo_id
  ON photo_collections (thumbnail_source_photo_id)
  WHERE thumbnail_source_photo_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'photo_collections_thumbnail_source_photo_id_fkey'
      AND conrelid = 'photo_collections'::regclass
  ) THEN
    ALTER TABLE photo_collections
      ADD CONSTRAINT photo_collections_thumbnail_source_photo_id_fkey
      FOREIGN KEY (thumbnail_source_photo_id) REFERENCES photos (id) ON DELETE SET NULL;
  END IF;
END $$;
