CREATE TABLE IF NOT EXISTS photo_home_strips (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  display_order integer NOT NULL CHECK (display_order >= 0),
  row_count integer NOT NULL DEFAULT 1 CHECK (row_count IN (1, 2, 3)),
  sort_category text NOT NULL CHECK (sort_category IN (
    'none',
    'createdAt',
    'name',
    'photoCount',
    'lastViewedAt',
    'viewCount',
    'random'
  )),
  sort_direction text NOT NULL CHECK (sort_direction IN ('asc', 'desc')),
  search_term text,
  tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_tag_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT photo_home_strips_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT photo_home_strips_tag_ids_is_array CHECK (jsonb_typeof(tag_ids) = 'array'),
  CONSTRAINT photo_home_strips_excluded_tag_ids_is_array CHECK (jsonb_typeof(excluded_tag_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_photo_home_strips_display_order
  ON photo_home_strips (display_order ASC, created_at ASC);

INSERT INTO photo_home_strips (
  id,
  name,
  display_order,
  row_count,
  sort_category,
  sort_direction,
  search_term,
  tag_ids,
  excluded_tag_ids
)
SELECT
  '00000000-0000-4000-8000-000000000101'::uuid,
  'Latest Collections',
  0,
  1,
  'createdAt',
  'desc',
  NULL,
  '[]'::jsonb,
  '[]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM photo_home_strips);
