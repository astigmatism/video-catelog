ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS total_watch_seconds double precision NOT NULL DEFAULT 0 CHECK (total_watch_seconds >= 0);

UPDATE catalog_items
SET total_watch_seconds = 0
WHERE total_watch_seconds IS NULL;

ALTER TABLE catalog_items
  ALTER COLUMN total_watch_seconds SET DEFAULT 0,
  ALTER COLUMN total_watch_seconds SET NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_item_watch_heatmap (
  catalog_item_id uuid NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
  bucket_index integer NOT NULL CHECK (bucket_index >= 0),
  bucket_start_seconds double precision NOT NULL CHECK (bucket_start_seconds >= 0),
  bucket_end_seconds double precision NOT NULL CHECK (bucket_end_seconds > bucket_start_seconds),
  watch_seconds double precision NOT NULL DEFAULT 0 CHECK (watch_seconds >= 0),
  sample_count bigint NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalog_item_id, bucket_index)
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_watch_heatmap_catalog_item_id
  ON catalog_item_watch_heatmap (catalog_item_id, bucket_index ASC);
