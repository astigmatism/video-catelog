ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumbnail_relative_path text;

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumbnail_mime_type text;

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumbnail_size_bytes bigint CHECK (thumbnail_size_bytes IS NULL OR thumbnail_size_bytes >= 0);

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumbnail_width integer CHECK (thumbnail_width IS NULL OR thumbnail_width > 0);

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS thumbnail_height integer CHECK (thumbnail_height IS NULL OR thumbnail_height > 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_thumbnail_relative_path_unique
  ON photos (thumbnail_relative_path)
  WHERE thumbnail_relative_path IS NOT NULL;
