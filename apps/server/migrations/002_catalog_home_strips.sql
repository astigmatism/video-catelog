CREATE TABLE IF NOT EXISTS catalog_home_strips (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  row_count integer NOT NULL DEFAULT 1 CHECK (row_count IN (1, 2, 3)),
  sort_category text NOT NULL CHECK (sort_category IN (
    'uploadedAt',
    'name',
    'duration',
    'viewCount',
    'usedCount',
    'downloadCount',
    'lastViewedAt',
    'resolution',
    'random'
  )),
  sort_direction text NOT NULL CHECK (sort_direction IN ('asc', 'desc')),
  search_term text,
  tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_home_strips_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT catalog_home_strips_tag_ids_is_array CHECK (jsonb_typeof(tag_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_catalog_home_strips_display_order
  ON catalog_home_strips (display_order ASC, created_at ASC);

INSERT INTO catalog_home_strips (
  id,
  name,
  display_order,
  row_count,
  sort_category,
  sort_direction,
  search_term,
  tag_ids
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'Latest Items',
  0,
  1,
  'uploadedAt',
  'desc',
  NULL,
  '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM catalog_home_strips);
