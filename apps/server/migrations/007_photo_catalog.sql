CREATE TABLE IF NOT EXISTS catalog_tags (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  normalized_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_tags_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT catalog_tags_normalized_label_not_blank CHECK (btrim(normalized_label) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_tags_normalized_label_unique
  ON catalog_tags (normalized_label);
CREATE INDEX IF NOT EXISTS idx_catalog_tags_normalized_label_pattern
  ON catalog_tags (normalized_label text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_catalog_tags_label_lower
  ON catalog_tags (lower(label));

CREATE TABLE IF NOT EXISTS photo_collections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL,
  description text,
  cover_photo_id uuid,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photo_collections_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT photo_collections_normalized_name_not_blank CHECK (btrim(normalized_name) <> '')
);

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS cover_photo_id uuid;

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0);

ALTER TABLE photo_collections
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_photo_collections_created_at
  ON photo_collections (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_collections_updated_at
  ON photo_collections (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_collections_normalized_name
  ON photo_collections (normalized_name);
CREATE INDEX IF NOT EXISTS idx_photo_collections_normalized_name_pattern
  ON photo_collections (normalized_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_photo_collections_last_viewed_at
  ON photo_collections (last_viewed_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES photo_collections (id) ON DELETE CASCADE,
  original_name text NOT NULL,
  stored_name text NOT NULL,
  relative_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 text NOT NULL,
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  sort_order integer NOT NULL DEFAULT 0,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photos_original_name_not_blank CHECK (btrim(original_name) <> ''),
  CONSTRAINT photos_stored_name_not_blank CHECK (btrim(stored_name) <> ''),
  CONSTRAINT photos_relative_path_not_blank CHECK (btrim(relative_path) <> ''),
  CONSTRAINT photos_mime_type_not_blank CHECK (btrim(mime_type) <> ''),
  CONSTRAINT photos_checksum_sha256_not_blank CHECK (btrim(checksum_sha256) <> '')
);

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS width integer CHECK (width IS NULL OR width > 0);

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS height integer CHECK (height IS NULL OR height > 0);

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0);

ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_photos_collection_sort
  ON photos (collection_id, sort_order ASC, original_name ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_photos_collection_created_at
  ON photos (collection_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_photos_checksum_sha256
  ON photos (checksum_sha256);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'photo_collections_cover_photo_id_fkey'
      AND conrelid = 'photo_collections'::regclass
  ) THEN
    ALTER TABLE photo_collections
      ADD CONSTRAINT photo_collections_cover_photo_id_fkey
      FOREIGN KEY (cover_photo_id) REFERENCES photos (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS photo_collection_tags (
  collection_id uuid NOT NULL REFERENCES photo_collections (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES catalog_tags (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_collection_tags_tag_id
  ON photo_collection_tags (tag_id, collection_id);
CREATE INDEX IF NOT EXISTS idx_photo_collection_tags_collection_id
  ON photo_collection_tags (collection_id, tag_id);
