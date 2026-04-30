import { Pool, type PoolClient } from 'pg';

export type DatabaseConfig = {
  dbConnectionString: string | null;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string | null;
};

const CATALOG_STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY,
  original_name text NOT NULL,
  original_ingest_name text NOT NULL,
  visible_name text NOT NULL,
  normalized_visible_name text NOT NULL,
  stored_name text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  uploaded_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('uploaded', 'pending_duplicate_check', 'pending_processing', 'processing', 'ready', 'failed')),
  relative_path text NOT NULL UNIQUE,
  incoming_checksum_sha256 text,
  retained_checksum_sha256 text,
  source_type text NOT NULL CHECK (source_type IN ('upload', 'yt_dlp')),
  source_url text,
  normalized_source_url text,
  source_site text,
  source_remote_id text,
  thumbnail_relative_path text,
  hover_preview_sprite jsonb,
  probe jsonb,
  viewer_adjustment_contrast double precision NOT NULL DEFAULT 1 CHECK (viewer_adjustment_contrast >= 0 AND viewer_adjustment_contrast <= 2),
  viewer_adjustment_brightness double precision NOT NULL DEFAULT 1 CHECK (viewer_adjustment_brightness >= 0 AND viewer_adjustment_brightness <= 2),
  viewer_adjustment_saturation double precision NOT NULL DEFAULT 1 CHECK (viewer_adjustment_saturation >= 0 AND viewer_adjustment_saturation <= 2),
  viewer_adjustments_enabled boolean NOT NULL DEFAULT false,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  used_count bigint NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_viewed_at timestamptz,
  last_used_at timestamptz,
  last_downloaded_at timestamptz,
  processing_stage text,
  processing_percent double precision,
  processing_message text,
  processing_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS used_count bigint NOT NULL DEFAULT 0 CHECK (used_count >= 0);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS last_downloaded_at timestamptz;

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS viewer_adjustment_contrast double precision NOT NULL DEFAULT 1 CHECK (viewer_adjustment_contrast >= 0 AND viewer_adjustment_contrast <= 2);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS viewer_adjustment_brightness double precision NOT NULL DEFAULT 1 CHECK (viewer_adjustment_brightness >= 0 AND viewer_adjustment_brightness <= 2);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS viewer_adjustment_saturation double precision NOT NULL DEFAULT 1 CHECK (viewer_adjustment_saturation >= 0 AND viewer_adjustment_saturation <= 2);

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS viewer_adjustments_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_catalog_items_uploaded_at ON catalog_items (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_items_status ON catalog_items (status);
CREATE INDEX IF NOT EXISTS idx_catalog_items_source_type ON catalog_items (source_type);
CREATE INDEX IF NOT EXISTS idx_catalog_items_normalized_visible_name ON catalog_items (normalized_visible_name);
CREATE INDEX IF NOT EXISTS idx_catalog_items_incoming_checksum_sha256
  ON catalog_items (incoming_checksum_sha256)
  WHERE incoming_checksum_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_items_normalized_source_url
  ON catalog_items (normalized_source_url)
  WHERE normalized_source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_items_source_remote
  ON catalog_items (source_site, source_remote_id)
  WHERE source_site IS NOT NULL AND source_remote_id IS NOT NULL;


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

CREATE TABLE IF NOT EXISTS catalog_item_tags (
  catalog_item_id uuid NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES catalog_tags (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalog_item_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_tags_tag_id
  ON catalog_item_tags (tag_id, catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_catalog_item_tags_catalog_item_id
  ON catalog_item_tags (catalog_item_id, tag_id);

CREATE TABLE IF NOT EXISTS catalog_item_bookmarks (
  id uuid PRIMARY KEY,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items (id) ON DELETE CASCADE,
  name text,
  time_seconds double precision NOT NULL CHECK (time_seconds >= 0),
  thumbnail_relative_path text NOT NULL,
  use_count bigint NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE catalog_item_bookmarks
  ADD COLUMN IF NOT EXISTS name text;

CREATE INDEX IF NOT EXISTS idx_catalog_item_bookmarks_catalog_item_id
  ON catalog_item_bookmarks (catalog_item_id, time_seconds ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS catalog_home_strips (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  row_count integer NOT NULL DEFAULT 1 CHECK (row_count IN (1, 2, 3)),
  sort_category text NOT NULL CHECK (sort_category IN (
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
  )),
  sort_direction text NOT NULL CHECK (sort_direction IN ('asc', 'desc')),
  search_term text,
  tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_home_strips_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT catalog_home_strips_tag_ids_is_array CHECK (jsonb_typeof(tag_ids) = 'array'),
  CONSTRAINT catalog_home_strips_excluded_tag_ids_is_array CHECK (jsonb_typeof(excluded_tag_ids) = 'array')
);

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

CREATE INDEX IF NOT EXISTS idx_catalog_home_strips_display_order
  ON catalog_home_strips (display_order ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS pending_ingests (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('upload', 'yt_dlp')),
  original_ingest_name text NOT NULL,
  visible_name text NOT NULL,
  normalized_visible_name text NOT NULL,
  source_url text,
  normalized_source_url text,
  source_site text,
  source_remote_id text,
  temp_relative_path text UNIQUE,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  incoming_checksum_sha256 text,
  duplicate_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  download_state text NOT NULL CHECK (download_state IN ('not_started', 'downloaded')),
  processing_stage text,
  processing_percent double precision,
  processing_message text,
  processing_updated_at timestamptz,
  CONSTRAINT pending_ingests_duplicate_reasons_is_array
    CHECK (jsonb_typeof(duplicate_reasons) = 'array'),
  CONSTRAINT pending_ingests_acknowledged_reasons_is_array
    CHECK (jsonb_typeof(acknowledged_reasons) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_pending_ingests_updated_at ON pending_ingests (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_ingests_source_type ON pending_ingests (source_type);
CREATE INDEX IF NOT EXISTS idx_pending_ingests_download_state ON pending_ingests (download_state);
CREATE INDEX IF NOT EXISTS idx_pending_ingests_normalized_visible_name ON pending_ingests (normalized_visible_name);
CREATE INDEX IF NOT EXISTS idx_pending_ingests_incoming_checksum_sha256
  ON pending_ingests (incoming_checksum_sha256)
  WHERE incoming_checksum_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_ingests_normalized_source_url
  ON pending_ingests (normalized_source_url)
  WHERE normalized_source_url IS NOT NULL;
`;

export function createDatabasePool(config: DatabaseConfig): Pool {
  if (config.dbConnectionString) {
    return new Pool({
      connectionString: config.dbConnectionString,
      application_name: 'video_catalog_backend'
    });
  }

  return new Pool({
    host: config.dbHost,
    port: config.dbPort,
    database: config.dbName,
    user: config.dbUser,
    password: config.dbPassword ?? undefined,
    application_name: 'video_catalog_backend'
  });
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function bootstrapCatalogStateSchema(pool: Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(CATALOG_STATE_SCHEMA_SQL);
  });
}

export function getCatalogStateSchemaSql(): string {
  return CATALOG_STATE_SCHEMA_SQL;
}
