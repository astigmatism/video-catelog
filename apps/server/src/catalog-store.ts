import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { bootstrapCatalogStateSchema, withTransaction } from './db';
import type {
  CatalogBookmark,
  CatalogHomeStrip,
  CatalogHomeStripRowCount,
  CatalogHomeStripSortCategory,
  CatalogHomeStripSortDirection,
  CatalogItem,
  CatalogTag,
  CatalogItemSourceType,
  CatalogItemStatus,
  DuplicateCheck,
  DuplicateReason,
  DuplicateReasonCode,
  HoverPreviewSprite,
  MediaProbeInfo,
  PendingIngest,
  ProcessingSnapshot,
  ViewerVisualAdjustments
} from './types';

type Queryable = Pool | PoolClient;

type AddCatalogItemInput = {
  originalName: string;
  originalIngestName?: string;
  storedName: string;
  sizeBytes: number;
  relativePath: string;
  viewCount?: number;
  usedCount?: number;
  downloadCount?: number;
  lastViewedAt?: string | null;
  lastUsedAt?: string | null;
  lastDownloadedAt?: string | null;
  status?: CatalogItemStatus;
  incomingChecksumSha256?: string | null;
  retainedChecksumSha256?: string | null;
  sourceType?: CatalogItemSourceType;
  sourceUrl?: string | null;
  sourceSite?: string | null;
  sourceRemoteId?: string | null;
  thumbnailRelativePath?: string | null;
  hoverPreviewSprite?: HoverPreviewSprite | null;
  hoverPreviewRevision?: number;
  probe?: MediaProbeInfo | null;
  viewerVisualAdjustments?: ViewerVisualAdjustments;
  processing?: ProcessingSnapshot | null;
};

type PromotePendingIngestInput = AddCatalogItemInput & {
  pendingIngestId: string;
};

type CreateCatalogBookmarkInput = {
  id?: string;
  catalogItemId: string;
  name?: string | null;
  timeSeconds: number;
  thumbnailRelativePath: string;
};

type CreateCatalogHomeStripInput = {
  name: string;
  rowCount: CatalogHomeStripRowCount;
  sortCategory: CatalogHomeStripSortCategory;
  sortDirection: CatalogHomeStripSortDirection;
  search?: string | null;
  tagIds?: string[];
  excludedTagIds?: string[];
};

type UpdateCatalogHomeStripInput = Partial<CreateCatalogHomeStripInput>;

type UpdateCatalogBookmarkInput = {
  name: string | null;
};

type CreatePendingIngestInput = {
  sourceType: CatalogItemSourceType;
  originalIngestName: string;
  visibleName: string;
  sourceUrl?: string | null;
  sourceSite?: string | null;
  sourceRemoteId?: string | null;
  tempRelativePath?: string | null;
  sizeBytes?: number | null;
  incomingChecksumSha256?: string | null;
  duplicateCheck?: DuplicateCheck;
  acknowledgedReasons?: DuplicateReason[];
  downloadState?: PendingIngest['downloadState'];
  processing?: ProcessingSnapshot | null;
};

type UpdateCatalogItemInput = Partial<Omit<CatalogItem, 'id' | 'uploadedAt'>>;
type UpdatePendingIngestInput = Partial<Omit<PendingIngest, 'id' | 'createdAt'>>;

type DeleteCatalogItemResult = {
  item: CatalogItem;
  bookmarks: CatalogBookmark[];
};

type CatalogStoreOptions = {
  pool: Pool;
};

type CatalogItemRow = {
  id: string;
  original_name: string;
  original_ingest_name: string;
  visible_name: string;
  normalized_visible_name: string;
  stored_name: string;
  size_bytes: number | string;
  uploaded_at: Date | string;
  status: CatalogItemStatus;
  relative_path: string;
  incoming_checksum_sha256: string | null;
  retained_checksum_sha256: string | null;
  source_type: CatalogItemSourceType;
  source_url: string | null;
  normalized_source_url: string | null;
  source_site: string | null;
  source_remote_id: string | null;
  thumbnail_relative_path: string | null;
  hover_preview_sprite: unknown;
  hover_preview_revision: number | string;
  probe: unknown;
  viewer_adjustment_contrast: number | string;
  viewer_adjustment_brightness: number | string;
  viewer_adjustment_saturation: number | string;
  viewer_adjustments_enabled: boolean;
  view_count: number | string;
  used_count: number | string;
  download_count: number | string;
  last_viewed_at: Date | string | null;
  last_used_at: Date | string | null;
  last_downloaded_at: Date | string | null;
  processing_stage: string | null;
  processing_percent: number | string | null;
  processing_message: string | null;
  processing_updated_at: Date | string | null;
};

type CatalogTagRow = {
  id: string;
  label: string;
  normalized_label: string;
  usage_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type CatalogItemTagHydrationRow = CatalogTagRow & {
  catalog_item_id: string;
};

type CatalogHomeStripRow = {
  id: string;
  name: string;
  display_order: number | string;
  row_count: number | string;
  sort_category: string;
  sort_direction: string;
  search_term: string | null;
  tag_ids: unknown;
  excluded_tag_ids: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type DuplicateCandidateRow = CatalogItemRow & {
  matches_name: boolean;
  matches_checksum: boolean;
  matches_source_url: boolean;
  matches_source_site_remote_id: boolean;
};

type CatalogBookmarkRow = {
  id: string;
  catalog_item_id: string;
  name: string | null;
  time_seconds: number | string;
  thumbnail_relative_path: string;
  use_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type PendingIngestRow = {
  id: string;
  created_at: Date | string;
  updated_at: Date | string;
  source_type: CatalogItemSourceType;
  original_ingest_name: string;
  visible_name: string;
  normalized_visible_name: string;
  source_url: string | null;
  normalized_source_url: string | null;
  source_site: string | null;
  source_remote_id: string | null;
  temp_relative_path: string | null;
  size_bytes: number | string | null;
  incoming_checksum_sha256: string | null;
  duplicate_reasons: unknown;
  acknowledged_reasons: unknown;
  download_state: PendingIngest['downloadState'];
  processing_stage: string | null;
  processing_percent: number | string | null;
  processing_message: string | null;
  processing_updated_at: Date | string | null;
};

const EMPTY_DUPLICATE_CHECK: DuplicateCheck = {
  hasConflicts: false,
  reasons: [],
  existingItems: []
};

const DEFAULT_DUPLICATE_REASON_CODES: DuplicateReasonCode[] = [
  'same_name',
  'exact_checksum',
  'same_source_url',
  'same_source_site_remote_id'
];

const VIEWER_VISUAL_ADJUSTMENT_MIN = 0;
const VIEWER_VISUAL_ADJUSTMENT_MAX = 2;
const DEFAULT_VIEWER_VISUAL_ADJUSTMENTS: ViewerVisualAdjustments = {
  contrast: 1,
  brightness: 1,
  saturation: 1,
  enabled: false
};

const TAG_LABEL_MAX_LENGTH = 80;
const HOME_STRIP_NAME_MAX_LENGTH = 120;
const DEFAULT_HOME_STRIP_ROW_COUNT: CatalogHomeStripRowCount = 1;
const DEFAULT_HOME_STRIP_SORT_CATEGORY: CatalogHomeStripSortCategory = 'uploadedAt';
const DEFAULT_HOME_STRIP_SORT_DIRECTION: CatalogHomeStripSortDirection = 'desc';
const DEFAULT_TAG_AUTOCOMPLETE_LIMIT = 10;
const DEFAULT_TOP_TAG_LIMIT = 10;

const CATALOG_HOME_STRIP_SORT_CATEGORIES: CatalogHomeStripSortCategory[] = [
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
];

export function normalizeVisibleName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeCatalogTagLabel(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, TAG_LABEL_MAX_LENGTH);
}

export function normalizeCatalogTagKey(value: string): string {
  return normalizeCatalogTagLabel(value).toLowerCase();
}

function normalizeCatalogHomeStripName(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, HOME_STRIP_NAME_MAX_LENGTH);

  return normalized === '' ? 'Untitled strip' : normalized;
}

function isCatalogHomeStripSortCategory(value: string): value is CatalogHomeStripSortCategory {
  return CATALOG_HOME_STRIP_SORT_CATEGORIES.includes(value as CatalogHomeStripSortCategory);
}

function normalizeCatalogHomeStripSortCategory(value: unknown): CatalogHomeStripSortCategory {
  const text = readString(value);
  return text && isCatalogHomeStripSortCategory(text) ? text : DEFAULT_HOME_STRIP_SORT_CATEGORY;
}

function normalizeCatalogHomeStripSortDirection(value: unknown): CatalogHomeStripSortDirection {
  return value === 'asc' || value === 'desc' ? value : DEFAULT_HOME_STRIP_SORT_DIRECTION;
}

function normalizeCatalogHomeStripRowCount(value: unknown): CatalogHomeStripRowCount {
  const parsed = readNumber(value);
  if (parsed === 2 || parsed === 3) {
    return parsed;
  }

  return DEFAULT_HOME_STRIP_ROW_COUNT;
}

function normalizeCatalogHomeStripSearch(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }

  const trimmed = text.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

function normalizeCatalogHomeStripTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tagIds: string[] = [];
  for (const candidate of value) {
    const tagId = readString(candidate);
    if (tagId === null) {
      continue;
    }

    const trimmedTagId = tagId.trim();
    if (trimmedTagId !== '' && !tagIds.includes(trimmedTagId)) {
      tagIds.push(trimmedTagId);
    }
  }

  return tagIds;
}

function normalizeCatalogHomeStripDisplayOrder(value: unknown): number {
  const parsed = readNumber(value);
  if (parsed === null || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizeSourceUrl(value: string): string {
  return value.trim();
}

function normalizeOptionalSourceUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeSourceUrl(value);
  return normalized === '' ? null : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeCatalogItemCounter(value: unknown): number {
  const parsed = readNumber(value);

  if (parsed === null || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizeHoverPreviewRevision(value: unknown): number {
  const parsed = readNumber(value);

  if (parsed === null || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizeViewerVisualAdjustmentValue(value: unknown): number {
  const parsed = readNumber(value);

  if (parsed === null) {
    return 1;
  }

  return Math.max(
    VIEWER_VISUAL_ADJUSTMENT_MIN,
    Math.min(VIEWER_VISUAL_ADJUSTMENT_MAX, Number(parsed.toFixed(2)))
  );
}

function normalizeViewerVisualAdjustments(
  value:
    | {
        contrast?: unknown;
        brightness?: unknown;
        saturation?: unknown;
        enabled?: unknown;
      }
    | null
    | undefined
): ViewerVisualAdjustments {
  return {
    contrast: normalizeViewerVisualAdjustmentValue(value?.contrast),
    brightness: normalizeViewerVisualAdjustmentValue(value?.brightness),
    saturation: normalizeViewerVisualAdjustmentValue(value?.saturation),
    enabled: value?.enabled === true
  };
}

function normalizeBookmarkTimeSeconds(value: unknown): number {
  const parsed = readNumber(value);

  if (parsed === null || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizeCatalogBookmarkName(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }

  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeViewCount(value: unknown): number {
  return normalizeCatalogItemCounter(value);
}

function normalizeNullableTimestamp(value: unknown): string | null {
  return readIsoString(value);
}

function readIsoString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
}

function isCatalogItemStatus(value: string): value is CatalogItemStatus {
  return (
    value === 'uploaded' ||
    value === 'pending_duplicate_check' ||
    value === 'pending_processing' ||
    value === 'processing' ||
    value === 'ready' ||
    value === 'failed'
  );
}

function isCatalogItemSourceType(value: string): value is CatalogItemSourceType {
  return value === 'upload' || value === 'yt_dlp';
}

function isDuplicateReasonCode(value: string): value is DuplicateReasonCode {
  return (
    value === 'same_name' ||
    value === 'exact_checksum' ||
    value === 'same_source_url' ||
    value === 'same_source_site_remote_id'
  );
}

function isPendingIngestDownloadState(value: string): value is PendingIngest['downloadState'] {
  return value === 'not_started' || value === 'downloaded';
}

function readDuplicateReason(value: unknown): DuplicateReason | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = readString(value.code);
  const existingItemId = readString(value.existingItemId);

  if (!code || !existingItemId || !isDuplicateReasonCode(code)) {
    return null;
  }

  return {
    code,
    existingItemId
  };
}

function readDuplicateReasons(value: unknown): DuplicateReason[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return dedupeDuplicateReasons(
    value.map(readDuplicateReason).filter((reason): reason is DuplicateReason => reason !== null)
  );
}


function createProcessingSnapshotFromColumns(
  stageValue: unknown,
  percentValue: unknown,
  messageValue: unknown,
  updatedAtValue: unknown
): ProcessingSnapshot | null {
  const stage = readString(stageValue);
  const message = readString(messageValue);
  const updatedAt = readIsoString(updatedAtValue);
  const percent = percentValue === null ? null : readNumber(percentValue);

  if (!stage || !message || !updatedAt || (percentValue !== null && percent === null)) {
    return null;
  }

  return {
    stage: stage as ProcessingSnapshot['stage'],
    percent,
    message,
    updatedAt
  };
}

function readHoverPreviewSprite(value: unknown): HoverPreviewSprite | null {
  if (!isRecord(value)) {
    return null;
  }

  const relativePath = readString(value.relativePath);
  const frameCount = readNumber(value.frameCount);
  const columns = readNumber(value.columns);
  const rows = readNumber(value.rows);
  const frameWidth = readNumber(value.frameWidth);
  const frameHeight = readNumber(value.frameHeight);

  if (
    !relativePath ||
    frameCount === null ||
    columns === null ||
    rows === null ||
    frameWidth === null ||
    frameHeight === null
  ) {
    return null;
  }

  return {
    relativePath,
    frameCount,
    columns,
    rows,
    frameWidth,
    frameHeight
  };
}

function readMediaProbeInfo(value: unknown): MediaProbeInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    durationSeconds: value.durationSeconds === null ? null : readNumber(value.durationSeconds),
    width: value.width === null ? null : readNumber(value.width),
    height: value.height === null ? null : readNumber(value.height),
    fps: value.fps === null ? null : readNumber(value.fps),
    audioPresent: value.audioPresent === null ? null : readBoolean(value.audioPresent),
    videoCodec: readString(value.videoCodec),
    audioCodec: readString(value.audioCodec),
    pixelFormat: readString(value.pixelFormat),
    containerFormat: readString(value.containerFormat),
    estimatedFrameCount:
      value.estimatedFrameCount === null ? null : readNumber(value.estimatedFrameCount),
    isBrowserSafeInput:
      value.isBrowserSafeInput === null ? null : readBoolean(value.isBrowserSafeInput)
  };
}

function cloneProcessingSnapshot(value: ProcessingSnapshot | null): ProcessingSnapshot | null {
  if (!value) {
    return null;
  }

  return {
    stage: value.stage,
    percent: value.percent,
    message: value.message,
    updatedAt: value.updatedAt
  };
}

function cloneHoverPreviewSprite(value: HoverPreviewSprite | null): HoverPreviewSprite | null {
  if (!value) {
    return null;
  }

  return {
    relativePath: value.relativePath,
    frameCount: value.frameCount,
    columns: value.columns,
    rows: value.rows,
    frameWidth: value.frameWidth,
    frameHeight: value.frameHeight
  };
}

function cloneMediaProbeInfo(value: MediaProbeInfo | null): MediaProbeInfo | null {
  if (!value) {
    return null;
  }

  return {
    durationSeconds: value.durationSeconds,
    width: value.width,
    height: value.height,
    fps: value.fps,
    audioPresent: value.audioPresent,
    videoCodec: value.videoCodec,
    audioCodec: value.audioCodec,
    pixelFormat: value.pixelFormat,
    containerFormat: value.containerFormat,
    estimatedFrameCount: value.estimatedFrameCount,
    isBrowserSafeInput: value.isBrowserSafeInput
  };
}

function cloneViewerVisualAdjustments(value: ViewerVisualAdjustments | null | undefined): ViewerVisualAdjustments {
  return normalizeViewerVisualAdjustments(value);
}

function normalizeCatalogTag(input: CatalogTag): CatalogTag {
  const label = normalizeCatalogTagLabel(input.label);
  const normalizedLabel = normalizeCatalogTagKey(input.normalizedLabel || label);
  const usageCount = normalizeCatalogItemCounter(input.usageCount);
  const createdAt = normalizeNullableTimestamp(input.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizeNullableTimestamp(input.updatedAt) ?? createdAt;

  return {
    id: input.id,
    label,
    normalizedLabel: normalizedLabel || normalizeCatalogTagKey(label),
    usageCount,
    createdAt,
    updatedAt
  };
}

function cloneCatalogTag(tag: CatalogTag): CatalogTag {
  return {
    id: tag.id,
    label: tag.label,
    normalizedLabel: tag.normalizedLabel,
    usageCount: tag.usageCount,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt
  };
}

function normalizeCatalogTags(tags: CatalogTag[] | null | undefined): CatalogTag[] {
  const seen = new Set<string>();
  const normalizedTags: CatalogTag[] = [];

  for (const tag of tags ?? []) {
    const normalized = normalizeCatalogTag(tag);
    if (normalized.label === '' || normalized.normalizedLabel === '' || seen.has(normalized.normalizedLabel)) {
      continue;
    }

    seen.add(normalized.normalizedLabel);
    normalizedTags.push(normalized);
  }

  normalizedTags.sort((left, right) => left.label.localeCompare(right.label));
  return normalizedTags;
}

function hydrateCatalogTagFromRow(row: CatalogTagRow): CatalogTag {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return normalizeCatalogTag({
    id: row.id,
    label: row.label,
    normalizedLabel: row.normalized_label,
    usageCount: normalizeCatalogItemCounter(row.usage_count),
    createdAt,
    updatedAt
  });
}

function cloneDuplicateReasons(value: DuplicateReason[]): DuplicateReason[] {
  return value.map((reason) => ({
    code: reason.code,
    existingItemId: reason.existingItemId
  }));
}

function cloneCatalogItem(item: CatalogItem): CatalogItem {
  return {
    id: item.id,
    originalName: item.originalName,
    originalIngestName: item.originalIngestName,
    visibleName: item.visibleName,
    normalizedVisibleName: item.normalizedVisibleName,
    storedName: item.storedName,
    sizeBytes: item.sizeBytes,
    uploadedAt: item.uploadedAt,
    status: item.status,
    relativePath: item.relativePath,
    incomingChecksumSha256: item.incomingChecksumSha256,
    retainedChecksumSha256: item.retainedChecksumSha256,
    sourceType: item.sourceType,
    sourceUrl: item.sourceUrl,
    sourceSite: item.sourceSite,
    sourceRemoteId: item.sourceRemoteId,
    thumbnailRelativePath: item.thumbnailRelativePath,
    hoverPreviewSprite: cloneHoverPreviewSprite(item.hoverPreviewSprite),
    hoverPreviewRevision: normalizeHoverPreviewRevision(item.hoverPreviewRevision),
    probe: cloneMediaProbeInfo(item.probe),
    viewerVisualAdjustments: cloneViewerVisualAdjustments(item.viewerVisualAdjustments),
    viewCount: item.viewCount,
    usedCount: item.usedCount,
    downloadCount: item.downloadCount,
    lastViewedAt: item.lastViewedAt,
    lastUsedAt: item.lastUsedAt,
    lastDownloadedAt: item.lastDownloadedAt,
    tags: normalizeCatalogTags(item.tags).map(cloneCatalogTag),
    processing: cloneProcessingSnapshot(item.processing)
  };
}

function cloneCatalogHomeStrip(strip: CatalogHomeStrip): CatalogHomeStrip {
  return {
    id: strip.id,
    name: strip.name,
    displayOrder: strip.displayOrder,
    rowCount: strip.rowCount,
    sortCategory: strip.sortCategory,
    sortDirection: strip.sortDirection,
    search: strip.search,
    tagIds: [...strip.tagIds],
    excludedTagIds: [...strip.excludedTagIds],
    createdAt: strip.createdAt,
    updatedAt: strip.updatedAt
  };
}

function cloneCatalogBookmark(bookmark: CatalogBookmark): CatalogBookmark {
  return {
    id: bookmark.id,
    catalogItemId: bookmark.catalogItemId,
    name: bookmark.name,
    timeSeconds: bookmark.timeSeconds,
    thumbnailRelativePath: bookmark.thumbnailRelativePath,
    useCount: bookmark.useCount,
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt
  };
}

function clonePendingIngest(pendingIngest: PendingIngest): PendingIngest {
  return {
    id: pendingIngest.id,
    createdAt: pendingIngest.createdAt,
    updatedAt: pendingIngest.updatedAt,
    sourceType: pendingIngest.sourceType,
    originalIngestName: pendingIngest.originalIngestName,
    visibleName: pendingIngest.visibleName,
    normalizedVisibleName: pendingIngest.normalizedVisibleName,
    sourceUrl: pendingIngest.sourceUrl,
    sourceSite: pendingIngest.sourceSite,
    sourceRemoteId: pendingIngest.sourceRemoteId,
    tempRelativePath: pendingIngest.tempRelativePath,
    sizeBytes: pendingIngest.sizeBytes,
    incomingChecksumSha256: pendingIngest.incomingChecksumSha256,
    duplicateCheck: {
      hasConflicts: pendingIngest.duplicateCheck.hasConflicts,
      reasons: cloneDuplicateReasons(pendingIngest.duplicateCheck.reasons),
      existingItems: pendingIngest.duplicateCheck.existingItems.map(cloneCatalogItem)
    },
    acknowledgedReasons: cloneDuplicateReasons(pendingIngest.acknowledgedReasons),
    downloadState: pendingIngest.downloadState,
    processing: cloneProcessingSnapshot(pendingIngest.processing)
  };
}

function duplicateReasonKey(reason: DuplicateReason): string {
  return `${reason.code}:${reason.existingItemId}`;
}

function dedupeDuplicateReasons(reasons: DuplicateReason[]): DuplicateReason[] {
  const seen = new Set<string>();
  const deduped: DuplicateReason[] = [];

  for (const reason of reasons) {
    const key = duplicateReasonKey(reason);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      code: reason.code,
      existingItemId: reason.existingItemId
    });
  }

  return deduped;
}

function dedupeCatalogItems(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  const deduped: CatalogItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    deduped.push(cloneCatalogItem(item));
  }

  return deduped;
}

function createDuplicateCheck(reasons: DuplicateReason[], existingItems: CatalogItem[]): DuplicateCheck {
  const dedupedReasons = dedupeDuplicateReasons(reasons);
  const dedupedExistingItems = dedupeCatalogItems(existingItems);

  return {
    hasConflicts: dedupedReasons.length > 0,
    reasons: dedupedReasons,
    existingItems: dedupedExistingItems
  };
}

function normalizeCatalogItem(input: CatalogItem): CatalogItem {
  const visibleName = input.visibleName.trim() === '' ? input.originalName : input.visibleName;
  const normalizedSourceUrl = normalizeOptionalSourceUrl(input.sourceUrl);

  return {
    id: input.id,
    originalName: input.originalName || visibleName,
    originalIngestName: input.originalIngestName || input.originalName || visibleName,
    visibleName,
    normalizedVisibleName: normalizeVisibleName(visibleName),
    storedName: input.storedName,
    sizeBytes: input.sizeBytes,
    uploadedAt: input.uploadedAt,
    status: input.status,
    relativePath: input.relativePath,
    incomingChecksumSha256: input.incomingChecksumSha256 ?? null,
    retainedChecksumSha256: input.retainedChecksumSha256 ?? null,
    sourceType: input.sourceType,
    sourceUrl: normalizedSourceUrl,
    sourceSite: input.sourceSite ?? null,
    sourceRemoteId: input.sourceRemoteId ?? null,
    thumbnailRelativePath: input.thumbnailRelativePath ?? null,
    hoverPreviewSprite: cloneHoverPreviewSprite(input.hoverPreviewSprite),
    hoverPreviewRevision: normalizeHoverPreviewRevision(input.hoverPreviewRevision),
    probe: cloneMediaProbeInfo(input.probe),
    viewerVisualAdjustments: cloneViewerVisualAdjustments(input.viewerVisualAdjustments),
    viewCount: normalizeViewCount(input.viewCount),
    usedCount: normalizeCatalogItemCounter(input.usedCount),
    downloadCount: normalizeCatalogItemCounter(input.downloadCount),
    lastViewedAt: normalizeNullableTimestamp(input.lastViewedAt),
    lastUsedAt: normalizeNullableTimestamp(input.lastUsedAt),
    lastDownloadedAt: normalizeNullableTimestamp(input.lastDownloadedAt),
    tags: normalizeCatalogTags(input.tags),
    processing: cloneProcessingSnapshot(input.processing)
  };
}

function normalizeCatalogHomeStrip(input: CatalogHomeStrip): CatalogHomeStrip {
  const createdAt = normalizeNullableTimestamp(input.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizeNullableTimestamp(input.updatedAt) ?? createdAt;

  return {
    id: input.id,
    name: normalizeCatalogHomeStripName(input.name),
    displayOrder: normalizeCatalogHomeStripDisplayOrder(input.displayOrder),
    rowCount: normalizeCatalogHomeStripRowCount(input.rowCount),
    sortCategory: normalizeCatalogHomeStripSortCategory(input.sortCategory),
    sortDirection: normalizeCatalogHomeStripSortDirection(input.sortDirection),
    search: normalizeCatalogHomeStripSearch(input.search),
    tagIds: normalizeCatalogHomeStripTagIds(input.tagIds),
    excludedTagIds: normalizeCatalogHomeStripTagIds(input.excludedTagIds),
    createdAt,
    updatedAt
  };
}

function normalizeCatalogBookmark(input: CatalogBookmark): CatalogBookmark {
  return {
    id: input.id,
    catalogItemId: input.catalogItemId,
    name: normalizeCatalogBookmarkName(input.name),
    timeSeconds: normalizeBookmarkTimeSeconds(input.timeSeconds),
    thumbnailRelativePath: input.thumbnailRelativePath.trim(),
    useCount: normalizeCatalogItemCounter(input.useCount),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

function normalizePendingIngest(input: PendingIngest): PendingIngest {
  const visibleName = input.visibleName.trim() === '' ? input.originalIngestName : input.visibleName;
  const normalizedSourceUrl = normalizeOptionalSourceUrl(input.sourceUrl);

  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    sourceType: input.sourceType,
    originalIngestName: input.originalIngestName,
    visibleName,
    normalizedVisibleName: normalizeVisibleName(visibleName),
    sourceUrl: normalizedSourceUrl,
    sourceSite: input.sourceSite ?? null,
    sourceRemoteId: input.sourceRemoteId ?? null,
    tempRelativePath: input.tempRelativePath ?? null,
    sizeBytes: input.sizeBytes ?? null,
    incomingChecksumSha256: input.incomingChecksumSha256 ?? null,
    duplicateCheck: createDuplicateCheck(input.duplicateCheck.reasons, []),
    acknowledgedReasons: dedupeDuplicateReasons(input.acknowledgedReasons),
    downloadState: input.downloadState,
    processing: cloneProcessingSnapshot(input.processing)
  };
}

function processingSnapshotToColumns(value: ProcessingSnapshot | null): {
  stage: string | null;
  percent: number | null;
  message: string | null;
  updatedAt: string | null;
} {
  if (!value) {
    return {
      stage: null,
      percent: null,
      message: null,
      updatedAt: null
    };
  }

  return {
    stage: value.stage,
    percent: value.percent,
    message: value.message,
    updatedAt: value.updatedAt
  };
}

function toJsonParameter(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function buildCatalogItemFromInput(input: AddCatalogItemInput): CatalogItem {
  const visibleName = input.originalName;

  return normalizeCatalogItem({
    id: randomUUID(),
    originalName: visibleName,
    originalIngestName: input.originalIngestName ?? visibleName,
    visibleName,
    normalizedVisibleName: normalizeVisibleName(visibleName),
    storedName: input.storedName,
    sizeBytes: input.sizeBytes,
    uploadedAt: new Date().toISOString(),
    status: input.status ?? 'uploaded',
    relativePath: input.relativePath,
    incomingChecksumSha256: input.incomingChecksumSha256 ?? null,
    retainedChecksumSha256: input.retainedChecksumSha256 ?? null,
    sourceType: input.sourceType ?? 'upload',
    sourceUrl: input.sourceUrl ?? null,
    sourceSite: input.sourceSite ?? null,
    sourceRemoteId: input.sourceRemoteId ?? null,
    thumbnailRelativePath: input.thumbnailRelativePath ?? null,
    hoverPreviewSprite: input.hoverPreviewSprite ?? null,
    hoverPreviewRevision: input.hoverPreviewRevision ?? 0,
    probe: input.probe ?? null,
    viewerVisualAdjustments: input.viewerVisualAdjustments ?? DEFAULT_VIEWER_VISUAL_ADJUSTMENTS,
    viewCount: input.viewCount ?? 0,
    usedCount: input.usedCount ?? 0,
    downloadCount: input.downloadCount ?? 0,
    lastViewedAt: input.lastViewedAt ?? null,
    lastUsedAt: input.lastUsedAt ?? null,
    lastDownloadedAt: input.lastDownloadedAt ?? null,
    tags: [],
    processing: input.processing ?? null
  });
}

function buildCatalogHomeStripFromInput(
  input: CreateCatalogHomeStripInput,
  displayOrder: number
): CatalogHomeStrip {
  const now = new Date().toISOString();

  return normalizeCatalogHomeStrip({
    id: randomUUID(),
    name: input.name,
    displayOrder,
    rowCount: input.rowCount,
    sortCategory: input.sortCategory,
    sortDirection: input.sortDirection,
    search: input.search ?? null,
    tagIds: input.tagIds ?? [],
    excludedTagIds: input.excludedTagIds ?? [],
    createdAt: now,
    updatedAt: now
  });
}

function buildCatalogBookmarkFromInput(input: CreateCatalogBookmarkInput): CatalogBookmark {
  const now = new Date().toISOString();

  return normalizeCatalogBookmark({
    id: input.id ?? randomUUID(),
    catalogItemId: input.catalogItemId,
    name: input.name ?? null,
    timeSeconds: input.timeSeconds,
    thumbnailRelativePath: input.thumbnailRelativePath,
    useCount: 0,
    createdAt: now,
    updatedAt: now
  });
}

function buildPendingIngestFromInput(input: CreatePendingIngestInput): PendingIngest {
  const now = new Date().toISOString();

  return normalizePendingIngest({
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    sourceType: input.sourceType,
    originalIngestName: input.originalIngestName,
    visibleName: input.visibleName,
    normalizedVisibleName: normalizeVisibleName(input.visibleName),
    sourceUrl: input.sourceUrl ?? null,
    sourceSite: input.sourceSite ?? null,
    sourceRemoteId: input.sourceRemoteId ?? null,
    tempRelativePath: input.tempRelativePath ?? null,
    sizeBytes: input.sizeBytes ?? null,
    incomingChecksumSha256: input.incomingChecksumSha256 ?? null,
    duplicateCheck: input.duplicateCheck ?? EMPTY_DUPLICATE_CHECK,
    acknowledgedReasons: input.acknowledgedReasons ?? [],
    downloadState: input.downloadState ?? 'not_started',
    processing: input.processing ?? null
  });
}

function hydrateCatalogItemFromRow(row: CatalogItemRow): CatalogItem {
  const processing = createProcessingSnapshotFromColumns(
    row.processing_stage,
    row.processing_percent,
    row.processing_message,
    row.processing_updated_at
  );
  const uploadedAt = readIsoString(row.uploaded_at) ?? new Date().toISOString();

  return normalizeCatalogItem({
    id: row.id,
    originalName: row.original_name,
    originalIngestName: row.original_ingest_name,
    visibleName: row.visible_name,
    normalizedVisibleName: row.normalized_visible_name,
    storedName: row.stored_name,
    sizeBytes: readNumber(row.size_bytes) ?? 0,
    uploadedAt,
    status: isCatalogItemStatus(row.status) ? row.status : 'uploaded',
    relativePath: row.relative_path,
    incomingChecksumSha256: row.incoming_checksum_sha256,
    retainedChecksumSha256: row.retained_checksum_sha256,
    sourceType: isCatalogItemSourceType(row.source_type) ? row.source_type : 'upload',
    sourceUrl: row.source_url,
    sourceSite: row.source_site,
    sourceRemoteId: row.source_remote_id,
    thumbnailRelativePath: row.thumbnail_relative_path,
    hoverPreviewSprite: readHoverPreviewSprite(row.hover_preview_sprite),
    hoverPreviewRevision: normalizeHoverPreviewRevision(row.hover_preview_revision),
    probe: readMediaProbeInfo(row.probe),
    viewerVisualAdjustments: normalizeViewerVisualAdjustments({
      contrast: row.viewer_adjustment_contrast,
      brightness: row.viewer_adjustment_brightness,
      saturation: row.viewer_adjustment_saturation,
      enabled: row.viewer_adjustments_enabled
    }),
    viewCount: normalizeViewCount(row.view_count),
    usedCount: normalizeCatalogItemCounter(row.used_count),
    downloadCount: normalizeCatalogItemCounter(row.download_count),
    lastViewedAt: normalizeNullableTimestamp(row.last_viewed_at),
    lastUsedAt: normalizeNullableTimestamp(row.last_used_at),
    lastDownloadedAt: normalizeNullableTimestamp(row.last_downloaded_at),
    tags: [],
    processing
  });
}

function hydrateCatalogHomeStripFromRow(row: CatalogHomeStripRow): CatalogHomeStrip {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return normalizeCatalogHomeStrip({
    id: row.id,
    name: row.name,
    displayOrder: normalizeCatalogHomeStripDisplayOrder(row.display_order),
    rowCount: normalizeCatalogHomeStripRowCount(row.row_count),
    sortCategory: normalizeCatalogHomeStripSortCategory(row.sort_category),
    sortDirection: normalizeCatalogHomeStripSortDirection(row.sort_direction),
    search: normalizeCatalogHomeStripSearch(row.search_term),
    tagIds: normalizeCatalogHomeStripTagIds(row.tag_ids),
    excludedTagIds: normalizeCatalogHomeStripTagIds(row.excluded_tag_ids),
    createdAt,
    updatedAt
  });
}

function hydrateCatalogBookmarkFromRow(row: CatalogBookmarkRow): CatalogBookmark {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return normalizeCatalogBookmark({
    id: row.id,
    catalogItemId: row.catalog_item_id,
    name: row.name,
    timeSeconds: readNumber(row.time_seconds) ?? 0,
    thumbnailRelativePath: row.thumbnail_relative_path,
    useCount: normalizeCatalogItemCounter(row.use_count),
    createdAt,
    updatedAt
  });
}

function hydratePendingIngestFromRow(row: PendingIngestRow): PendingIngest {
  const processing = createProcessingSnapshotFromColumns(
    row.processing_stage,
    row.processing_percent,
    row.processing_message,
    row.processing_updated_at
  );
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return normalizePendingIngest({
    id: row.id,
    createdAt,
    updatedAt,
    sourceType: isCatalogItemSourceType(row.source_type) ? row.source_type : 'upload',
    originalIngestName: row.original_ingest_name,
    visibleName: row.visible_name,
    normalizedVisibleName: row.normalized_visible_name,
    sourceUrl: row.source_url,
    sourceSite: row.source_site,
    sourceRemoteId: row.source_remote_id,
    tempRelativePath: row.temp_relative_path,
    sizeBytes: row.size_bytes === null ? null : readNumber(row.size_bytes),
    incomingChecksumSha256: row.incoming_checksum_sha256,
    duplicateCheck: createDuplicateCheck(readDuplicateReasons(row.duplicate_reasons), []),
    acknowledgedReasons: readDuplicateReasons(row.acknowledged_reasons),
    downloadState: isPendingIngestDownloadState(row.download_state)
      ? row.download_state
      : 'not_started',
    processing
  });
}


export class CatalogStore {
  private readonly itemById = new Map<string, CatalogItem>();
  private readonly bookmarkById = new Map<string, CatalogBookmark>();
  private readonly homeStripById = new Map<string, CatalogHomeStrip>();
  private readonly pendingIngestById = new Map<string, PendingIngest>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private initializationPromise: Promise<void> | null = null;
  private initialized = false;

  constructor(private readonly options: CatalogStoreOptions) {}

  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeInternal();
    }

    await this.initializationPromise;
  }

  async close(): Promise<void> {
    await this.options.pool.end();
  }

  list(): CatalogItem[] {
    this.assertInitialized();

    return Array.from(this.itemById.values())
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
      .map(cloneCatalogItem);
  }

  listHomeStrips(): CatalogHomeStrip[] {
    this.assertInitialized();

    return this.getSortedHomeStrips().map(cloneCatalogHomeStrip);
  }

  async createHomeStrip(input: CreateCatalogHomeStripInput): Promise<CatalogHomeStrip> {
    this.assertInitialized();

    return this.enqueueWrite(this.getCatalogHomeStripsWriteKey(), async () => {
      const strip = buildCatalogHomeStripFromInput(input, this.getNextHomeStripDisplayOrder());
      await this.insertCatalogHomeStrip(this.options.pool, strip);
      this.homeStripById.set(strip.id, strip);
      return cloneCatalogHomeStrip(strip);
    });
  }

  async updateHomeStrip(
    stripId: string,
    patch: UpdateCatalogHomeStripInput
  ): Promise<CatalogHomeStrip | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getCatalogHomeStripsWriteKey(), async () => {
      const currentStrip = this.homeStripById.get(stripId);
      if (!currentStrip) {
        return undefined;
      }

      const updatedStrip = normalizeCatalogHomeStrip({
        ...currentStrip,
        name: patch.name ?? currentStrip.name,
        rowCount: patch.rowCount ?? currentStrip.rowCount,
        sortCategory: patch.sortCategory ?? currentStrip.sortCategory,
        sortDirection: patch.sortDirection ?? currentStrip.sortDirection,
        search: patch.search !== undefined ? patch.search : currentStrip.search,
        tagIds: patch.tagIds !== undefined ? patch.tagIds : currentStrip.tagIds,
        excludedTagIds:
          patch.excludedTagIds !== undefined ? patch.excludedTagIds : currentStrip.excludedTagIds,
        updatedAt: new Date().toISOString()
      });

      const updated = await this.updateCatalogHomeStripRow(this.options.pool, updatedStrip);
      if (!updated) {
        this.homeStripById.delete(stripId);
        return undefined;
      }

      this.homeStripById.set(stripId, updatedStrip);
      return cloneCatalogHomeStrip(updatedStrip);
    });
  }

  async deleteHomeStrip(stripId: string): Promise<CatalogHomeStrip | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getCatalogHomeStripsWriteKey(), async () => {
      const currentStrip = this.homeStripById.get(stripId);
      if (!currentStrip) {
        return undefined;
      }

      const result = await this.options.pool.query<{ id: string }>(
        'DELETE FROM catalog_home_strips WHERE id = $1 RETURNING id',
        [stripId]
      );

      if (result.rowCount === 0) {
        this.homeStripById.delete(stripId);
        return undefined;
      }

      this.homeStripById.delete(stripId);
      await this.compactHomeStripDisplayOrders(this.options.pool);
      return cloneCatalogHomeStrip(currentStrip);
    });
  }

  async reorderHomeStrips(stripIds: string[]): Promise<CatalogHomeStrip[] | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getCatalogHomeStripsWriteKey(), async () => {
      const requestedIds = normalizeCatalogHomeStripTagIds(stripIds);
      if (requestedIds.some((stripId) => !this.homeStripById.has(stripId))) {
        return undefined;
      }

      const requestedIdSet = new Set(requestedIds);
      const orderedStrips = [
        ...requestedIds
          .map((stripId) => this.homeStripById.get(stripId))
          .filter((strip): strip is CatalogHomeStrip => strip !== undefined),
        ...this.getSortedHomeStrips().filter((strip) => !requestedIdSet.has(strip.id))
      ];

      const now = new Date().toISOString();
      const normalizedStrips = orderedStrips.map((strip, index) =>
        normalizeCatalogHomeStrip({
          ...strip,
          displayOrder: index,
          updatedAt: strip.displayOrder === index ? strip.updatedAt : now
        })
      );

      await withTransaction(this.options.pool, async (client) => {
        for (const strip of normalizedStrips) {
          await this.updateCatalogHomeStripRow(client, strip);
        }
      });

      for (const strip of normalizedStrips) {
        this.homeStripById.set(strip.id, strip);
      }

      return this.listHomeStrips();
    });
  }

  async searchTags(input: { search?: string | null; limit?: number | null } = {}): Promise<CatalogTag[]> {
    this.assertInitialized();

    const search = normalizeCatalogTagKey(input.search ?? '');
    const limit = this.normalizeTagLimit(input.limit, DEFAULT_TAG_AUTOCOMPLETE_LIMIT);

    const result = await this.options.pool.query<CatalogTagRow>(
      `
        SELECT
          t.id,
          t.label,
          t.normalized_label,
          COUNT(it.catalog_item_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_tags t
        JOIN catalog_item_tags it ON it.tag_id = t.id
        WHERE (
          $1::text = ''
          OR t.normalized_label = $1::text
          OR t.normalized_label LIKE ($1::text || '%')
          OR t.normalized_label LIKE ('%' || $1::text || '%')
        )
        GROUP BY t.id, t.label, t.normalized_label, t.created_at, t.updated_at
        ORDER BY
          CASE
            WHEN $1::text = '' THEN 3
            WHEN t.normalized_label = $1::text THEN 0
            WHEN t.normalized_label LIKE ($1::text || '%') THEN 1
            ELSE 2
          END ASC,
          usage_count DESC,
          lower(t.label) ASC
        LIMIT $2
      `,
      [search, limit]
    );

    return result.rows.map(hydrateCatalogTagFromRow);
  }

  async listMostUsedTags(limit: number | null = DEFAULT_TOP_TAG_LIMIT): Promise<CatalogTag[]> {
    this.assertInitialized();

    const safeLimit = this.normalizeTagLimit(limit, DEFAULT_TOP_TAG_LIMIT);
    const result = await this.options.pool.query<CatalogTagRow>(
      `
        SELECT
          t.id,
          t.label,
          t.normalized_label,
          COUNT(it.catalog_item_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_tags t
        JOIN catalog_item_tags it ON it.tag_id = t.id
        GROUP BY t.id, t.label, t.normalized_label, t.created_at, t.updated_at
        ORDER BY usage_count DESC, lower(t.label) ASC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map(hydrateCatalogTagFromRow);
  }

  async addCatalogItemTag(itemId: string, label: string): Promise<CatalogItem | undefined> {
    this.assertInitialized();

    const normalizedLabel = normalizeCatalogTagKey(label);
    const displayLabel = normalizeCatalogTagLabel(label);
    if (displayLabel === '' || normalizedLabel === '') {
      return this.findById(itemId);
    }

    return this.enqueueWrite(this.getCatalogTagsWriteKey(), async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const tag = await withTransaction(this.options.pool, async (client) => {
        const itemResult = await client.query<{ id: string }>(
          'SELECT id FROM catalog_items WHERE id = $1 FOR UPDATE',
          [itemId]
        );

        if (itemResult.rowCount === 0) {
          return null;
        }

        const tagResult = await client.query<CatalogTagRow>(
          `
            INSERT INTO catalog_tags (id, label, normalized_label, created_at, updated_at)
            VALUES ($1, $2, $3, now(), now())
            ON CONFLICT (normalized_label) DO UPDATE
            SET updated_at = catalog_tags.updated_at
            RETURNING
              id,
              label,
              normalized_label,
              0::bigint AS usage_count,
              created_at,
              updated_at
          `,
          [randomUUID(), displayLabel, normalizedLabel]
        );

        const tagId = tagResult.rows[0]?.id;
        if (!tagId) {
          return null;
        }

        await client.query(
          `
            INSERT INTO catalog_item_tags (catalog_item_id, tag_id, created_at)
            VALUES ($1, $2, now())
            ON CONFLICT (catalog_item_id, tag_id) DO NOTHING
          `,
          [itemId, tagId]
        );

        return await this.fetchCatalogTagSummary(client, tagId);
      });

      const latestItem = this.itemById.get(itemId);
      if (!latestItem) {
        return undefined;
      }

      if (!tag) {
        this.itemById.delete(itemId);
        return undefined;
      }

      this.syncCatalogTagUsageInCache(tag);
      const updatedItem = normalizeCatalogItem({
        ...latestItem,
        tags: this.upsertTagInList(latestItem.tags, tag)
      });
      this.itemById.set(itemId, updatedItem);
      return cloneCatalogItem(updatedItem);
    });
  }

  async removeCatalogItemTag(itemId: string, tagId: string): Promise<CatalogItem | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getCatalogTagsWriteKey(), async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const result = await withTransaction(this.options.pool, async (client) => {
        const itemResult = await client.query<{ id: string }>(
          'SELECT id FROM catalog_items WHERE id = $1 FOR UPDATE',
          [itemId]
        );

        if (itemResult.rowCount === 0) {
          return {
            itemStillExists: false,
            deleted: false,
            tag: null as CatalogTag | null
          };
        }

        const deleteResult = await client.query<{ tag_id: string }>(
          `
            DELETE FROM catalog_item_tags
            WHERE catalog_item_id = $1 AND tag_id = $2
            RETURNING tag_id
          `,
          [itemId, tagId]
        );

        return {
          itemStillExists: true,
          deleted: (deleteResult.rowCount ?? 0) > 0,
          tag: await this.fetchCatalogTagSummary(client, tagId)
        };
      });

      if (!result.itemStillExists) {
        this.itemById.delete(itemId);
        return undefined;
      }

      const latestItem = this.itemById.get(itemId);
      if (!latestItem) {
        return undefined;
      }

      if (!result.deleted) {
        return cloneCatalogItem(latestItem);
      }

      const updatedItem = normalizeCatalogItem({
        ...latestItem,
        tags: latestItem.tags.filter((candidate) => candidate.id !== tagId)
      });
      this.itemById.set(itemId, updatedItem);

      if (result.tag && result.tag.usageCount > 0) {
        this.syncCatalogTagUsageInCache(result.tag);
      } else {
        this.removeTagFromAllCachedItems(tagId);
      }

      return cloneCatalogItem(updatedItem);
    });
  }

  findByOriginalName(originalName: string): CatalogItem | undefined {
    this.assertInitialized();

    const match = Array.from(this.itemById.values()).find((item) => item.originalName === originalName);
    return match ? cloneCatalogItem(match) : undefined;
  }

  findById(itemId: string): CatalogItem | undefined {
    this.assertInitialized();

    const item = this.itemById.get(itemId);
    return item ? cloneCatalogItem(item) : undefined;
  }

  listCatalogItemBookmarks(catalogItemId: string): CatalogBookmark[] {
    this.assertInitialized();

    return Array.from(this.bookmarkById.values())
      .filter((bookmark) => bookmark.catalogItemId === catalogItemId)
      .sort((left, right) => {
        if (left.timeSeconds !== right.timeSeconds) {
          return left.timeSeconds - right.timeSeconds;
        }

        return left.createdAt.localeCompare(right.createdAt);
      })
      .map(cloneCatalogBookmark);
  }

  findCatalogItemBookmark(
    catalogItemId: string,
    bookmarkId: string
  ): CatalogBookmark | undefined {
    this.assertInitialized();

    const bookmark = this.bookmarkById.get(bookmarkId);
    if (!bookmark || bookmark.catalogItemId !== catalogItemId) {
      return undefined;
    }

    return cloneCatalogBookmark(bookmark);
  }

  findBookmarkById(bookmarkId: string): CatalogBookmark | undefined {
    this.assertInitialized();

    const bookmark = this.bookmarkById.get(bookmarkId);
    return bookmark ? cloneCatalogBookmark(bookmark) : undefined;
  }

  async createCatalogItemBookmark(
    input: CreateCatalogBookmarkInput
  ): Promise<CatalogBookmark | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemBookmarksWriteKey(input.catalogItemId);

    return this.enqueueWrite(key, async () => {
      if (!this.itemById.has(input.catalogItemId)) {
        return undefined;
      }

      const bookmark = buildCatalogBookmarkFromInput(input);
      await this.insertCatalogItemBookmark(this.options.pool, bookmark);
      this.bookmarkById.set(bookmark.id, bookmark);
      return cloneCatalogBookmark(bookmark);
    });
  }

  async updateCatalogItemBookmark(
    catalogItemId: string,
    bookmarkId: string,
    input: UpdateCatalogBookmarkInput
  ): Promise<CatalogBookmark | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemBookmarksWriteKey(catalogItemId);

    return this.enqueueWrite(key, async () => {
      const currentBookmark = this.bookmarkById.get(bookmarkId);
      if (!currentBookmark || currentBookmark.catalogItemId !== catalogItemId) {
        return undefined;
      }

      const result = await this.options.pool.query<CatalogBookmarkRow>(
        `
          UPDATE catalog_item_bookmarks
          SET
            name = $3,
            updated_at = now()
          WHERE id = $1 AND catalog_item_id = $2
          RETURNING
            id,
            catalog_item_id,
            name,
            time_seconds,
            thumbnail_relative_path,
            use_count,
            created_at,
            updated_at
        `,
        [bookmarkId, catalogItemId, normalizeCatalogBookmarkName(input.name)]
      );

      if (result.rowCount === 0) {
        this.bookmarkById.delete(bookmarkId);
        return undefined;
      }

      const updatedBookmark = hydrateCatalogBookmarkFromRow(result.rows[0]);
      this.bookmarkById.set(updatedBookmark.id, updatedBookmark);
      return cloneCatalogBookmark(updatedBookmark);
    });
  }

  async deleteCatalogItemBookmark(
    catalogItemId: string,
    bookmarkId: string
  ): Promise<CatalogBookmark | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemBookmarksWriteKey(catalogItemId);

    return this.enqueueWrite(key, async () => {
      const currentBookmark = this.bookmarkById.get(bookmarkId);
      if (!currentBookmark || currentBookmark.catalogItemId !== catalogItemId) {
        return undefined;
      }

      const result = await this.options.pool.query<{ id: string }>(
        'DELETE FROM catalog_item_bookmarks WHERE id = $1 AND catalog_item_id = $2 RETURNING id',
        [bookmarkId, catalogItemId]
      );

      if (result.rowCount === 0) {
        this.bookmarkById.delete(bookmarkId);
        return undefined;
      }

      this.bookmarkById.delete(bookmarkId);
      return cloneCatalogBookmark(currentBookmark);
    });
  }

  async incrementCatalogItemBookmarkUseCount(
    catalogItemId: string,
    bookmarkId: string
  ): Promise<CatalogBookmark | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemBookmarksWriteKey(catalogItemId);

    return this.enqueueWrite(key, async () => {
      const currentBookmark = this.bookmarkById.get(bookmarkId);
      if (!currentBookmark || currentBookmark.catalogItemId !== catalogItemId) {
        return undefined;
      }

      const result = await this.options.pool.query<CatalogBookmarkRow>(
        `
          UPDATE catalog_item_bookmarks
          SET
            use_count = use_count + 1,
            updated_at = now()
          WHERE id = $1 AND catalog_item_id = $2
          RETURNING
            id,
            catalog_item_id,
            name,
            time_seconds,
            thumbnail_relative_path,
            use_count,
            created_at,
            updated_at
        `,
        [bookmarkId, catalogItemId]
      );

      if (result.rowCount === 0) {
        this.bookmarkById.delete(bookmarkId);
        return undefined;
      }

      const updatedBookmark = hydrateCatalogBookmarkFromRow(result.rows[0]);
      this.bookmarkById.set(updatedBookmark.id, updatedBookmark);
      return cloneCatalogBookmark(updatedBookmark);
    });
  }

  async addUploadedItem(input: {
    originalName: string;
    storedName: string;
    sizeBytes: number;
    relativePath: string;
    originalIngestName?: string;
    incomingChecksumSha256?: string | null;
    retainedChecksumSha256?: string | null;
    sourceUrl?: string | null;
    sourceSite?: string | null;
    sourceRemoteId?: string | null;
  }): Promise<CatalogItem> {
    return this.addCatalogItem({
      originalName: input.originalName,
      originalIngestName: input.originalIngestName ?? input.originalName,
      storedName: input.storedName,
      sizeBytes: input.sizeBytes,
      relativePath: input.relativePath,
      status: 'uploaded',
      sourceType: 'upload',
      incomingChecksumSha256: input.incomingChecksumSha256 ?? null,
      retainedChecksumSha256: input.retainedChecksumSha256 ?? null,
      sourceUrl: input.sourceUrl ?? null,
      sourceSite: input.sourceSite ?? null,
      sourceRemoteId: input.sourceRemoteId ?? null,
      thumbnailRelativePath: null,
      hoverPreviewSprite: null,
      probe: null,
      processing: null
    });
  }

  async addCatalogItem(input: AddCatalogItemInput): Promise<CatalogItem> {
    this.assertInitialized();

    const item = buildCatalogItemFromInput(input);
    await this.insertCatalogItem(this.options.pool, item);
    this.itemById.set(item.id, item);
    return cloneCatalogItem(item);
  }

  async promotePendingIngestToCatalogItem(input: PromotePendingIngestInput): Promise<CatalogItem> {
    this.assertInitialized();

    const item = buildCatalogItemFromInput(input);
    const key = this.getPendingIngestWriteKey(input.pendingIngestId);

    return this.enqueueWrite(key, async () => {
      await withTransaction(this.options.pool, async (client) => {
        const pendingResult = await client.query<{ id: string }>(
          'SELECT id FROM pending_ingests WHERE id = $1 FOR UPDATE',
          [input.pendingIngestId]
        );

        if (pendingResult.rowCount === 0) {
          throw new Error('Pending ingest not found.');
        }

        await this.insertCatalogItem(client, item);
        await client.query('DELETE FROM pending_ingests WHERE id = $1', [input.pendingIngestId]);
      });

      this.pendingIngestById.delete(input.pendingIngestId);
      this.itemById.set(item.id, item);
      return cloneCatalogItem(item);
    });
  }

  async updateCatalogItem(itemId: string, patch: UpdateCatalogItemInput): Promise<CatalogItem | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemWriteKey(itemId);

    return this.enqueueWrite(key, async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const visibleName = patch.visibleName ?? currentItem.visibleName;
      const updatedItem = normalizeCatalogItem({
        ...currentItem,
        ...patch,
        originalName: patch.originalName ?? visibleName,
        visibleName,
        hoverPreviewSprite:
          patch.hoverPreviewSprite !== undefined ? patch.hoverPreviewSprite : currentItem.hoverPreviewSprite,
        probe: patch.probe !== undefined ? patch.probe : currentItem.probe,
        viewerVisualAdjustments:
          patch.viewerVisualAdjustments !== undefined
            ? patch.viewerVisualAdjustments
            : currentItem.viewerVisualAdjustments,
        processing: patch.processing !== undefined ? patch.processing : currentItem.processing
      });

      const updated = await this.updateCatalogItemRow(this.options.pool, updatedItem);
      if (!updated) {
        this.itemById.delete(itemId);
        return undefined;
      }

      this.itemById.set(itemId, updatedItem);
      return cloneCatalogItem(updatedItem);
    });
  }

  async incrementCatalogItemViewCount(itemId: string): Promise<CatalogItem | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemWriteKey(itemId);

    return this.enqueueWrite(key, async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const updatedItem = normalizeCatalogItem({
        ...currentItem,
        viewCount: currentItem.viewCount + 1,
        lastViewedAt: new Date().toISOString()
      });

      const updated = await this.updateCatalogItemRow(this.options.pool, updatedItem);
      if (!updated) {
        this.itemById.delete(itemId);
        return undefined;
      }

      this.itemById.set(itemId, updatedItem);
      return cloneCatalogItem(updatedItem);
    });
  }

  async incrementCatalogItemUsedCount(itemId: string): Promise<CatalogItem | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemWriteKey(itemId);

    return this.enqueueWrite(key, async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const updatedItem = normalizeCatalogItem({
        ...currentItem,
        usedCount: currentItem.usedCount + 1,
        lastUsedAt: new Date().toISOString()
      });

      const updated = await this.updateCatalogItemRow(this.options.pool, updatedItem);
      if (!updated) {
        this.itemById.delete(itemId);
        return undefined;
      }

      this.itemById.set(itemId, updatedItem);
      return cloneCatalogItem(updatedItem);
    });
  }

  async incrementCatalogItemDownloadCount(itemId: string): Promise<CatalogItem | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemWriteKey(itemId);

    return this.enqueueWrite(key, async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const updatedItem = normalizeCatalogItem({
        ...currentItem,
        downloadCount: currentItem.downloadCount + 1,
        lastDownloadedAt: new Date().toISOString()
      });

      const updated = await this.updateCatalogItemRow(this.options.pool, updatedItem);
      if (!updated) {
        this.itemById.delete(itemId);
        return undefined;
      }

      this.itemById.set(itemId, updatedItem);
      return cloneCatalogItem(updatedItem);
    });
  }

  async deleteCatalogItem(itemId: string): Promise<DeleteCatalogItemResult | undefined> {
    this.assertInitialized();

    const key = this.getCatalogItemWriteKey(itemId);

    return this.enqueueWrite(key, async () => {
      const currentItem = this.itemById.get(itemId);
      if (!currentItem) {
        return undefined;
      }

      const itemBookmarks = Array.from(this.bookmarkById.values())
        .filter((bookmark) => bookmark.catalogItemId === itemId)
        .map(cloneCatalogBookmark);

      const result = await this.options.pool.query<{ id: string }>(
        'DELETE FROM catalog_items WHERE id = $1 RETURNING id',
        [itemId]
      );

      if (result.rowCount === 0) {
        this.itemById.delete(itemId);
        for (const bookmark of itemBookmarks) {
          this.bookmarkById.delete(bookmark.id);
        }
        return undefined;
      }

      this.itemById.delete(itemId);
      for (const bookmark of itemBookmarks) {
        this.bookmarkById.delete(bookmark.id);
      }

      return {
        item: cloneCatalogItem(currentItem),
        bookmarks: itemBookmarks
      };
    });
  }

  listPendingIngests(): PendingIngest[] {
    this.assertInitialized();

    return Array.from(this.pendingIngestById.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((pendingIngest) => this.hydratePendingIngestForReturn(pendingIngest));
  }

  getPendingIngest(pendingIngestId: string): PendingIngest | undefined {
    this.assertInitialized();

    const pendingIngest = this.pendingIngestById.get(pendingIngestId);
    return pendingIngest ? this.hydratePendingIngestForReturn(pendingIngest) : undefined;
  }

  async createPendingIngest(input: CreatePendingIngestInput): Promise<PendingIngest> {
    this.assertInitialized();

    const pendingIngest = buildPendingIngestFromInput(input);
    await this.upsertPendingIngest(this.options.pool, pendingIngest);
    this.pendingIngestById.set(pendingIngest.id, pendingIngest);
    return this.hydratePendingIngestForReturn(pendingIngest);
  }

  async savePendingIngest(pendingIngest: PendingIngest): Promise<PendingIngest> {
    this.assertInitialized();

    const key = this.getPendingIngestWriteKey(pendingIngest.id);

    return this.enqueueWrite(key, async () => {
      const normalized = normalizePendingIngest({
        ...pendingIngest,
        updatedAt: new Date().toISOString()
      });

      await this.upsertPendingIngest(this.options.pool, normalized);
      this.pendingIngestById.set(normalized.id, normalized);
      return this.hydratePendingIngestForReturn(normalized);
    });
  }

  async updatePendingIngest(
    pendingIngestId: string,
    patch: UpdatePendingIngestInput
  ): Promise<PendingIngest | undefined> {
    this.assertInitialized();

    const key = this.getPendingIngestWriteKey(pendingIngestId);

    return this.enqueueWrite(key, async () => {
      const currentPendingIngest = this.pendingIngestById.get(pendingIngestId);
      if (!currentPendingIngest) {
        return undefined;
      }

      const visibleName = patch.visibleName ?? currentPendingIngest.visibleName;
      const duplicateCheck = patch.duplicateCheck ?? currentPendingIngest.duplicateCheck;
      const updatedPendingIngest = normalizePendingIngest({
        ...currentPendingIngest,
        ...patch,
        visibleName,
        updatedAt: new Date().toISOString(),
        acknowledgedReasons: dedupeDuplicateReasons(
          patch.acknowledgedReasons ?? currentPendingIngest.acknowledgedReasons
        ),
        duplicateCheck: createDuplicateCheck(duplicateCheck.reasons, []),
        processing: patch.processing !== undefined ? patch.processing : currentPendingIngest.processing
      });

      await this.upsertPendingIngest(this.options.pool, updatedPendingIngest);
      this.pendingIngestById.set(updatedPendingIngest.id, updatedPendingIngest);
      return this.hydratePendingIngestForReturn(updatedPendingIngest);
    });
  }

  async deletePendingIngest(pendingIngestId: string): Promise<void> {
    this.assertInitialized();

    const key = this.getPendingIngestWriteKey(pendingIngestId);

    await this.enqueueWrite(key, async () => {
      await this.options.pool.query('DELETE FROM pending_ingests WHERE id = $1', [pendingIngestId]);
      this.pendingIngestById.delete(pendingIngestId);
    });
  }

  async evaluateDuplicateCheck(input: {
    visibleName: string;
    incomingChecksumSha256?: string | null;
    sourceUrl?: string | null;
    sourceSite?: string | null;
    sourceRemoteId?: string | null;
    excludeItemId?: string | null;
    signals?: DuplicateReasonCode[];
  }): Promise<DuplicateCheck> {
    this.assertInitialized();

    const normalizedVisibleName = normalizeVisibleName(input.visibleName);
    const normalizedSourceUrl = normalizeOptionalSourceUrl(input.sourceUrl);
    const incomingChecksumSha256 = input.incomingChecksumSha256 ?? null;
    const sourceSite = input.sourceSite ?? null;
    const sourceRemoteId = input.sourceRemoteId ?? null;
    const excludeItemId = input.excludeItemId ?? null;
    const enabledSignals = new Set<DuplicateReasonCode>(input.signals ?? DEFAULT_DUPLICATE_REASON_CODES);

    const visibleNameParameter =
      enabledSignals.has('same_name') && normalizedVisibleName !== '' ? normalizedVisibleName : null;
    const checksumParameter =
      enabledSignals.has('exact_checksum') ? incomingChecksumSha256 : null;
    const sourceUrlParameter =
      enabledSignals.has('same_source_url') ? normalizedSourceUrl : null;
    const sourceSiteParameter =
      enabledSignals.has('same_source_site_remote_id') ? sourceSite : null;
    const sourceRemoteIdParameter =
      enabledSignals.has('same_source_site_remote_id') ? sourceRemoteId : null;

    const result = await this.options.pool.query<DuplicateCandidateRow>(
      `
        SELECT
          id,
          original_name,
          original_ingest_name,
          visible_name,
          normalized_visible_name,
          stored_name,
          size_bytes,
          uploaded_at,
          status,
          relative_path,
          incoming_checksum_sha256,
          retained_checksum_sha256,
          source_type,
          source_url,
          normalized_source_url,
          source_site,
          source_remote_id,
          thumbnail_relative_path,
          hover_preview_sprite,
          hover_preview_revision,
          probe,
          viewer_adjustment_contrast,
          viewer_adjustment_brightness,
          viewer_adjustment_saturation,
          viewer_adjustments_enabled,
          view_count,
          used_count,
          download_count,
          last_viewed_at,
          last_used_at,
          last_downloaded_at,
          processing_stage,
          processing_percent,
          processing_message,
          processing_updated_at,
          ($2::text IS NOT NULL AND normalized_visible_name = $2::text) AS matches_name,
          ($3::text IS NOT NULL AND incoming_checksum_sha256 = $3::text) AS matches_checksum,
          ($4::text IS NOT NULL AND normalized_source_url = $4::text) AS matches_source_url,
          (
            $5::text IS NOT NULL
            AND $6::text IS NOT NULL
            AND source_site = $5::text
            AND source_remote_id = $6::text
          ) AS matches_source_site_remote_id
        FROM catalog_items
        WHERE ($1::uuid IS NULL OR id <> $1::uuid)
          AND (
            ($2::text IS NOT NULL AND normalized_visible_name = $2::text)
            OR ($3::text IS NOT NULL AND incoming_checksum_sha256 = $3::text)
            OR ($4::text IS NOT NULL AND normalized_source_url = $4::text)
            OR (
              $5::text IS NOT NULL
              AND $6::text IS NOT NULL
              AND source_site = $5::text
              AND source_remote_id = $6::text
            )
          )
        ORDER BY uploaded_at DESC
      `,
      [
        excludeItemId,
        visibleNameParameter,
        checksumParameter,
        sourceUrlParameter,
        sourceSiteParameter,
        sourceRemoteIdParameter
      ]
    );

    const reasons: DuplicateReason[] = [];
    const existingItems: CatalogItem[] = [];

    for (const row of result.rows) {
      const item = hydrateCatalogItemFromRow(row);
      existingItems.push(item);

      if (row.matches_name) {
        reasons.push({
          code: 'same_name',
          existingItemId: item.id
        });
      }

      if (row.matches_checksum) {
        reasons.push({
          code: 'exact_checksum',
          existingItemId: item.id
        });
      }

      if (row.matches_source_url) {
        reasons.push({
          code: 'same_source_url',
          existingItemId: item.id
        });
      }

      if (row.matches_source_site_remote_id) {
        reasons.push({
          code: 'same_source_site_remote_id',
          existingItemId: item.id
        });
      }
    }

    return createDuplicateCheck(reasons, existingItems);
  }

  private async initializeInternal(): Promise<void> {
    await bootstrapCatalogStateSchema(this.options.pool);
    await this.loadCache();
    this.initialized = true;
  }

  private async loadCache(): Promise<void> {
    const itemsResult = await this.options.pool.query<CatalogItemRow>(
      `
        SELECT
          id,
          original_name,
          original_ingest_name,
          visible_name,
          normalized_visible_name,
          stored_name,
          size_bytes,
          uploaded_at,
          status,
          relative_path,
          incoming_checksum_sha256,
          retained_checksum_sha256,
          source_type,
          source_url,
          normalized_source_url,
          source_site,
          source_remote_id,
          thumbnail_relative_path,
          hover_preview_sprite,
          hover_preview_revision,
          probe,
          viewer_adjustment_contrast,
          viewer_adjustment_brightness,
          viewer_adjustment_saturation,
          viewer_adjustments_enabled,
          view_count,
          used_count,
          download_count,
          last_viewed_at,
          last_used_at,
          last_downloaded_at,
          processing_stage,
          processing_percent,
          processing_message,
          processing_updated_at
        FROM catalog_items
        ORDER BY uploaded_at DESC
      `
    );

    const pendingResult = await this.options.pool.query<PendingIngestRow>(
      `
        SELECT
          id,
          created_at,
          updated_at,
          source_type,
          original_ingest_name,
          visible_name,
          normalized_visible_name,
          source_url,
          normalized_source_url,
          source_site,
          source_remote_id,
          temp_relative_path,
          size_bytes,
          incoming_checksum_sha256,
          duplicate_reasons,
          acknowledged_reasons,
          download_state,
          processing_stage,
          processing_percent,
          processing_message,
          processing_updated_at
        FROM pending_ingests
        ORDER BY updated_at DESC
      `
    );

    const homeStripsResult = await this.options.pool.query<CatalogHomeStripRow>(
      `
        SELECT
          id,
          name,
          display_order,
          row_count,
          sort_category,
          sort_direction,
          search_term,
          tag_ids,
          excluded_tag_ids,
          created_at,
          updated_at
        FROM catalog_home_strips
        ORDER BY display_order ASC, created_at ASC
      `
    );

    const bookmarksResult = await this.options.pool.query<CatalogBookmarkRow>(
      `
        SELECT
          id,
          catalog_item_id,
          name,
          time_seconds,
          thumbnail_relative_path,
          use_count,
          created_at,
          updated_at
        FROM catalog_item_bookmarks
        ORDER BY catalog_item_id ASC, time_seconds ASC, created_at ASC
      `
    );

    const tagResult = await this.options.pool.query<CatalogItemTagHydrationRow>(
      `
        SELECT
          it.catalog_item_id,
          t.id,
          t.label,
          t.normalized_label,
          COUNT(all_it.catalog_item_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_item_tags it
        JOIN catalog_tags t ON t.id = it.tag_id
        LEFT JOIN catalog_item_tags all_it ON all_it.tag_id = t.id
        GROUP BY
          it.catalog_item_id,
          t.id,
          t.label,
          t.normalized_label,
          t.created_at,
          t.updated_at
        ORDER BY it.catalog_item_id ASC, lower(t.label) ASC
      `
    );

    this.itemById.clear();
    this.bookmarkById.clear();
    this.homeStripById.clear();
    this.pendingIngestById.clear();

    for (const row of itemsResult.rows) {
      const item = hydrateCatalogItemFromRow(row);
      this.itemById.set(item.id, item);
    }

    for (const row of bookmarksResult.rows) {
      const bookmark = hydrateCatalogBookmarkFromRow(row);
      if (this.itemById.has(bookmark.catalogItemId)) {
        this.bookmarkById.set(bookmark.id, bookmark);
      }
    }

    for (const row of homeStripsResult.rows) {
      const strip = hydrateCatalogHomeStripFromRow(row);
      this.homeStripById.set(strip.id, strip);
    }

    for (const row of tagResult.rows) {
      const item = this.itemById.get(row.catalog_item_id);
      if (!item) {
        continue;
      }

      const tag = hydrateCatalogTagFromRow(row);
      this.itemById.set(
        item.id,
        normalizeCatalogItem({
          ...item,
          tags: this.upsertTagInList(item.tags, tag)
        })
      );
    }

    for (const row of pendingResult.rows) {
      const pendingIngest = hydratePendingIngestFromRow(row);
      this.pendingIngestById.set(pendingIngest.id, pendingIngest);
    }
  }

  private hydratePendingIngestForReturn(pendingIngest: PendingIngest): PendingIngest {
    const normalized = normalizePendingIngest(pendingIngest);
    const existingItems = normalized.duplicateCheck.reasons
      .map((reason) => this.itemById.get(reason.existingItemId))
      .filter((item): item is CatalogItem => item !== undefined)
      .map(cloneCatalogItem);

    return clonePendingIngest({
      ...normalized,
      duplicateCheck: createDuplicateCheck(normalized.duplicateCheck.reasons, existingItems)
    });
  }

  private getCatalogItemWriteKey(itemId: string): string {
    return `catalog_item:${itemId}`;
  }

  private getCatalogItemBookmarksWriteKey(itemId: string): string {
    return `catalog_item:${itemId}:bookmarks`;
  }

  private getPendingIngestWriteKey(pendingIngestId: string): string {
    return `pending_ingest:${pendingIngestId}`;
  }

  private getCatalogHomeStripsWriteKey(): string {
    return 'catalog_home_strips';
  }

  private getCatalogTagsWriteKey(): string {
    return 'catalog_tags';
  }

  private getSortedHomeStrips(): CatalogHomeStrip[] {
    return Array.from(this.homeStripById.values()).sort((left, right) => {
      if (left.displayOrder !== right.displayOrder) {
        return left.displayOrder - right.displayOrder;
      }

      const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
      if (createdAtComparison !== 0) {
        return createdAtComparison;
      }

      return left.name.localeCompare(right.name);
    });
  }

  private getNextHomeStripDisplayOrder(): number {
    const sortedStrips = this.getSortedHomeStrips();
    const lastStrip = sortedStrips.at(-1);
    return lastStrip ? lastStrip.displayOrder + 1 : 0;
  }

  private async compactHomeStripDisplayOrders(queryable: Queryable): Promise<void> {
    const sortedStrips = this.getSortedHomeStrips();
    const now = new Date().toISOString();

    for (let index = 0; index < sortedStrips.length; index += 1) {
      const strip = sortedStrips[index];
      if (!strip || strip.displayOrder === index) {
        continue;
      }

      const updatedStrip = normalizeCatalogHomeStrip({
        ...strip,
        displayOrder: index,
        updatedAt: now
      });
      await this.updateCatalogHomeStripRow(queryable, updatedStrip);
      this.homeStripById.set(updatedStrip.id, updatedStrip);
    }
  }

  private normalizeTagLimit(value: number | null | undefined, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(1, Math.min(50, Math.floor(value)));
  }

  private upsertTagInList(tags: CatalogTag[], tag: CatalogTag): CatalogTag[] {
    return normalizeCatalogTags([
      ...tags.filter(
        (candidate) =>
          candidate.id !== tag.id && candidate.normalizedLabel !== tag.normalizedLabel
      ),
      tag
    ]);
  }

  private syncCatalogTagUsageInCache(tag: CatalogTag): void {
    const normalizedTag = normalizeCatalogTag(tag);

    for (const item of this.itemById.values()) {
      if (!item.tags.some((candidate) => candidate.id === normalizedTag.id)) {
        continue;
      }

      this.itemById.set(
        item.id,
        normalizeCatalogItem({
          ...item,
          tags: this.upsertTagInList(item.tags, normalizedTag)
        })
      );
    }
  }

  private removeTagFromAllCachedItems(tagId: string): void {
    for (const item of this.itemById.values()) {
      if (!item.tags.some((candidate) => candidate.id === tagId)) {
        continue;
      }

      this.itemById.set(
        item.id,
        normalizeCatalogItem({
          ...item,
          tags: item.tags.filter((candidate) => candidate.id !== tagId)
        })
      );
    }
  }

  private async fetchCatalogTagSummary(
    queryable: Queryable,
    tagId: string
  ): Promise<CatalogTag | null> {
    const result = await queryable.query<CatalogTagRow>(
      `
        SELECT
          t.id,
          t.label,
          t.normalized_label,
          COUNT(it.catalog_item_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_tags t
        LEFT JOIN catalog_item_tags it ON it.tag_id = t.id
        WHERE t.id = $1
        GROUP BY t.id, t.label, t.normalized_label, t.created_at, t.updated_at
      `,
      [tagId]
    );

    return result.rows[0] ? hydrateCatalogTagFromRow(result.rows[0]) : null;
  }

  private async enqueueWrite<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(key) ?? Promise.resolve();
    const current = previous.then(work, work);
    const tracked = current.then(
      () => undefined,
      () => undefined
    );

    this.writeChains.set(key, tracked);

    try {
      return await current;
    } finally {
      if (this.writeChains.get(key) === tracked) {
        this.writeChains.delete(key);
      }
    }
  }

  private async insertCatalogHomeStrip(queryable: Queryable, strip: CatalogHomeStrip): Promise<void> {
    await queryable.query(
      `
        INSERT INTO catalog_home_strips (
          id,
          name,
          display_order,
          row_count,
          sort_category,
          sort_direction,
          search_term,
          tag_ids,
          excluded_tag_ids,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz, $11::timestamptz)
      `,
      [
        strip.id,
        strip.name,
        strip.displayOrder,
        strip.rowCount,
        strip.sortCategory,
        strip.sortDirection,
        strip.search,
        toJsonParameter(strip.tagIds),
        toJsonParameter(strip.excludedTagIds),
        strip.createdAt,
        strip.updatedAt
      ]
    );
  }

  private async updateCatalogHomeStripRow(
    queryable: Queryable,
    strip: CatalogHomeStrip
  ): Promise<CatalogHomeStrip | undefined> {
    const result = await queryable.query<{ id: string }>(
      `
        UPDATE catalog_home_strips
        SET
          name = $2,
          display_order = $3,
          row_count = $4,
          sort_category = $5,
          sort_direction = $6,
          search_term = $7,
          tag_ids = $8::jsonb,
          excluded_tag_ids = $9::jsonb,
          updated_at = $10::timestamptz
        WHERE id = $1
        RETURNING id
      `,
      [
        strip.id,
        strip.name,
        strip.displayOrder,
        strip.rowCount,
        strip.sortCategory,
        strip.sortDirection,
        strip.search,
        toJsonParameter(strip.tagIds),
        toJsonParameter(strip.excludedTagIds),
        strip.updatedAt
      ]
    );

    return result.rowCount === 0 ? undefined : strip;
  }

  private async insertCatalogItemBookmark(
    queryable: Queryable,
    bookmark: CatalogBookmark
  ): Promise<void> {
    await queryable.query(
      `
        INSERT INTO catalog_item_bookmarks (
          id,
          catalog_item_id,
          name,
          time_seconds,
          thumbnail_relative_path,
          use_count,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
      `,
      [
        bookmark.id,
        bookmark.catalogItemId,
        bookmark.name,
        bookmark.timeSeconds,
        bookmark.thumbnailRelativePath,
        bookmark.useCount,
        bookmark.createdAt,
        bookmark.updatedAt
      ]
    );
  }

  private async insertCatalogItem(queryable: Queryable, item: CatalogItem): Promise<void> {
    const processing = processingSnapshotToColumns(item.processing);
    const normalizedSourceUrl = normalizeOptionalSourceUrl(item.sourceUrl);

    await queryable.query(
      `
        INSERT INTO catalog_items (
          id,
          original_name,
          original_ingest_name,
          visible_name,
          normalized_visible_name,
          stored_name,
          size_bytes,
          uploaded_at,
          status,
          relative_path,
          incoming_checksum_sha256,
          retained_checksum_sha256,
          source_type,
          source_url,
          normalized_source_url,
          source_site,
          source_remote_id,
          thumbnail_relative_path,
          hover_preview_sprite,
          hover_preview_revision,
          probe,
          viewer_adjustment_contrast,
          viewer_adjustment_brightness,
          viewer_adjustment_saturation,
          viewer_adjustments_enabled,
          view_count,
          used_count,
          download_count,
          last_viewed_at,
          last_used_at,
          last_downloaded_at,
          processing_stage,
          processing_percent,
          processing_message,
          processing_updated_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
          $19::jsonb, $20, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29::timestamptz, $30::timestamptz, $31::timestamptz, $32, $33, $34, $35::timestamptz, now()
        )
      `,
      [
        item.id,
        item.originalName,
        item.originalIngestName,
        item.visibleName,
        item.normalizedVisibleName,
        item.storedName,
        item.sizeBytes,
        item.uploadedAt,
        item.status,
        item.relativePath,
        item.incomingChecksumSha256,
        item.retainedChecksumSha256,
        item.sourceType,
        item.sourceUrl,
        normalizedSourceUrl,
        item.sourceSite,
        item.sourceRemoteId,
        item.thumbnailRelativePath,
        toJsonParameter(item.hoverPreviewSprite),
        item.hoverPreviewRevision,
        toJsonParameter(item.probe),
        item.viewerVisualAdjustments.contrast,
        item.viewerVisualAdjustments.brightness,
        item.viewerVisualAdjustments.saturation,
        item.viewerVisualAdjustments.enabled,
        item.viewCount,
        item.usedCount,
        item.downloadCount,
        item.lastViewedAt,
        item.lastUsedAt,
        item.lastDownloadedAt,
        processing.stage,
        processing.percent,
        processing.message,
        processing.updatedAt
      ]
    );
  }

  private async updateCatalogItemRow(
    queryable: Queryable,
    item: CatalogItem
  ): Promise<CatalogItem | undefined> {
    const processing = processingSnapshotToColumns(item.processing);
    const normalizedSourceUrl = normalizeOptionalSourceUrl(item.sourceUrl);

    const result = await queryable.query<{ id: string }>(
      `
        UPDATE catalog_items
        SET
          original_name = $2,
          original_ingest_name = $3,
          visible_name = $4,
          normalized_visible_name = $5,
          stored_name = $6,
          size_bytes = $7,
          status = $8,
          relative_path = $9,
          incoming_checksum_sha256 = $10,
          retained_checksum_sha256 = $11,
          source_type = $12,
          source_url = $13,
          normalized_source_url = $14,
          source_site = $15,
          source_remote_id = $16,
          thumbnail_relative_path = $17,
          hover_preview_sprite = $18::jsonb,
          hover_preview_revision = $19,
          probe = $20::jsonb,
          viewer_adjustment_contrast = $21,
          viewer_adjustment_brightness = $22,
          viewer_adjustment_saturation = $23,
          viewer_adjustments_enabled = $24,
          view_count = $25,
          used_count = $26,
          download_count = $27,
          last_viewed_at = $28::timestamptz,
          last_used_at = $29::timestamptz,
          last_downloaded_at = $30::timestamptz,
          processing_stage = $31,
          processing_percent = $32,
          processing_message = $33,
          processing_updated_at = $34::timestamptz,
          updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [
        item.id,
        item.originalName,
        item.originalIngestName,
        item.visibleName,
        item.normalizedVisibleName,
        item.storedName,
        item.sizeBytes,
        item.status,
        item.relativePath,
        item.incomingChecksumSha256,
        item.retainedChecksumSha256,
        item.sourceType,
        item.sourceUrl,
        normalizedSourceUrl,
        item.sourceSite,
        item.sourceRemoteId,
        item.thumbnailRelativePath,
        toJsonParameter(item.hoverPreviewSprite),
        item.hoverPreviewRevision,
        toJsonParameter(item.probe),
        item.viewerVisualAdjustments.contrast,
        item.viewerVisualAdjustments.brightness,
        item.viewerVisualAdjustments.saturation,
        item.viewerVisualAdjustments.enabled,
        item.viewCount,
        item.usedCount,
        item.downloadCount,
        item.lastViewedAt,
        item.lastUsedAt,
        item.lastDownloadedAt,
        processing.stage,
        processing.percent,
        processing.message,
        processing.updatedAt
      ]
    );

    return result.rowCount === 0 ? undefined : item;
  }

  private async upsertPendingIngest(queryable: Queryable, pendingIngest: PendingIngest): Promise<void> {
    const processing = processingSnapshotToColumns(pendingIngest.processing);
    const normalizedSourceUrl = normalizeOptionalSourceUrl(pendingIngest.sourceUrl);

    await queryable.query(
      `
        INSERT INTO pending_ingests (
          id,
          created_at,
          updated_at,
          source_type,
          original_ingest_name,
          visible_name,
          normalized_visible_name,
          source_url,
          normalized_source_url,
          source_site,
          source_remote_id,
          temp_relative_path,
          size_bytes,
          incoming_checksum_sha256,
          duplicate_reasons,
          acknowledged_reasons,
          download_state,
          processing_stage,
          processing_percent,
          processing_message,
          processing_updated_at
        )
        VALUES (
          $1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15::jsonb, $16::jsonb, $17, $18, $19, $20, $21::timestamptz
        )
        ON CONFLICT (id)
        DO UPDATE SET
          updated_at = EXCLUDED.updated_at,
          source_type = EXCLUDED.source_type,
          original_ingest_name = EXCLUDED.original_ingest_name,
          visible_name = EXCLUDED.visible_name,
          normalized_visible_name = EXCLUDED.normalized_visible_name,
          source_url = EXCLUDED.source_url,
          normalized_source_url = EXCLUDED.normalized_source_url,
          source_site = EXCLUDED.source_site,
          source_remote_id = EXCLUDED.source_remote_id,
          temp_relative_path = EXCLUDED.temp_relative_path,
          size_bytes = EXCLUDED.size_bytes,
          incoming_checksum_sha256 = EXCLUDED.incoming_checksum_sha256,
          duplicate_reasons = EXCLUDED.duplicate_reasons,
          acknowledged_reasons = EXCLUDED.acknowledged_reasons,
          download_state = EXCLUDED.download_state,
          processing_stage = EXCLUDED.processing_stage,
          processing_percent = EXCLUDED.processing_percent,
          processing_message = EXCLUDED.processing_message,
          processing_updated_at = EXCLUDED.processing_updated_at
      `,
      [
        pendingIngest.id,
        pendingIngest.createdAt,
        pendingIngest.updatedAt,
        pendingIngest.sourceType,
        pendingIngest.originalIngestName,
        pendingIngest.visibleName,
        pendingIngest.normalizedVisibleName,
        pendingIngest.sourceUrl,
        normalizedSourceUrl,
        pendingIngest.sourceSite,
        pendingIngest.sourceRemoteId,
        pendingIngest.tempRelativePath,
        pendingIngest.sizeBytes,
        pendingIngest.incomingChecksumSha256,
        toJsonParameter(pendingIngest.duplicateCheck.reasons),
        toJsonParameter(pendingIngest.acknowledgedReasons),
        pendingIngest.downloadState,
        processing.stage,
        processing.percent,
        processing.message,
        processing.updatedAt
      ]
    );
  }


  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('CatalogStore has not been initialized yet.');
    }
  }
}
