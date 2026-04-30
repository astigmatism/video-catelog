import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  ReactNode,
  Ref
} from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GoogleLockScreen } from './GoogleLockScreen';
import {
  AUTHENTICATED_BROWSER_IDENTITY,
  GOOGLE_LOCK_BROWSER_IDENTITY,
  applyBrowserIdentity
} from './browser-identity';

type ToolAvailability = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ytDlp: boolean;
};

type CatalogItemSourceType = 'upload' | 'yt_dlp';
type CatalogItemStatus =
  | 'uploaded'
  | 'pending_duplicate_check'
  | 'pending_processing'
  | 'processing'
  | 'ready'
  | 'failed';

type DuplicateReasonCode =
  | 'same_name'
  | 'exact_checksum'
  | 'same_source_url'
  | 'same_source_site_remote_id';

type DuplicateReason = {
  code: DuplicateReasonCode;
  existingItemId: string;
};

type DuplicateCheck = {
  hasConflicts: boolean;
  reasons: DuplicateReason[];
  existingItems: CatalogItem[];
};

type PendingIngestDownloadState = 'not_started' | 'downloaded';

type ProcessingStage =
  | 'metadata_preflight'
  | 'queued'
  | 'awaiting_title_confirmation'
  | 'awaiting_duplicate_resolution'
  | 'downloading'
  | 'downloading_source'
  | 'source_download_complete'
  | 'ffprobe'
  | 'duplicate_validation_final'
  | 'retention_decision'
  | 'remuxing'
  | 'transcoding'
  | 'poster_thumbnail'
  | 'hover_thumbnails'
  | 'finalizing'
  | 'cleanup'
  | 'completed'
  | 'failed';

type ProcessingSnapshot = {
  stage: ProcessingStage;
  percent: number | null;
  message: string;
  updatedAt: string;
};

type HoverPreviewSprite = {
  relativePath: string;
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
};

type MediaProbeInfo = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  audioPresent: boolean | null;
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  containerFormat: string | null;
  estimatedFrameCount: number | null;
  isBrowserSafeInput: boolean | null;
};

type ViewerVisualAdjustments = {
  contrast: number;
  brightness: number;
  saturation: number;
  enabled: boolean;
};

type CatalogTag = {
  id: string;
  label: string;
  normalizedLabel: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

type CatalogHomeStripRowCount = 1 | 2 | 3;

type CatalogHomeStrip = {
  id: string;
  name: string;
  displayOrder: number;
  rowCount: CatalogHomeStripRowCount;
  sortCategory: CatalogSortCategory;
  sortDirection: CatalogSortDirection;
  search: string | null;
  tagIds: string[];
  excludedTagIds: string[];
  createdAt: string;
  updatedAt: string;
};

type CatalogItem = {
  id: string;
  originalName: string;
  originalIngestName: string;
  visibleName: string;
  normalizedVisibleName: string;
  storedName: string;
  sizeBytes: number;
  uploadedAt: string;
  status: CatalogItemStatus;
  relativePath: string;
  incomingChecksumSha256: string | null;
  retainedChecksumSha256: string | null;
  sourceType: CatalogItemSourceType;
  sourceUrl: string | null;
  sourceSite: string | null;
  sourceRemoteId: string | null;
  thumbnailRelativePath: string | null;
  hoverPreviewSprite: HoverPreviewSprite | null;
  probe: MediaProbeInfo | null;
  viewerVisualAdjustments: ViewerVisualAdjustments;
  viewCount: number;
  usedCount: number;
  downloadCount: number;
  lastViewedAt: string | null;
  lastDownloadedAt: string | null;
  tags: CatalogTag[];
  processing: ProcessingSnapshot | null;
};

type CatalogBookmark = {
  id: string;
  catalogItemId: string;
  name: string | null;
  timeSeconds: number;
  thumbnailRelativePath: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

type PendingIngest = {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceType: CatalogItemSourceType;
  originalIngestName: string;
  visibleName: string;
  normalizedVisibleName: string;
  sourceUrl: string | null;
  sourceSite: string | null;
  sourceRemoteId: string | null;
  tempRelativePath: string | null;
  sizeBytes: number | null;
  incomingChecksumSha256: string | null;
  duplicateCheck: DuplicateCheck;
  acknowledgedReasons: DuplicateReason[];
  downloadState: PendingIngestDownloadState;
  processing: ProcessingSnapshot | null;
};

type DuplicateResolutionAction = 'continue' | 'cancel';

type StorageUsageInfo = {
  storagePath: string;
  filesystemPath: string;
  usedBytes: number;
  totalBytes: number;
  percentUsed: number;
};

type RuntimeInfo = {
  toolAvailability: ToolAvailability;
  config: {
    idleLockMinutes: number;
    wsHeartbeatMs: number;
    port: number | null;
  };
  storageUsage: StorageUsageInfo | null;
};


type ServerToolName = 'ffmpeg' | 'yt-dlp';
type ServerToolUpdateToolStatus = 'success' | 'failed' | 'unsupported';
type ServerToolUpdateStatus = 'success' | 'partial' | 'failed' | 'unsupported';

type ServerToolUpdateAttempt = {
  tool: ServerToolName;
  attempted: boolean;
  status: ServerToolUpdateToolStatus;
  strategy: string;
  command: string | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message: string;
};

type ServerToolUpdateResult = {
  ok: boolean;
  status: ServerToolUpdateStatus;
  platform: string;
  startedAt: string;
  finishedAt: string;
  tools: ServerToolUpdateAttempt[];
  summary: string;
};

type ServerToolUpdateResponse = {
  ok: boolean;
  message: string;
  result: ServerToolUpdateResult;
  runtime: RuntimeInfo;
};

type ToolUpdateUiStatus = 'idle' | 'running' | 'success' | 'partial' | 'error';

type ToolUpdateUiState = {
  status: ToolUpdateUiStatus;
  message: string;
  result: ServerToolUpdateResult | null;
};
type SocketStateSnapshot = {
  catalogItems: CatalogItem[];
  pendingIngests: PendingIngest[];
  homeStrips: CatalogHomeStrip[];
  runtime: RuntimeInfo;
};

type HomeStripDraft = {
  name: string;
  rowCount: CatalogHomeStripRowCount;
  search: string;
  sortCategory: CatalogSortCategory;
  sortDirection: CatalogSortDirection;
  tagSearch: string;
  selectedTagIds: string[];
  excludedTagIds: string[];
};

type HomeStripEditorState = {
  mode: 'add' | 'edit';
  stripId: string | null;
  draft: HomeStripDraft;
  notice: ModalNotice | null;
  saving: boolean;
};

type CatalogHomeStripView = {
  strip: CatalogHomeStrip;
  items: CatalogItem[];
};

type JobEvent = {
  targetKind: 'catalog_item' | 'pending_ingest';
  itemId: string | null;
  pendingIngestId: string | null;
  sourceType: CatalogItemSourceType;
  visibleName: string;
  status: CatalogItemStatus | 'pending';
  processing: ProcessingSnapshot;
};

type ActivityFeedEntry = {
  id: string;
  title: string;
  sourceType: CatalogItemSourceType;
  targetKind: 'catalog_item' | 'pending_ingest';
  itemId: string | null;
  pendingIngestId: string | null;
  status: CatalogItemStatus | 'pending';
  processing: ProcessingSnapshot;
};

type ParsedIngestResponse =
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'success'; item: CatalogItem }
  | { kind: 'duplicate'; pendingIngest: PendingIngest };

type ModalProps = {
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  disableClose?: boolean;
  size?: 'default' | 'wide';
};

type IconButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
};

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

type ModalNotice = {
  tone: NoticeTone;
  text: string;
};

type ResolutionBadgeLabel = '480' | '720' | '1080' | '2K' | '4K' | '8K';

type ResolutionBadgeInfo = {
  label: ResolutionBadgeLabel;
  className: string;
  title: string;
};

type SocketConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

type ViteClientEnv = {
  readonly DEV?: boolean;
  readonly VITE_BACKEND_ORIGIN?: string;
  readonly VITE_BACKEND_PORT?: string;
  readonly VITE_BACKEND_WS_ORIGIN?: string;
  readonly VITE_BACKEND_WS_URL?: string;
};

declare const __VIDEO_CATALOG_DEV_BACKEND_PORT__: number | undefined;
declare const __VIDEO_CATALOG_DEV_BACKEND_HTTP_ORIGIN__: string | undefined;
declare const __VIDEO_CATALOG_DEV_BACKEND_WS_ORIGIN__: string | undefined;

type CatalogSortCategory =
  | 'uploadedAt'
  | 'name'
  | 'duration'
  | 'viewCount'
  | 'usedCount'
  | 'downloadCount'
  | 'lastViewedAt'
  | 'resolution'
  | 'random';

type CatalogSortDirection = 'asc' | 'desc';
type TagFilterMode = 'include' | 'exclude';

type CatalogFilters = {
  search: string;
  sortCategory: CatalogSortCategory;
  sortDirection: CatalogSortDirection;
  tagSearch: string;
  selectedTagIds: string[];
  excludedTagIds: string[];
  randomSeed: number;
};

type VisibleTagListMode = 'unlimited' | 'limited';

type VisibleTagListSettings = {
  mode: VisibleTagListMode;
  limit: number;
};

type ViewerFitMode = 'fit' | 'fill';
type ViewerSize = {
  width: number;
  height: number;
};

type ViewerPan = {
  x: number;
  y: number;
};

type ViewerLoopState = {
  startSeconds: number | null;
  endSeconds: number | null;
};

type ViewerLoopRange = {
  startSeconds: number;
  endSeconds: number;
};

type ViewerLoopShortcutPhase = 'start' | 'end' | 'reset';

type PipelineStepState = 'complete' | 'active' | 'waiting' | 'failed';

type ProcessingPipelineStep = {
  id: string;
  label: string;
  stages: ProcessingStage[];
};

type CardMediaProps = {
  item: CatalogItem;
  compact?: boolean;
  clickable?: boolean;
};

type CatalogCardProps = {
  item: CatalogItem;
  contextKey?: string;
  onOpenViewer: (item: CatalogItem) => void;
  onOpenDetails: (item: CatalogItem) => void;
  onAddTag: (itemId: string, label: string) => Promise<CatalogItem | null>;
  onRemoveTag: (itemId: string, tagId: string) => Promise<CatalogItem | null>;
  onSearchTags: (query: string) => Promise<CatalogTag[]>;
};

type HomeStripMoveDirection = 'up' | 'down';
type HomeStripDropPosition = 'before' | 'after';
type HomeStripDropTarget = { stripId: string; position: HomeStripDropPosition };

type HomeStripActionMenuProps = {
  strip: CatalogHomeStrip;
  index: number;
  totalCount: number;
  disabled?: boolean;
  className?: string;
  onMove: (stripId: string, direction: HomeStripMoveDirection) => void;
  onEdit: (strip: CatalogHomeStrip) => void;
  onDelete: (strip: CatalogHomeStrip) => void;
};

type CatalogHomeStripSectionProps = {
  view: CatalogHomeStripView;
  index: number;
  totalCount: number;
  onMove: (stripId: string, direction: HomeStripMoveDirection) => void;
  onEdit: (strip: CatalogHomeStrip) => void;
  onDelete: (strip: CatalogHomeStrip) => void;
  onOpenViewer: (item: CatalogItem) => void;
  onOpenDetails: (item: CatalogItem) => void;
  onAddTag: (itemId: string, label: string) => Promise<CatalogItem | null>;
  onRemoveTag: (itemId: string, tagId: string) => Promise<CatalogItem | null>;
  onSearchTags: (query: string) => Promise<CatalogTag[]>;
};

type CatalogTagPopoverProps = {
  item: CatalogItem;
  popoverId: string;
  popoverRef: Ref<HTMLDivElement>;
  onAddTag: (itemId: string, label: string) => Promise<CatalogItem | null>;
  onRemoveTag: (itemId: string, tagId: string) => Promise<CatalogItem | null>;
  onSearchTags: (query: string) => Promise<CatalogTag[]>;
};

type CatalogItemDetailsModalProps = {
  item: CatalogItem;
  onClose: () => void;
  onRename: (itemId: string, visibleName: string) => Promise<CatalogItem | null>;
  onDelete: (itemId: string) => Promise<boolean>;
};

type ActivityPanelItem = {
  key: string;
  title: string;
  sourceType: CatalogItemSourceType;
  status: CatalogItemStatus | 'pending';
  processing: ProcessingSnapshot;
  pendingIngest: PendingIngest | null;
  itemId: string | null;
};

type ViewerOverlayProps = {
  item: CatalogItem;
  onClose: () => void;
  onMarkUsed: (itemId: string) => Promise<boolean>;
  onSetThumbnail: (itemId: string, timeSeconds: number) => Promise<boolean>;
  onListBookmarks: (itemId: string) => Promise<CatalogBookmark[] | null>;
  onCreateBookmark: (itemId: string, timeSeconds: number) => Promise<CatalogBookmark | null>;
  onUpdateBookmarkName: (
    itemId: string,
    bookmarkId: string,
    name: string | null
  ) => Promise<CatalogBookmark | null>;
  onUseBookmark: (itemId: string, bookmarkId: string) => Promise<CatalogBookmark | null>;
  onDeleteBookmark: (itemId: string, bookmarkId: string) => Promise<boolean>;
  onSaveViewerVisualAdjustments: (
    itemId: string,
    adjustments: ViewerVisualAdjustments
  ) => Promise<CatalogItem | null>;
  attemptFullscreenOnOpen: boolean;
};

const DEFAULT_TOOL_AVAILABILITY: ToolAvailability = {
  ffmpeg: false,
  ffprobe: false,
  ytDlp: false
};

const DEFAULT_DEV_BACKEND_PORT = 3000;
const APPLICATION_WEBSOCKET_PATH = '/api/ws';
const LEGACY_WEBSOCKET_PATH = '/ws';
const APPLICATION_SOCKET_OPEN_TIMEOUT_MS = 4000;
const APPLICATION_SOCKET_FIRST_MESSAGE_TIMEOUT_MS = 2500;
const RUNTIME_REFRESH_INTERVAL_MS = 60_000;

const DEFAULT_UPLOAD_MESSAGE =
  'Choose a local video file. After staging, you can confirm or edit the catalog title before finalizing.';
const DEFAULT_IMPORT_MESSAGE =
  'Enter a supported video URL. Metadata lookup will suggest a catalog title for you to confirm before finalizing.';
const DEFAULT_TOOL_UPDATE_MESSAGE =
  'Check for and install updates to ffmpeg and yt-dlp on this server.';

const STATUS_LABELS: Record<CatalogItemStatus, string> = {
  uploaded: 'Uploaded',
  pending_duplicate_check: 'Pending duplicate check',
  pending_processing: 'Pending processing',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed'
};

const SOURCE_TYPE_LABELS: Record<CatalogItemSourceType, string> = {
  upload: 'Upload',
  yt_dlp: 'yt-dlp import'
};

const DUPLICATE_REASON_LABELS: Record<DuplicateReasonCode, string> = {
  same_name: 'Same name',
  exact_checksum: 'Exact checksum match',
  same_source_url: 'Same source URL',
  same_source_site_remote_id: 'Same remote source ID'
};

const DUPLICATE_REASON_DESCRIPTIONS: Record<DuplicateReasonCode, string> = {
  same_name: 'The incoming visible name already exists in the catalog.',
  exact_checksum: 'The incoming binary matches an existing item by checksum.',
  same_source_url: 'This source URL is already associated with an existing catalog item.',
  same_source_site_remote_id:
    'This remote source identity already exists in the catalog for the same source site.'
};

const PROCESSING_STAGE_LABELS: Record<ProcessingStage, string> = {
  metadata_preflight: 'Metadata preflight',
  queued: 'Queued',
  awaiting_title_confirmation: 'Awaiting title confirmation',
  awaiting_duplicate_resolution: 'Awaiting duplicate resolution',
  downloading: 'Uploading file',
  downloading_source: 'Downloading source media',
  source_download_complete: 'Source download complete',
  ffprobe: 'Analyzing media',
  duplicate_validation_final: 'Final duplicate validation',
  retention_decision: 'Retention decision',
  remuxing: 'Remuxing retained video',
  transcoding: 'Transcoding retained video',
  poster_thumbnail: 'Generating poster thumbnail',
  hover_thumbnails: 'Generating hover preview',
  finalizing: 'Finalizing',
  cleanup: 'Cleaning up',
  completed: 'Completed',
  failed: 'Failed'
};

const CATALOG_ITEM_PROCESSING_PIPELINES: Record<CatalogItemSourceType, ProcessingPipelineStep[]> = {
  upload: [
    {
      id: 'accepted',
      label: 'Accepted',
      stages: ['queued', 'awaiting_title_confirmation', 'awaiting_duplicate_resolution']
    },
    { id: 'analysis', label: 'Analyze', stages: ['ffprobe'] },
    { id: 'duplicate-audit', label: 'Audit', stages: ['duplicate_validation_final'] },
    { id: 'retention', label: 'Prepare', stages: ['retention_decision', 'remuxing', 'transcoding'] },
    { id: 'poster', label: 'Poster', stages: ['poster_thumbnail'] },
    { id: 'preview', label: 'Preview', stages: ['hover_thumbnails'] },
    { id: 'finalize', label: 'Finalize', stages: ['finalizing', 'cleanup', 'completed'] }
  ],
  yt_dlp: [
    {
      id: 'accepted',
      label: 'Accepted',
      stages: ['metadata_preflight', 'queued', 'awaiting_title_confirmation', 'awaiting_duplicate_resolution']
    },
    { id: 'source-download', label: 'Download', stages: ['downloading_source', 'source_download_complete'] },
    { id: 'analysis', label: 'Analyze', stages: ['ffprobe'] },
    { id: 'retention', label: 'Prepare', stages: ['retention_decision', 'remuxing', 'transcoding'] },
    { id: 'poster', label: 'Poster', stages: ['poster_thumbnail'] },
    { id: 'preview', label: 'Preview', stages: ['hover_thumbnails'] },
    { id: 'finalize', label: 'Finalize', stages: ['finalizing', 'cleanup', 'completed'] }
  ]
};

const SOCKET_CONNECTION_LABELS: Record<SocketConnectionState, string> = {
  connecting: 'Connecting live updates…',
  connected: 'Live updates connected',
  reconnecting: 'Reconnecting live updates…',
  disconnected: 'Live updates offline'
};

const CATALOG_SORT_CATEGORY_LABELS: Record<CatalogSortCategory, string> = {
  uploadedAt: 'Date added',
  name: 'Name',
  duration: 'Duration',
  viewCount: 'View count',
  usedCount: 'Used count',
  downloadCount: 'Download count',
  lastViewedAt: 'Last viewed',
  resolution: 'Resolution',
  random: 'Randomized'
};


const RESOLUTION_BADGE_TIERS: Array<{ label: ResolutionBadgeLabel; shortEdgeMin: number; className: string }> = [
  { label: '8K', shortEdgeMin: 4320, className: 'resolution-tier-8k' },
  { label: '4K', shortEdgeMin: 2160, className: 'resolution-tier-4k' },
  { label: '2K', shortEdgeMin: 1440, className: 'resolution-tier-2k' },
  { label: '1080', shortEdgeMin: 1080, className: 'resolution-tier-1080' },
  { label: '720', shortEdgeMin: 720, className: 'resolution-tier-720' },
  { label: '480', shortEdgeMin: 0, className: 'resolution-tier-480' }
];

const RECENT_ACTIVITY_LIMIT = 12;
const CARD_HOVER_PREVIEW_DELAY_MS = 200;
const HOVER_SPRITE_FRAME_INTERVAL_MS = 120;
const VIEWER_MIN_ZOOM = 1;
const VIEWER_MAX_ZOOM = 2.5;
const VIEWER_ZOOM_STEP = 0.1;
const VIEWER_PAN_STEP_FRACTION = 0.08;
const VIEWER_PAN_STEP_MIN_PX = 24;
const VIEWER_PAN_STEP_MAX_PX = 96;
const VIEWER_SEEK_SECONDS = 5;
const VIEWER_LOOP_MIN_DURATION_SECONDS = 0.1;
const VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS = 0.035;
const VIEWER_FALLBACK_FRAME_RATE = 30;
const VIEWER_PLAYBACK_RATE_MIN = 0.25;
const VIEWER_PLAYBACK_RATE_MAX = 4;
const VIEWER_PLAYBACK_RATE_STEP = 0.1;
const VIEWER_VOLUME_MIN = 0;
const VIEWER_VOLUME_MAX = 1;
const VIEWER_VOLUME_STEP = 0.05;
const VIEWER_DEFAULT_VOLUME = 0;
const VIEWER_MUTED_RESTORE_VOLUME = VIEWER_VOLUME_MAX;
const VIEWER_VISUAL_ADJUSTMENT_MIN = 0;
const VIEWER_VISUAL_ADJUSTMENT_MAX = 2;
const VIEWER_VISUAL_ADJUSTMENT_STEP = 0.01;
const DEFAULT_VIEWER_VISUAL_ADJUSTMENTS: ViewerVisualAdjustments = {
  contrast: 1,
  brightness: 1,
  saturation: 1,
  enabled: false
};
const VIEWER_TOOLBAR_AUTO_HIDE_DELAY_MS = 1500;
const TAG_LABEL_MAX_LENGTH = 80;
const DEFAULT_VISIBLE_TAG_LIST_LIMIT = 10;
const VISIBLE_TAG_LIST_SETTINGS_STORAGE_KEY = 'sugar-spice.visible-tag-list-settings';
const CATALOG_FILTERS_STORAGE_KEY = 'sugar-spice.catalog-filters';

function createCatalogRandomSeed(): number {
  if (typeof window !== 'undefined') {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const randomValues = new Uint32Array(1);
      cryptoApi.getRandomValues(randomValues);
      return randomValues[0];
    }
  }

  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

function createNextCatalogRandomSeed(currentSeed: number): number {
  const nextSeed = createCatalogRandomSeed();
  return nextSeed === currentSeed ? (nextSeed + 1) >>> 0 : nextSeed;
}

function getDefaultCatalogFilters(): CatalogFilters {
  return {
    search: '',
    sortCategory: 'uploadedAt',
    sortDirection: 'desc',
    tagSearch: '',
    selectedTagIds: [],
    excludedTagIds: [],
    randomSeed: createCatalogRandomSeed()
  };
}

function isCatalogSortCategory(value: string | null): value is CatalogSortCategory {
  return value !== null && Object.prototype.hasOwnProperty.call(CATALOG_SORT_CATEGORY_LABELS, value);
}

function isCatalogSortDirection(value: string | null): value is CatalogSortDirection {
  return value === 'asc' || value === 'desc';
}

function isCatalogHomeStripRowCount(value: number | null): value is CatalogHomeStripRowCount {
  return value === 1 || value === 2 || value === 3;
}

function normalizeCatalogHomeStripRowCount(value: unknown): CatalogHomeStripRowCount {
  const parsed = readNumber(value);
  return isCatalogHomeStripRowCount(parsed) ? parsed : 1;
}

function normalizeHomeStripText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizeStoredStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedValues = value
    .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
    .filter((candidate) => candidate !== '');

  return Array.from(new Set(normalizedValues));
}

function normalizeCatalogRandomSeed(value: unknown): number {
  const parsed = readNumber(value);

  if (parsed === null || parsed < 0) {
    return createCatalogRandomSeed();
  }

  return Math.floor(parsed) >>> 0;
}

function readStoredCatalogFilters(): CatalogFilters {
  return getDefaultCatalogFilters();
}

function getDefaultVisibleTagListSettings(): VisibleTagListSettings {
  return {
    mode: 'unlimited',
    limit: DEFAULT_VISIBLE_TAG_LIST_LIMIT
  };
}

function normalizeVisibleTagListLimit(value: unknown): number {
  const numericValue =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return DEFAULT_VISIBLE_TAG_LIST_LIMIT;
  }

  return Math.max(1, Math.floor(numericValue));
}

function readStoredVisibleTagListSettings(): VisibleTagListSettings {
  if (typeof window === 'undefined') {
    return getDefaultVisibleTagListSettings();
  }

  try {
    const rawValue = window.localStorage.getItem(VISIBLE_TAG_LIST_SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return getDefaultVisibleTagListSettings();
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isRecord(parsedValue)) {
      return getDefaultVisibleTagListSettings();
    }

    const mode = readString(parsedValue.mode);
    return {
      mode: mode === 'limited' ? 'limited' : 'unlimited',
      limit: normalizeVisibleTagListLimit(parsedValue.limit)
    };
  } catch {
    return getDefaultVisibleTagListSettings();
  }
}

function compareCatalogTagsForOptions(left: CatalogTag, right: CatalogTag): number {
  const usageDifference = right.usageCount - left.usageCount;
  if (usageDifference !== 0) {
    return usageDifference;
  }

  return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
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

function normalizeCatalogItemCount(value: unknown): number {
  const parsed = readNumber(value);

  if (parsed === null || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizeViewCount(value: unknown): number {
  return normalizeCatalogItemCount(value);
}

function normalizeCatalogTagLabel(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, TAG_LABEL_MAX_LENGTH);
}

function normalizeCatalogTagKey(value: string): string {
  return normalizeCatalogTagLabel(value).toLowerCase();
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

function isPendingIngestDownloadState(value: string): value is PendingIngestDownloadState {
  return value === 'not_started' || value === 'downloaded';
}

function isProcessingStage(value: string): value is ProcessingStage {
  return (
    value === 'metadata_preflight' ||
    value === 'queued' ||
    value === 'awaiting_title_confirmation' ||
    value === 'awaiting_duplicate_resolution' ||
    value === 'downloading' ||
    value === 'downloading_source' ||
    value === 'source_download_complete' ||
    value === 'ffprobe' ||
    value === 'duplicate_validation_final' ||
    value === 'retention_decision' ||
    value === 'remuxing' ||
    value === 'transcoding' ||
    value === 'poster_thumbnail' ||
    value === 'hover_thumbnails' ||
    value === 'finalizing' ||
    value === 'cleanup' ||
    value === 'completed' ||
    value === 'failed'
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatOptionalBytes(value: number | null): string {
  return value === null ? 'Unknown size' : formatBytes(value);
}

function formatStorageBytes(value: number): string {
  const safeValue = Math.max(0, value);
  const units = [
    { label: 'TB', bytes: 1024 ** 4 },
    { label: 'GB', bytes: 1024 ** 3 },
    { label: 'MB', bytes: 1024 ** 2 },
    { label: 'KB', bytes: 1024 }
  ];
  const unit = units.find((candidate) => safeValue >= candidate.bytes);

  if (!unit) {
    return `${Math.round(safeValue).toLocaleString()} B`;
  }

  const amount = safeValue / unit.bytes;
  const maximumFractionDigits = amount >= 100 ? 0 : 1;
  return `${amount.toLocaleString(undefined, {
    maximumFractionDigits
  })} ${unit.label}`;
}

function formatStorageUsagePercent(value: number): string {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function formatStorageUsageSummary(storageUsage: StorageUsageInfo): string {
  return `${formatStorageBytes(storageUsage.usedBytes)} used of ${formatStorageBytes(
    storageUsage.totalBytes
  )} available (${formatStorageUsagePercent(storageUsage.percentUsed)})`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatOptionalTimestamp(value: string | null): string {
  return value === null ? 'Never' : formatTimestamp(value);
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'Unknown duration';
  }

  const rounded = Math.max(0, Math.round(value));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatViewCount(value: number): string {
  const safeValue = normalizeViewCount(value);
  return `${safeValue.toLocaleString()} ${safeValue === 1 ? 'view' : 'views'}`;
}

function formatUsedCount(value: number): string {
  const safeValue = normalizeCatalogItemCount(value);
  return `${safeValue.toLocaleString()} spice`;
}

function formatDownloadCount(value: number): string {
  const safeValue = normalizeCatalogItemCount(value);
  return `${safeValue.toLocaleString()} ${safeValue === 1 ? 'download' : 'downloads'}`;
}

function formatBookmarkUseCount(value: number): string {
  const safeValue = normalizeCatalogItemCount(value);
  return `${safeValue.toLocaleString()} ${safeValue === 1 ? 'jump' : 'jumps'}`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'Working…';
  }

  return `${Math.max(0, Math.min(100, value)).toFixed(value % 1 === 0 ? 0 : 0)}%`;
}

function getToolUpdateUiStatusFromResult(result: ServerToolUpdateResult): ToolUpdateUiStatus {
  if (result.status === 'success') {
    return 'success';
  }

  if (result.status === 'partial') {
    return 'partial';
  }

  return 'error';
}

function getToolUpdateStatusClass(status: ToolUpdateUiStatus): string {
  switch (status) {
    case 'success':
      return 'is-success';
    case 'partial':
      return 'is-warning';
    case 'error':
      return 'is-error';
    case 'running':
      return 'is-info';
    case 'idle':
    default:
      return 'is-muted';
  }
}

function formatServerToolName(tool: ServerToolName): string {
  return tool === 'yt-dlp' ? 'yt-dlp' : 'ffmpeg';
}

function clampProcessingPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function getProcessingPipelineSteps(sourceType: CatalogItemSourceType): ProcessingPipelineStep[] {
  return CATALOG_ITEM_PROCESSING_PIPELINES[sourceType];
}

function getProcessingPipelineStepIndex(sourceType: CatalogItemSourceType, stage: ProcessingStage): number {
  const steps = getProcessingPipelineSteps(sourceType);
  const index = steps.findIndex((step) => step.stages.includes(stage));

  if (index !== -1) {
    return index;
  }

  if (stage === 'failed') {
    return Math.max(0, steps.length - 1);
  }

  return 0;
}

function getOverallProcessingPercent(
  sourceType: CatalogItemSourceType,
  processing: ProcessingSnapshot | null
): number | null {
  if (!processing || processing.stage === 'failed') {
    return null;
  }

  if (processing.percent !== null && Number.isFinite(processing.percent)) {
    return clampProcessingPercent(processing.percent);
  }

  const steps = getProcessingPipelineSteps(sourceType);
  const stepIndex = getProcessingPipelineStepIndex(sourceType, processing.stage);
  if (steps.length === 0) {
    return null;
  }

  return clampProcessingPercent(((stepIndex + 0.35) / steps.length) * 100);
}

function getProcessingStepState(
  sourceType: CatalogItemSourceType,
  processing: ProcessingSnapshot | null,
  stepIndex: number
): PipelineStepState {
  if (!processing) {
    return stepIndex === 0 ? 'active' : 'waiting';
  }

  const currentStepIndex = getProcessingPipelineStepIndex(sourceType, processing.stage);
  if (stepIndex < currentStepIndex) {
    return 'complete';
  }

  if (stepIndex > currentStepIndex) {
    return 'waiting';
  }

  if (processing.stage === 'completed') {
    return 'complete';
  }

  if (processing.stage === 'failed') {
    return 'failed';
  }

  return 'active';
}

function hasReadyCatalogAssets(item: CatalogItem): boolean {
  return item.status === 'ready';
}

function getReadyResolutionBadgeInfo(item: CatalogItem): ResolutionBadgeInfo | null {
  if (!hasReadyCatalogAssets(item) || !item.probe) {
    return null;
  }

  const width = normalizePositiveDimension(item.probe.width);
  const height = normalizePositiveDimension(item.probe.height);
  if (width === null || height === null) {
    return null;
  }

  return getResolutionBadgeInfo(item.probe);
}

function getDeferredMetadataText(item: CatalogItem): string {
  return item.status === 'failed'
    ? 'Unavailable because processing failed'
    : 'Available after processing completes';
}

function getCatalogItemDisplayName(item: CatalogItem): string {
  const trimmedVisibleName = item.visibleName.trim();
  return trimmedVisibleName === '' ? item.originalIngestName : trimmedVisibleName;
}

function getPendingIngestDisplayName(pendingIngest: PendingIngest): string {
  const trimmedVisibleName = pendingIngest.visibleName.trim();
  return trimmedVisibleName === '' ? pendingIngest.originalIngestName : trimmedVisibleName;
}

function pendingIngestNeedsUserAction(pendingIngest: PendingIngest): boolean {
  return (
    pendingIngest.duplicateCheck.hasConflicts ||
    pendingIngest.processing?.stage === 'awaiting_duplicate_resolution' ||
    pendingIngest.processing?.stage === 'awaiting_title_confirmation'
  );
}

function getStatusBadgeClass(status: CatalogItemStatus | 'pending'): string {
  if (status === 'ready') {
    return 'status-ready';
  }
  if (status === 'failed') {
    return 'status-failed';
  }
  if (status === 'pending') {
    return 'status-pending';
  }
  return `status-${status.replace(/_/g, '-')}`;
}

function formatResolution(probe: MediaProbeInfo | null): string {
  if (!probe || probe.width === null || probe.height === null) {
    return 'Unknown resolution';
  }

  return `${probe.width}×${probe.height}`;
}

function createAssetVersionToken(item: CatalogItem): string {
  if (item.processing?.updatedAt) {
    return item.processing.updatedAt;
  }

  if (item.thumbnailRelativePath) {
    return item.thumbnailRelativePath;
  }

  return item.uploadedAt;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (value === '' || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function createVideoAssetVersionToken(item: CatalogItem): string {
  if (item.retainedChecksumSha256) {
    return item.retainedChecksumSha256;
  }

  return item.relativePath || item.uploadedAt;
}

function buildVersionedRelativeUrl(
  pathname: string,
  item: CatalogItem,
  versionToken: string = createAssetVersionToken(item)
): string {
  const version = encodeURIComponent(versionToken);
  return `${pathname}?v=${version}`;
}

function buildPosterUrlCandidates(item: CatalogItem): string[] {
  if (!hasReadyCatalogAssets(item) || !item.thumbnailRelativePath) {
    return [];
  }

  return uniqueStrings([
    buildVersionedRelativeUrl(`/media/thumbnails/${encodeURIComponent(item.id)}`, item)
  ]);
}

function buildHoverPreviewUrlCandidates(item: CatalogItem): string[] {
  if (!hasReadyCatalogAssets(item) || !item.hoverPreviewSprite) {
    return [];
  }

  return uniqueStrings([
    buildVersionedRelativeUrl(`/media/hover-previews/${encodeURIComponent(item.id)}`, item)
  ]);
}

function buildVideoUrlCandidates(item: CatalogItem): string[] {
  return uniqueStrings([
    buildVersionedRelativeUrl(
      `/media/videos/${encodeURIComponent(item.id)}`,
      item,
      createVideoAssetVersionToken(item)
    )
  ]);
}

function buildBookmarkThumbnailUrl(bookmark: CatalogBookmark): string {
  const version = encodeURIComponent(bookmark.updatedAt || bookmark.thumbnailRelativePath || bookmark.id);
  return `/media/bookmark-thumbnails/${encodeURIComponent(bookmark.id)}?v=${version}`;
}

function buildDownloadUrl(item: CatalogItem): string {
  return buildVersionedRelativeUrl(
    `/download/videos/${encodeURIComponent(item.id)}`,
    item,
    createVideoAssetVersionToken(item)
  );
}

function normalizePositiveDimension(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function getResolutionBadgeInfo(probe: MediaProbeInfo | null): ResolutionBadgeInfo {
  const width = normalizePositiveDimension(probe?.width);
  const height = normalizePositiveDimension(probe?.height);
  const shortEdge = width !== null && height !== null ? Math.min(width, height) : 0;
  const tier =
    RESOLUTION_BADGE_TIERS.find((candidate) => shortEdge >= candidate.shortEdgeMin) ??
    RESOLUTION_BADGE_TIERS[RESOLUTION_BADGE_TIERS.length - 1];

  return {
    label: tier.label,
    className: tier.className,
    title:
      width !== null && height !== null
        ? `Resolution class ${tier.label}: ${width}×${height}`
        : `Resolution class ${tier.label}: media dimensions are unavailable`
  };
}

function clampViewerZoom(value: number): number {
  return Math.max(VIEWER_MIN_ZOOM, Math.min(VIEWER_MAX_ZOOM, Number(value.toFixed(2))));
}

function changeViewerZoom(currentZoom: number, delta: number): number {
  return clampViewerZoom(currentZoom + delta);
}

function clampViewerPanRatio(value: number): number {
  return Math.max(-1, Math.min(1, Number(value.toFixed(4))));
}

function getViewerPanStep(stageAxisSize: number): number {
  if (!Number.isFinite(stageAxisSize) || stageAxisSize <= 0) {
    return 48;
  }

  return Math.max(
    VIEWER_PAN_STEP_MIN_PX,
    Math.min(VIEWER_PAN_STEP_MAX_PX, Number((stageAxisSize * VIEWER_PAN_STEP_FRACTION).toFixed(2)))
  );
}

function clampViewerPlaybackRate(value: number): number {
  return Math.max(
    VIEWER_PLAYBACK_RATE_MIN,
    Math.min(VIEWER_PLAYBACK_RATE_MAX, Number(value.toFixed(2)))
  );
}

function changeViewerPlaybackRate(currentPlaybackRate: number, delta: number): number {
  return clampViewerPlaybackRate(currentPlaybackRate + delta);
}

function clampViewerVolume(value: number): number {
  return Math.max(
    VIEWER_VOLUME_MIN,
    Math.min(VIEWER_VOLUME_MAX, Number(value.toFixed(2)))
  );
}

function clampViewerVisualAdjustmentValue(value: number): number {
  return Math.max(
    VIEWER_VISUAL_ADJUSTMENT_MIN,
    Math.min(VIEWER_VISUAL_ADJUSTMENT_MAX, Number(value.toFixed(2)))
  );
}

function normalizeViewerVisualAdjustmentValue(value: unknown): number {
  const parsed = readNumber(value);
  return parsed === null ? 1 : clampViewerVisualAdjustmentValue(parsed);
}

function normalizeViewerVisualAdjustments(value: Partial<ViewerVisualAdjustments> | null | undefined): ViewerVisualAdjustments {
  return {
    contrast: normalizeViewerVisualAdjustmentValue(value?.contrast),
    brightness: normalizeViewerVisualAdjustmentValue(value?.brightness),
    saturation: normalizeViewerVisualAdjustmentValue(value?.saturation),
    enabled: value?.enabled === true
  };
}

function getInitialViewerVisualAdjustments(item: CatalogItem): ViewerVisualAdjustments {
  const normalized = normalizeViewerVisualAdjustments(item.viewerVisualAdjustments);

  if (!normalized.enabled) {
    return { ...DEFAULT_VIEWER_VISUAL_ADJUSTMENTS };
  }

  return normalized;
}

function areViewerVisualAdjustmentValuesDefault(value: ViewerVisualAdjustments): boolean {
  return (
    clampViewerVisualAdjustmentValue(value.contrast) === DEFAULT_VIEWER_VISUAL_ADJUSTMENTS.contrast &&
    clampViewerVisualAdjustmentValue(value.brightness) === DEFAULT_VIEWER_VISUAL_ADJUSTMENTS.brightness &&
    clampViewerVisualAdjustmentValue(value.saturation) === DEFAULT_VIEWER_VISUAL_ADJUSTMENTS.saturation
  );
}

function formatViewerVisualAdjustmentPercent(value: number): string {
  return `${Math.round(clampViewerVisualAdjustmentValue(value) * 100)}%`;
}

function getViewerVisualAdjustmentProgress(value: number): number {
  const safeValue = clampViewerVisualAdjustmentValue(value);
  const range = VIEWER_VISUAL_ADJUSTMENT_MAX - VIEWER_VISUAL_ADJUSTMENT_MIN;

  if (range <= 0) {
    return 0;
  }

  return Math.round(((safeValue - VIEWER_VISUAL_ADJUSTMENT_MIN) / range) * 100);
}

function buildViewerVisualAdjustmentFilter(value: ViewerVisualAdjustments): string {
  return [
    `contrast(${formatViewerVisualAdjustmentPercent(value.contrast)})`,
    `brightness(${formatViewerVisualAdjustmentPercent(value.brightness)})`,
    `saturate(${formatViewerVisualAdjustmentPercent(value.saturation)})`
  ].join(' ');
}

function createViewerVisualAdjustmentSliderStyle(value: number): CSSProperties {
  return {
    '--viewer-adjustment-slider-progress': `${getViewerVisualAdjustmentProgress(value)}%`
  } as CSSProperties;
}

function formatViewerPlaybackRate(value: number): string {
  return `${clampViewerPlaybackRate(value).toFixed(1)}x`;
}

function formatViewerZoomLabel(value: number): string {
  return `${Math.round(clampViewerZoom(value) * 100)}%`;
}

function formatViewerClockTime(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '--:--';
  }

  const rounded = Math.max(0, Math.floor(value));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeBookmarkName(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function getBookmarkDisplayTitle(bookmark: CatalogBookmark): string {
  return normalizeBookmarkName(bookmark.name) ?? `Moment at ${formatViewerClockTime(bookmark.timeSeconds)}`;
}

type ViewerShortcutLabelProps = {
  text: string;
  shortcut: string;
};

function ViewerShortcutLabel({ text, shortcut }: ViewerShortcutLabelProps): JSX.Element {
  const shortcutIndex = text.toLowerCase().indexOf(shortcut.toLowerCase());

  if (shortcutIndex >= 0) {
    return (
      <>
        {text.slice(0, shortcutIndex)}
        <span className="viewer-shortcut-letter">
          {text.slice(shortcutIndex, shortcutIndex + shortcut.length)}
        </span>
        {text.slice(shortcutIndex + shortcut.length)}
      </>
    );
  }

  return (
    <>
      <span>{text}</span>
      <span className="viewer-shortcut-key" aria-hidden="true">
        {shortcut.toUpperCase()}
      </span>
    </>
  );
}

function getBookmarkShortcutIndexForKey(event: KeyboardEvent): number | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }

  if (/^[1-9]$/.test(event.key)) {
    return Number(event.key) - 1;
  }

  return null;
}

function isViewerBeginningShortcutKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  return event.key === '0' || event.key === '`' || event.key === '~' || event.code === 'Backquote';
}

function claimViewerKeyboardShortcut(event: KeyboardEvent, exclusive = false): void {
  event.preventDefault();

  if (!exclusive) {
    return;
  }

  event.stopPropagation();
  event.stopImmediatePropagation();
}

function clampViewerTime(value: number, duration: number | null): number {
  const safeValue = Number.isFinite(value) ? value : 0;

  if (duration === null || !Number.isFinite(duration)) {
    return Math.max(0, safeValue);
  }

  return Math.max(0, Math.min(duration, safeValue));
}

function getViewerTimelinePercent(currentTime: number, duration: number | null): number {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (currentTime / duration) * 100));
}

function createEmptyViewerLoopState(): ViewerLoopState {
  return {
    startSeconds: null,
    endSeconds: null
  };
}

function getViewerLoopMinimumDuration(duration: number | null): number {
  if (duration !== null && Number.isFinite(duration) && duration > 0) {
    return Math.min(VIEWER_LOOP_MIN_DURATION_SECONDS, duration);
  }

  return VIEWER_LOOP_MIN_DURATION_SECONDS;
}

function normalizeViewerLoopTime(value: number, duration: number | null): number {
  return Number(clampViewerTime(value, duration).toFixed(3));
}

function getViewerLoopRange(
  loopState: ViewerLoopState,
  duration: number | null
): ViewerLoopRange | null {
  if (loopState.startSeconds === null || loopState.endSeconds === null) {
    return null;
  }

  const safeStart = normalizeViewerLoopTime(loopState.startSeconds, duration);
  const safeEnd = normalizeViewerLoopTime(loopState.endSeconds, duration);
  const startSeconds = Math.min(safeStart, safeEnd);
  const endSeconds = Math.max(safeStart, safeEnd);

  if (endSeconds - startSeconds < getViewerLoopMinimumDuration(duration)) {
    return null;
  }

  return {
    startSeconds,
    endSeconds
  };
}

function createViewerLoopRange(
  startSeconds: number,
  endSeconds: number,
  duration: number | null
): ViewerLoopRange | null {
  return getViewerLoopRange(
    {
      startSeconds,
      endSeconds
    },
    duration
  );
}

function areViewerLoopStatesEqual(left: ViewerLoopState, right: ViewerLoopState): boolean {
  return left.startSeconds === right.startSeconds && left.endSeconds === right.endSeconds;
}

function constrainViewerTimeToLoopRange(
  value: number,
  loopRange: ViewerLoopRange,
  duration: number | null,
  options: { loopAtEnd: boolean; endToleranceSeconds?: number }
): number {
  const safeValue = normalizeViewerLoopTime(value, duration);
  const endToleranceSeconds = Math.max(0, options.endToleranceSeconds ?? 0);

  if (safeValue < loopRange.startSeconds) {
    return loopRange.startSeconds;
  }

  if (safeValue > loopRange.endSeconds) {
    return loopRange.startSeconds;
  }

  if (options.loopAtEnd && safeValue >= loopRange.endSeconds - endToleranceSeconds) {
    return loopRange.startSeconds;
  }

  return safeValue;
}

function seekViewerVideo(videoElement: HTMLVideoElement, deltaSeconds: number): void {
  const currentTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0;
  const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : null;
  const nextTime = currentTime + deltaSeconds;

  if (duration === null) {
    videoElement.currentTime = Math.max(0, nextTime);
    return;
  }

  videoElement.currentTime = Math.max(0, Math.min(duration, nextTime));
}

function getViewerFrameDurationSeconds(probe: MediaProbeInfo | null, duration: number | null): number {
  const fps = probe?.fps;

  if (fps !== null && fps !== undefined && Number.isFinite(fps) && fps > 0) {
    return 1 / fps;
  }

  const estimatedFrameCount = probe?.estimatedFrameCount;

  if (
    estimatedFrameCount !== null &&
    estimatedFrameCount !== undefined &&
    Number.isFinite(estimatedFrameCount) &&
    estimatedFrameCount > 0 &&
    duration !== null &&
    Number.isFinite(duration) &&
    duration > 0
  ) {
    return duration / estimatedFrameCount;
  }

  return 1 / VIEWER_FALLBACK_FRAME_RATE;
}

function createSpriteFrameStyle(
  sprite: HoverPreviewSprite,
  frameIndex: number,
  spriteUrl: string
): CSSProperties {
  const safeFrameCount = Math.max(1, sprite.frameCount);
  const normalizedIndex = Math.max(0, Math.min(safeFrameCount - 1, frameIndex));
  const column = sprite.columns > 0 ? normalizedIndex % sprite.columns : 0;
  const row = sprite.columns > 0 ? Math.floor(normalizedIndex / sprite.columns) : 0;
  const xPercent = sprite.columns <= 1 ? 0 : (column / (sprite.columns - 1)) * 100;
  const yPercent = sprite.rows <= 1 ? 0 : (row / (sprite.rows - 1)) * 100;

  return {
    backgroundImage: `url(${JSON.stringify(spriteUrl).slice(1, -1)})`,
    backgroundPosition: `${xPercent}% ${yPercent}%`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${Math.max(1, sprite.columns) * 100}% ${Math.max(1, sprite.rows) * 100}%`
  };
}

function getMediaPlaceholderText(item: CatalogItem): string {
  if (item.thumbnailRelativePath) {
    return 'Poster available';
  }

  if (item.processing) {
    switch (item.processing.stage) {
      case 'poster_thumbnail':
        return 'Generating poster';
      case 'hover_thumbnails':
        return 'Generating hover preview';
      case 'failed':
        return 'Thumbnail unavailable';
      default:
        return PROCESSING_STAGE_LABELS[item.processing.stage];
    }
  }

  if (item.status === 'failed') {
    return 'Processing failed';
  }

  if (item.status === 'ready') {
    return 'Thumbnail unavailable';
  }

  return 'Waiting for media';
}

function describeMediaPlayError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
        return 'Autoplay was blocked by the browser. Use the Play button in the viewer.';
      case 'NotSupportedError':
        return 'The browser could not play this media format.';
      case 'AbortError':
        return 'Playback was interrupted before it could begin.';
      default:
        return error.message || `Playback failed (${error.name}).`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Playback failed for an unknown reason.';
}

function describeVideoElementError(videoElement: HTMLVideoElement | null): string {
  const mediaError = videoElement?.error;
  if (!mediaError) {
    return 'Unable to load the protected media URL for this item.';
  }

  switch (mediaError.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Video loading was aborted before playback could begin.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'A network error interrupted video loading.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'The browser could fetch the video, but failed to decode it.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'The browser rejected this media source. This usually means the video response headers or status are wrong, or the retained file is not browser-compatible.';
    default:
      return mediaError.message || 'Unable to load the protected media URL for this item.';
  }
}

function hydrateToolAvailability(value: unknown): ToolAvailability | null {
  if (!isRecord(value)) {
    return null;
  }

  const ffmpeg = readBoolean(value.ffmpeg);
  const ffprobe = readBoolean(value.ffprobe);
  const ytDlp = readBoolean(value.ytDlp);

  if (ffmpeg === null || ffprobe === null || ytDlp === null) {
    return null;
  }

  return {
    ffmpeg,
    ffprobe,
    ytDlp
  };
}

function hydrateProcessingSnapshot(value: unknown): ProcessingSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const stage = readString(value.stage);
  const percentValue = value.percent;
  const message = readString(value.message);
  const updatedAt = readString(value.updatedAt);
  const percent = percentValue === null ? null : readNumber(percentValue);

  if (!stage || !message || !updatedAt || !isProcessingStage(stage) || percent === undefined) {
    return null;
  }

  return {
    stage,
    percent,
    message,
    updatedAt
  };
}

function hydrateHoverPreviewSprite(value: unknown): HoverPreviewSprite | null {
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

function hydrateMediaProbeInfo(value: unknown): MediaProbeInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  const durationSecondsValue = value.durationSeconds;
  const widthValue = value.width;
  const heightValue = value.height;
  const fpsValue = value.fps;
  const audioPresentValue = value.audioPresent;
  const videoCodecValue = value.videoCodec;
  const audioCodecValue = value.audioCodec;
  const pixelFormatValue = value.pixelFormat;
  const containerFormatValue = value.containerFormat;
  const estimatedFrameCountValue = value.estimatedFrameCount;
  const browserSafeValue = value.isBrowserSafeInput;

  return {
    durationSeconds: durationSecondsValue === null ? null : readNumber(durationSecondsValue),
    width: widthValue === null ? null : readNumber(widthValue),
    height: heightValue === null ? null : readNumber(heightValue),
    fps: fpsValue === null ? null : readNumber(fpsValue),
    audioPresent: audioPresentValue === null ? null : readBoolean(audioPresentValue),
    videoCodec: videoCodecValue === null ? null : readString(videoCodecValue),
    audioCodec: audioCodecValue === null ? null : readString(audioCodecValue),
    pixelFormat: pixelFormatValue === null ? null : readString(pixelFormatValue),
    containerFormat: containerFormatValue === null ? null : readString(containerFormatValue),
    estimatedFrameCount:
      estimatedFrameCountValue === null ? null : readNumber(estimatedFrameCountValue),
    isBrowserSafeInput: browserSafeValue === null ? null : readBoolean(browserSafeValue)
  };
}

function hydrateViewerVisualAdjustments(value: unknown): ViewerVisualAdjustments {
  if (!isRecord(value)) {
    return { ...DEFAULT_VIEWER_VISUAL_ADJUSTMENTS };
  }

  return normalizeViewerVisualAdjustments({
    contrast: normalizeViewerVisualAdjustmentValue(value.contrast),
    brightness: normalizeViewerVisualAdjustmentValue(value.brightness),
    saturation: normalizeViewerVisualAdjustmentValue(value.saturation),
    enabled: readBoolean(value.enabled) === true
  });
}

function hydrateCatalogTag(value: unknown): CatalogTag | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const label = readString(value.label);
  const normalizedLabel = readString(value.normalizedLabel);
  const usageCount = readNumber(value.usageCount);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);

  if (!id || !label || !normalizedLabel || usageCount === null || !createdAt || !updatedAt) {
    return null;
  }

  const displayLabel = normalizeCatalogTagLabel(label);
  const normalizedKey = normalizeCatalogTagKey(normalizedLabel);

  if (displayLabel === '' || normalizedKey === '') {
    return null;
  }

  return {
    id,
    label: displayLabel,
    normalizedLabel: normalizedKey,
    usageCount: normalizeCatalogItemCount(usageCount),
    createdAt,
    updatedAt
  };
}

function hydrateCatalogHomeStrip(value: unknown): CatalogHomeStrip | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  const displayOrder = readNumber(value.displayOrder);
  const rowCount = normalizeCatalogHomeStripRowCount(value.rowCount);
  const sortCategory = readString(value.sortCategory);
  const sortDirection = readString(value.sortDirection);
  const search = value.search === null ? null : readString(value.search);
  const tagIdsValue = Array.isArray(value.tagIds) ? value.tagIds : null;
  const excludedTagIdsValue =
    value.excludedTagIds === undefined || value.excludedTagIds === null
      ? []
      : Array.isArray(value.excludedTagIds)
        ? value.excludedTagIds
        : null;
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);

  if (
    !id ||
    !name ||
    displayOrder === null ||
    !sortCategory ||
    !isCatalogSortCategory(sortCategory) ||
    !isCatalogSortDirection(sortDirection) ||
    (value.search !== null && search === null) ||
    !tagIdsValue ||
    excludedTagIdsValue === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const tagIds = normalizeStoredStringArray(tagIdsValue);
  const excludedTagIds = normalizeStoredStringArray(excludedTagIdsValue);
  if (
    tagIds.length !==
      tagIdsValue.filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '').length ||
    excludedTagIds.length !==
      excludedTagIdsValue.filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '').length
  ) {
    return null;
  }

  return {
    id,
    name,
    displayOrder: Math.max(0, Math.floor(displayOrder)),
    rowCount,
    sortCategory,
    sortDirection,
    search,
    tagIds,
    excludedTagIds,
    createdAt,
    updatedAt
  };
}

function parseCatalogHomeStripsPayload(value: unknown): CatalogHomeStrip[] | null {
  if (!isRecord(value) || !Array.isArray(value.strips)) {
    return null;
  }

  const strips = value.strips
    .map((candidate) => hydrateCatalogHomeStrip(candidate))
    .filter((candidate): candidate is CatalogHomeStrip => candidate !== null);

  return strips.length === value.strips.length ? strips : null;
}

function hydrateCatalogItem(value: unknown): CatalogItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const originalName = readString(value.originalName);
  const originalIngestName = readString(value.originalIngestName);
  const visibleName = readString(value.visibleName);
  const normalizedVisibleName = readString(value.normalizedVisibleName);
  const storedName = readString(value.storedName);
  const sizeBytes = readNumber(value.sizeBytes);
  const uploadedAt = readString(value.uploadedAt);
  const status = readString(value.status);
  const relativePath = readString(value.relativePath);
  const sourceType = readString(value.sourceType);
  const tagsValue = value.tags === undefined || value.tags === null ? [] : value.tags;

  if (
    !id ||
    !originalName ||
    !originalIngestName ||
    !visibleName ||
    !normalizedVisibleName ||
    !storedName ||
    sizeBytes === null ||
    !uploadedAt ||
    !status ||
    !relativePath ||
    !sourceType ||
    !isCatalogItemStatus(status) ||
    !isCatalogItemSourceType(sourceType) ||
    !Array.isArray(tagsValue)
  ) {
    return null;
  }

  const tags = tagsValue
    .map((candidate) => hydrateCatalogTag(candidate))
    .filter((candidate): candidate is CatalogTag => candidate !== null);

  if (tags.length !== tagsValue.length) {
    return null;
  }

  return {
    id,
    originalName,
    originalIngestName,
    visibleName,
    normalizedVisibleName,
    storedName,
    sizeBytes,
    uploadedAt,
    status,
    relativePath,
    incomingChecksumSha256: readString(value.incomingChecksumSha256),
    retainedChecksumSha256: readString(value.retainedChecksumSha256),
    sourceType,
    sourceUrl: readString(value.sourceUrl),
    sourceSite: readString(value.sourceSite),
    sourceRemoteId: readString(value.sourceRemoteId),
    thumbnailRelativePath: readString(value.thumbnailRelativePath),
    hoverPreviewSprite:
      value.hoverPreviewSprite === null
        ? null
        : hydrateHoverPreviewSprite(value.hoverPreviewSprite),
    probe: value.probe === null ? null : hydrateMediaProbeInfo(value.probe),
    viewerVisualAdjustments: hydrateViewerVisualAdjustments(value.viewerVisualAdjustments),
    viewCount: normalizeViewCount(value.viewCount),
    usedCount: normalizeCatalogItemCount(value.usedCount),
    downloadCount: normalizeCatalogItemCount(value.downloadCount),
    lastViewedAt: readString(value.lastViewedAt),
    lastDownloadedAt: readString(value.lastDownloadedAt),
    tags,
    processing: value.processing === null ? null : hydrateProcessingSnapshot(value.processing)
  };
}

function hydrateCatalogBookmark(value: unknown): CatalogBookmark | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const catalogItemId = readString(value.catalogItemId);
  const name = normalizeBookmarkName(readString(value.name));
  const timeSeconds = readNumber(value.timeSeconds);
  const thumbnailRelativePath = readString(value.thumbnailRelativePath);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);

  if (
    !id ||
    !catalogItemId ||
    timeSeconds === null ||
    timeSeconds < 0 ||
    !thumbnailRelativePath ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    catalogItemId,
    name,
    timeSeconds,
    thumbnailRelativePath,
    useCount: normalizeCatalogItemCount(value.useCount),
    createdAt,
    updatedAt
  };
}

function hydrateDuplicateReason(value: unknown): DuplicateReason | null {
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

function hydrateDuplicateCheck(value: unknown): DuplicateCheck | null {
  if (!isRecord(value)) {
    return null;
  }

  const hasConflicts = readBoolean(value.hasConflicts);
  const reasonsValue = Array.isArray(value.reasons) ? value.reasons : null;
  const existingItemsValue = Array.isArray(value.existingItems) ? value.existingItems : null;

  if (hasConflicts === null || reasonsValue === null || existingItemsValue === null) {
    return null;
  }

  const reasons = reasonsValue
    .map((candidate) => hydrateDuplicateReason(candidate))
    .filter((candidate): candidate is DuplicateReason => candidate !== null);
  const existingItems = existingItemsValue
    .map((candidate) => hydrateCatalogItem(candidate))
    .filter((candidate): candidate is CatalogItem => candidate !== null);

  return {
    hasConflicts,
    reasons,
    existingItems
  };
}

function hydratePendingIngest(value: unknown): PendingIngest | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const sourceType = readString(value.sourceType);
  const originalIngestName = readString(value.originalIngestName);
  const visibleName = readString(value.visibleName);
  const normalizedVisibleName = readString(value.normalizedVisibleName);
  const downloadState = readString(value.downloadState);
  const duplicateCheck = hydrateDuplicateCheck(value.duplicateCheck);
  const acknowledgedReasonsValue = Array.isArray(value.acknowledgedReasons)
    ? value.acknowledgedReasons
    : null;

  if (
    !id ||
    !createdAt ||
    !updatedAt ||
    !sourceType ||
    !originalIngestName ||
    !visibleName ||
    !normalizedVisibleName ||
    !downloadState ||
    !duplicateCheck ||
    acknowledgedReasonsValue === null ||
    !isCatalogItemSourceType(sourceType) ||
    !isPendingIngestDownloadState(downloadState)
  ) {
    return null;
  }

  const acknowledgedReasons = acknowledgedReasonsValue
    .map((candidate) => hydrateDuplicateReason(candidate))
    .filter((candidate): candidate is DuplicateReason => candidate !== null);

  return {
    id,
    createdAt,
    updatedAt,
    sourceType,
    originalIngestName,
    visibleName,
    normalizedVisibleName,
    sourceUrl: readString(value.sourceUrl),
    sourceSite: readString(value.sourceSite),
    sourceRemoteId: readString(value.sourceRemoteId),
    tempRelativePath: readString(value.tempRelativePath),
    sizeBytes: readNumber(value.sizeBytes),
    incomingChecksumSha256: readString(value.incomingChecksumSha256),
    duplicateCheck,
    acknowledgedReasons,
    downloadState,
    processing: value.processing === null ? null : hydrateProcessingSnapshot(value.processing)
  };
}

function hydrateStorageUsageInfo(value: unknown): StorageUsageInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  const storagePath = readString(value.storagePath);
  const filesystemPath = readString(value.filesystemPath);
  const usedBytes = readNumber(value.usedBytes);
  const totalBytes = readNumber(value.totalBytes);
  const percentUsed = readNumber(value.percentUsed);

  if (
    !storagePath ||
    !filesystemPath ||
    usedBytes === null ||
    totalBytes === null ||
    percentUsed === null ||
    usedBytes < 0 ||
    totalBytes <= 0
  ) {
    return null;
  }

  return {
    storagePath,
    filesystemPath,
    usedBytes,
    totalBytes,
    percentUsed: Math.max(0, Math.min(100, percentUsed))
  };
}

function hydrateRuntimeInfo(value: unknown): RuntimeInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  const toolAvailability = hydrateToolAvailability(value.toolAvailability);
  const configValue = value.config;

  if (!toolAvailability || !isRecord(configValue)) {
    return null;
  }

  const idleLockMinutes = readNumber(configValue.idleLockMinutes);
  const wsHeartbeatMs = readNumber(configValue.wsHeartbeatMs);
  const port =
    configValue.port === undefined || configValue.port === null ? null : readNumber(configValue.port);
  const storageUsage =
    value.storageUsage === undefined || value.storageUsage === null
      ? null
      : hydrateStorageUsageInfo(value.storageUsage);

  if (
    idleLockMinutes === null ||
    wsHeartbeatMs === null ||
    (value.storageUsage !== undefined && value.storageUsage !== null && storageUsage === null)
  ) {
    return null;
  }

  return {
    toolAvailability,
    config: {
      idleLockMinutes,
      wsHeartbeatMs,
      port
    },
    storageUsage
  };
}

function isServerToolName(value: string): value is ServerToolName {
  return value === 'ffmpeg' || value === 'yt-dlp';
}

function isServerToolUpdateToolStatus(value: string): value is ServerToolUpdateToolStatus {
  return value === 'success' || value === 'failed' || value === 'unsupported';
}

function isServerToolUpdateStatus(value: string): value is ServerToolUpdateStatus {
  return value === 'success' || value === 'partial' || value === 'failed' || value === 'unsupported';
}

function hydrateServerToolUpdateAttempt(value: unknown): ServerToolUpdateAttempt | null {
  if (!isRecord(value)) {
    return null;
  }

  const tool = readString(value.tool);
  const attempted = readBoolean(value.attempted);
  const status = readString(value.status);
  const strategy = readString(value.strategy);
  const command = value.command === null ? null : readString(value.command);
  const exitCode = value.exitCode === null ? null : readNumber(value.exitCode);
  const stdout = readString(value.stdout);
  const stderr = readString(value.stderr);
  const message = readString(value.message);

  if (
    !tool ||
    !isServerToolName(tool) ||
    attempted === null ||
    !status ||
    !isServerToolUpdateToolStatus(status) ||
    !strategy ||
    (value.command !== null && command === null) ||
    (value.exitCode !== null && exitCode === null) ||
    stdout === null ||
    stderr === null ||
    !message
  ) {
    return null;
  }

  return {
    tool,
    attempted,
    status,
    strategy,
    command,
    exitCode,
    stdout,
    stderr,
    message
  };
}

function hydrateServerToolUpdateResult(value: unknown): ServerToolUpdateResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const ok = readBoolean(value.ok);
  const status = readString(value.status);
  const platform = readString(value.platform);
  const startedAt = readString(value.startedAt);
  const finishedAt = readString(value.finishedAt);
  const summary = readString(value.summary);
  const toolsValue = Array.isArray(value.tools) ? value.tools : null;

  if (
    ok === null ||
    !status ||
    !isServerToolUpdateStatus(status) ||
    !platform ||
    !startedAt ||
    !finishedAt ||
    !summary ||
    !toolsValue
  ) {
    return null;
  }

  const tools = toolsValue
    .map((candidate) => hydrateServerToolUpdateAttempt(candidate))
    .filter((candidate): candidate is ServerToolUpdateAttempt => candidate !== null);

  if (tools.length !== toolsValue.length) {
    return null;
  }

  return {
    ok,
    status,
    platform,
    startedAt,
    finishedAt,
    tools,
    summary
  };
}

function hydrateServerToolUpdateResponse(value: unknown): ServerToolUpdateResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const ok = readBoolean(value.ok);
  const message = readString(value.message);
  const result = hydrateServerToolUpdateResult(value.result);
  const runtime = hydrateRuntimeInfo(value.runtime);

  if (ok === null || !message || !result || !runtime) {
    return null;
  }

  return {
    ok,
    message,
    result,
    runtime
  };
}

function hydrateSocketStateSnapshot(value: unknown): SocketStateSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const catalogValue = isRecord(value.catalog) ? value.catalog : null;
  const pendingIngestsValue = isRecord(value.pendingIngests) ? value.pendingIngests : null;
  const homeStripsValue = isRecord(value.homeStrips) ? value.homeStrips : null;
  const runtime = hydrateRuntimeInfo(value.runtime);

  if (!catalogValue || !pendingIngestsValue || !runtime) {
    return null;
  }

  const catalogItemsValue = Array.isArray(catalogValue.items) ? catalogValue.items : null;
  const pendingItemsValue = Array.isArray(pendingIngestsValue.pendingIngests)
    ? pendingIngestsValue.pendingIngests
    : null;
  const homeStripItemsValue =
    homeStripsValue && Array.isArray(homeStripsValue.strips) ? homeStripsValue.strips : [];

  if (!catalogItemsValue || !pendingItemsValue) {
    return null;
  }

  const catalogItems = catalogItemsValue
    .map((candidate) => hydrateCatalogItem(candidate))
    .filter((candidate): candidate is CatalogItem => candidate !== null);
  const pendingIngests = pendingItemsValue
    .map((candidate) => hydratePendingIngest(candidate))
    .filter((candidate): candidate is PendingIngest => candidate !== null);
  const homeStrips = homeStripItemsValue
    .map((candidate) => hydrateCatalogHomeStrip(candidate))
    .filter((candidate): candidate is CatalogHomeStrip => candidate !== null);

  if (
    catalogItems.length !== catalogItemsValue.length ||
    pendingIngests.length !== pendingItemsValue.length ||
    homeStrips.length !== homeStripItemsValue.length
  ) {
    return null;
  }

  return {
    catalogItems,
    pendingIngests,
    homeStrips,
    runtime
  };
}

function hydrateJobEvent(value: unknown): JobEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const targetKind = readString(value.targetKind);
  const itemIdValue = value.itemId;
  const pendingIngestIdValue = value.pendingIngestId;
  const sourceType = readString(value.sourceType);
  const visibleName = readString(value.visibleName);
  const status = readString(value.status);
  const processing = hydrateProcessingSnapshot(value.processing);

  if (
    (targetKind !== 'catalog_item' && targetKind !== 'pending_ingest') ||
    !sourceType ||
    !visibleName ||
    !status ||
    !processing ||
    !isCatalogItemSourceType(sourceType) ||
    (status !== 'pending' && !isCatalogItemStatus(status))
  ) {
    return null;
  }

  return {
    targetKind,
    itemId: itemIdValue === null ? null : readString(itemIdValue),
    pendingIngestId: pendingIngestIdValue === null ? null : readString(pendingIngestIdValue),
    sourceType,
    visibleName,
    status,
    processing
  };
}

function parseSocketEnvelope(eventData: unknown): Record<string, unknown> | null {
  if (typeof eventData !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(eventData) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isApplicationSocketEnvelope(envelope: Record<string, unknown>): boolean {
  const type = readString(envelope.type);
  if (!type) {
    return false;
  }

  return [
    'ack',
    'catalog:item-updated',
    'catalog:list',
    'error',
    'evt',
    'panic',
    'pending-ingest-deleted',
    'pending-ingest-updated',
    'pending-ingests:list',
    'pong',
    'runtime',
    'welcome'
  ].includes(type);
}

function getViteClientEnv(): ViteClientEnv {
  const viteMeta = import.meta as ImportMeta & { env?: ViteClientEnv };
  return viteMeta.env ?? {};
}

function readPositiveIntegerSetting(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getConfiguredDevBackendPort(): number {
  if (
    typeof __VIDEO_CATALOG_DEV_BACKEND_PORT__ === 'number' &&
    Number.isInteger(__VIDEO_CATALOG_DEV_BACKEND_PORT__) &&
    __VIDEO_CATALOG_DEV_BACKEND_PORT__ > 0
  ) {
    return __VIDEO_CATALOG_DEV_BACKEND_PORT__;
  }

  return DEFAULT_DEV_BACKEND_PORT;
}

function applyWebSocketProtocol(url: URL): void {
  if (url.protocol === 'https:' || url.protocol === 'wss:') {
    url.protocol = 'wss:';
    return;
  }

  url.protocol = 'ws:';
}

function isUrlWithProtocol(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value);
}

function isLoopbackHostname(value: string): boolean {
  const hostname = value.trim().toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('127.')
  );
}

function alignLoopbackSocketHostWithBrowserHost(url: URL): void {
  let browserUrl: URL;
  try {
    browserUrl = new URL(window.location.origin);
  } catch {
    return;
  }

  if (!isLoopbackHostname(url.hostname) || !isLoopbackHostname(browserUrl.hostname)) {
    return;
  }

  url.hostname = browserUrl.hostname;
}

function getDefinedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function getDefinedDevBackendHttpOrigin(): string | null {
  return getDefinedString(
    typeof __VIDEO_CATALOG_DEV_BACKEND_HTTP_ORIGIN__ === 'string'
      ? __VIDEO_CATALOG_DEV_BACKEND_HTTP_ORIGIN__
      : null
  );
}

function getDefinedDevBackendWsOrigin(): string | null {
  return getDefinedString(
    typeof __VIDEO_CATALOG_DEV_BACKEND_WS_ORIGIN__ === 'string'
      ? __VIDEO_CATALOG_DEV_BACKEND_WS_ORIGIN__
      : null
  );
}

function createDevBackendOriginUrl(): URL {
  const env = getViteClientEnv();
  const configuredOrigin =
    getDefinedString(env.VITE_BACKEND_WS_ORIGIN) ??
    getDefinedDevBackendWsOrigin() ??
    getDefinedString(env.VITE_BACKEND_ORIGIN) ??
    getDefinedDevBackendHttpOrigin();

  if (configuredOrigin) {
    try {
      const originUrl = new URL(configuredOrigin);
      applyWebSocketProtocol(originUrl);
      originUrl.pathname = '/';
      originUrl.search = '';
      originUrl.hash = '';
      alignLoopbackSocketHostWithBrowserHost(originUrl);
      return originUrl;
    } catch {
      // Fall through to deriving the backend origin from the current browser host.
    }
  }

  const backendPort = readPositiveIntegerSetting(env.VITE_BACKEND_PORT) ?? getConfiguredDevBackendPort();
  const originUrl = new URL(window.location.origin);
  originUrl.port = String(backendPort);
  originUrl.pathname = '/';
  originUrl.search = '';
  originUrl.hash = '';
  applyWebSocketProtocol(originUrl);
  return originUrl;
}

function createSocketUrlFromBase(
  pathOrUrl: string,
  baseOrigin: URL,
  alignRelativeLoopbackHost: boolean,
  defaultPath = APPLICATION_WEBSOCKET_PATH
): string | null {
  const trimmedValue = pathOrUrl.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const baseUrl = new URL(baseOrigin.toString());
    if (!isUrlWithProtocol(trimmedValue) && alignRelativeLoopbackHost) {
      alignLoopbackSocketHostWithBrowserHost(baseUrl);
    }

    const socketUrl = new URL(trimmedValue, baseUrl);
    applyWebSocketProtocol(socketUrl);

    if (socketUrl.pathname === '' || socketUrl.pathname === '/') {
      socketUrl.pathname = defaultPath;
    }

    socketUrl.search = '';
    socketUrl.hash = '';
    return socketUrl.toString();
  } catch {
    return null;
  }
}

function normalizeExplicitWebSocketUrl(
  value: string | undefined,
  relativeBaseOrigin: URL = new URL(window.location.origin),
  alignRelativeLoopbackHost = false,
  defaultPath = APPLICATION_WEBSOCKET_PATH
): string | null {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  return createSocketUrlFromBase(trimmedValue, relativeBaseOrigin, alignRelativeLoopbackHost, defaultPath);
}

function createWebSocketUrlFromOrigin(
  value: string | undefined,
  alignLoopbackHost = false,
  path = APPLICATION_WEBSOCKET_PATH
): string | null {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  try {
    const socketUrl = new URL(trimmedValue);
    applyWebSocketProtocol(socketUrl);
    if (alignLoopbackHost) {
      alignLoopbackSocketHostWithBrowserHost(socketUrl);
    }
    socketUrl.pathname = path;
    socketUrl.search = '';
    socketUrl.hash = '';
    return socketUrl.toString();
  } catch {
    return null;
  }
}

function getSameOriginWebSocketUrl(path = APPLICATION_WEBSOCKET_PATH): string {
  const socketUrl = new URL(path, window.location.origin);
  applyWebSocketProtocol(socketUrl);
  socketUrl.search = '';
  socketUrl.hash = '';
  return socketUrl.toString();
}

function createDevBackendWebSocketUrlForPort(port: number, path = APPLICATION_WEBSOCKET_PATH): string | null {
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  const socketUrl = new URL(path, window.location.origin);
  socketUrl.port = String(port);
  applyWebSocketProtocol(socketUrl);
  socketUrl.search = '';
  socketUrl.hash = '';
  return socketUrl.toString();
}

function createDefaultDevBackendWebSocketUrl(path = APPLICATION_WEBSOCKET_PATH): string {
  const socketUrl = new URL(path, createDevBackendOriginUrl().toString());
  applyWebSocketProtocol(socketUrl);
  socketUrl.search = '';
  socketUrl.hash = '';
  return socketUrl.toString();
}

function pushUniqueWebSocketCandidate(candidates: string[], candidate: string | null): void {
  if (!candidate || candidates.includes(candidate)) {
    return;
  }

  candidates.push(candidate);
}

function addDevelopmentWebSocketCandidatesForPath(
  candidates: string[],
  devBackendOrigin: URL,
  path: string
): void {
  const env = getViteClientEnv();
  const configuredBackendPort = readPositiveIntegerSetting(env.VITE_BACKEND_PORT) ?? getConfiguredDevBackendPort();

  pushUniqueWebSocketCandidate(candidates, createDefaultDevBackendWebSocketUrl(path));
  pushUniqueWebSocketCandidate(candidates, createDevBackendWebSocketUrlForPort(configuredBackendPort, path));
  pushUniqueWebSocketCandidate(candidates, createDevBackendWebSocketUrlForPort(DEFAULT_DEV_BACKEND_PORT, path));
  pushUniqueWebSocketCandidate(
    candidates,
    normalizeExplicitWebSocketUrl(env.VITE_BACKEND_WS_URL, devBackendOrigin, true, path)
  );
  pushUniqueWebSocketCandidate(candidates, createWebSocketUrlFromOrigin(env.VITE_BACKEND_WS_ORIGIN, true, path));
}

function getDevelopmentWebSocketCandidateUrls(): string[] {
  const candidates: string[] = [];
  const devBackendOrigin = createDevBackendOriginUrl();

  // Prefer the same /api proxy prefix that already carries authenticated HTTP traffic in dev.
  // This avoids Vite HMR's WebSocket endpoint and keeps cookies/session behavior identical to /api calls.
  pushUniqueWebSocketCandidate(candidates, getSameOriginWebSocketUrl(APPLICATION_WEBSOCKET_PATH));
  addDevelopmentWebSocketCandidatesForPath(candidates, devBackendOrigin, APPLICATION_WEBSOCKET_PATH);

  // Keep the historical /ws endpoint as a fallback only. The server still exposes it as a compatibility alias.
  pushUniqueWebSocketCandidate(candidates, getSameOriginWebSocketUrl(LEGACY_WEBSOCKET_PATH));
  addDevelopmentWebSocketCandidatesForPath(candidates, devBackendOrigin, LEGACY_WEBSOCKET_PATH);

  return candidates;
}

function getWebSocketCandidateUrls(): string[] {
  const env = getViteClientEnv();

  if (env.DEV === true) {
    return getDevelopmentWebSocketCandidateUrls();
  }

  return [getSameOriginWebSocketUrl(APPLICATION_WEBSOCKET_PATH), getSameOriginWebSocketUrl(LEGACY_WEBSOCKET_PATH)];
}

function parseCatalogItemsPayload(payload: unknown): CatalogItem[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const items = payload
    .map((candidate) => hydrateCatalogItem(candidate))
    .filter((candidate): candidate is CatalogItem => candidate !== null);

  return items.length === payload.length ? items : null;
}

function parseCatalogTagsPayload(payload: unknown): CatalogTag[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const tags = payload
    .map((candidate) => hydrateCatalogTag(candidate))
    .filter((candidate): candidate is CatalogTag => candidate !== null);

  return tags.length === payload.length ? tags : null;
}

function parsePendingIngestsPayload(payload: unknown): PendingIngest[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const pendingIngests = payload
    .map((candidate) => hydratePendingIngest(candidate))
    .filter((candidate): candidate is PendingIngest => candidate !== null);

  return pendingIngests.length === payload.length ? pendingIngests : null;
}

async function readJsonPayload(response: Response): Promise<unknown | null> {
  const text = await response.text();
  if (text.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseIngestResponse(value: unknown): ParsedIngestResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const ok = readBoolean(value.ok);
  if (ok === false) {
    const message = readString(value.message);
    return {
      kind: 'error',
      message: message ?? 'Request failed.'
    };
  }

  const cancelled = readBoolean(value.cancelled);
  if (cancelled === true) {
    return {
      kind: 'cancelled'
    };
  }

  const requiresResolution = readBoolean(value.requiresResolution);
  if (requiresResolution === true) {
    const pendingIngest = hydratePendingIngest(value.pendingIngest);
    if (!pendingIngest) {
      return null;
    }

    return {
      kind: 'duplicate',
      pendingIngest
    };
  }

  if (requiresResolution === false) {
    const item = hydrateCatalogItem(value.item);
    if (!item) {
      return null;
    }

    return {
      kind: 'success',
      item
    };
  }

  return null;
}

function getDistinctDuplicateReasonCodes(duplicateCheck: DuplicateCheck): DuplicateReasonCode[] {
  const seen = new Set<DuplicateReasonCode>();
  const result: DuplicateReasonCode[] = [];

  for (const reason of duplicateCheck.reasons) {
    if (seen.has(reason.code)) {
      continue;
    }

    seen.add(reason.code);
    result.push(reason.code);
  }

  return result;
}

function getDuplicateReasonCodesForItem(
  duplicateCheck: DuplicateCheck,
  existingItemId: string
): DuplicateReasonCode[] {
  const seen = new Set<DuplicateReasonCode>();
  const result: DuplicateReasonCode[] = [];

  for (const reason of duplicateCheck.reasons) {
    if (reason.existingItemId !== existingItemId || seen.has(reason.code)) {
      continue;
    }

    seen.add(reason.code);
    result.push(reason.code);
  }

  return result;
}

function upsertCatalogItem(items: CatalogItem[], item: CatalogItem): CatalogItem[] {
  const existingIndex = items.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex === -1) {
    return [item, ...items];
  }

  const nextItems = [...items];
  nextItems[existingIndex] = item;
  return nextItems;
}

function sortCatalogBookmarks(bookmarks: CatalogBookmark[]): CatalogBookmark[] {
  const nextBookmarks = [...bookmarks];
  nextBookmarks.sort((left, right) => {
    if (left.timeSeconds !== right.timeSeconds) {
      return left.timeSeconds - right.timeSeconds;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
  return nextBookmarks;
}

function upsertCatalogBookmark(
  bookmarks: CatalogBookmark[],
  bookmark: CatalogBookmark
): CatalogBookmark[] {
  const existingIndex = bookmarks.findIndex((candidate) => candidate.id === bookmark.id);
  if (existingIndex === -1) {
    return sortCatalogBookmarks([...bookmarks, bookmark]);
  }

  const nextBookmarks = [...bookmarks];
  nextBookmarks[existingIndex] = bookmark;
  return sortCatalogBookmarks(nextBookmarks);
}

function upsertPendingIngest(items: PendingIngest[], pendingIngest: PendingIngest): PendingIngest[] {
  const existingIndex = items.findIndex((candidate) => candidate.id === pendingIngest.id);
  if (existingIndex === -1) {
    return [pendingIngest, ...items];
  }

  const nextItems = [...items];
  nextItems[existingIndex] = pendingIngest;
  return nextItems;
}

function getComparableTimestamp(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getComparableResolutionPixels(item: CatalogItem): number | null {
  const width = item.probe?.width;
  const height = item.probe?.height;

  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return width * height;
}

function compareOptionalNumbers(
  leftValue: number | null,
  rightValue: number | null,
  direction: CatalogSortDirection,
  missingPlacement: 'first' | 'last' = 'last'
): number {
  const leftMissing = leftValue === null || !Number.isFinite(leftValue);
  const rightMissing = rightValue === null || !Number.isFinite(rightValue);

  if (leftMissing && rightMissing) {
    return 0;
  }

  if (leftMissing) {
    return missingPlacement === 'first' ? -1 : 1;
  }

  if (rightMissing) {
    return missingPlacement === 'first' ? 1 : -1;
  }

  return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
}

function compareCatalogItemsByName(
  left: CatalogItem,
  right: CatalogItem,
  direction: CatalogSortDirection
): number {
  const comparison = getCatalogItemDisplayName(left).localeCompare(getCatalogItemDisplayName(right));
  return direction === 'asc' ? comparison : -comparison;
}

function getSeededCatalogRandomSortValue(item: CatalogItem, seed: number): number {
  const key = `${item.id}:${item.uploadedAt}`;
  let hash = (seed ^ 0x811c9dc5) >>> 0;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function compareCatalogSortValues(
  left: CatalogItem,
  right: CatalogItem,
  category: CatalogSortCategory,
  direction: CatalogSortDirection
): number {
  switch (category) {
    case 'name':
      return compareCatalogItemsByName(left, right, direction);
    case 'duration':
      return compareOptionalNumbers(
        left.probe?.durationSeconds ?? null,
        right.probe?.durationSeconds ?? null,
        direction
      );
    case 'viewCount':
      return compareOptionalNumbers(left.viewCount, right.viewCount, direction);
    case 'usedCount':
      return compareOptionalNumbers(left.usedCount, right.usedCount, direction);
    case 'downloadCount':
      return compareOptionalNumbers(left.downloadCount, right.downloadCount, direction);
    case 'lastViewedAt':
      return compareOptionalNumbers(
        getComparableTimestamp(left.lastViewedAt),
        getComparableTimestamp(right.lastViewedAt),
        direction,
        direction === 'asc' ? 'first' : 'last'
      );
    case 'resolution':
      return compareOptionalNumbers(
        getComparableResolutionPixels(left),
        getComparableResolutionPixels(right),
        direction
      );
    case 'random':
      return 0;
    case 'uploadedAt':
    default:
      return compareOptionalNumbers(
        getComparableTimestamp(left.uploadedAt),
        getComparableTimestamp(right.uploadedAt),
        direction
      );
  }
}

function compareCatalogItemsWithTieBreakers(left: CatalogItem, right: CatalogItem): number {
  const nameComparison = compareCatalogItemsByName(left, right, 'asc');

  if (nameComparison !== 0) {
    return nameComparison;
  }

  return compareOptionalNumbers(
    getComparableTimestamp(left.uploadedAt),
    getComparableTimestamp(right.uploadedAt),
    'desc'
  );
}

function filterCatalogItemsByCriteria(
  items: CatalogItem[],
  search: string,
  selectedTagIds: string[],
  excludedTagIds: string[] = []
): CatalogItem[] {
  const normalizedSearch = search.trim().toLowerCase();

  return items.filter((item) => {
    if (selectedTagIds.length > 0 || excludedTagIds.length > 0) {
      const itemTagIds = new Set(item.tags.map((tag) => tag.id));
      if (!selectedTagIds.every((tagId) => itemTagIds.has(tagId))) {
        return false;
      }

      if (excludedTagIds.some((tagId) => itemTagIds.has(tagId))) {
        return false;
      }
    }

    if (normalizedSearch !== '') {
      const searchableText = [
        getCatalogItemDisplayName(item),
        item.originalIngestName,
        item.sourceSite ?? '',
        item.sourceRemoteId ?? '',
        item.sourceUrl ?? '',
        ...item.tags.map((tag) => tag.label)
      ]
        .join(' ')
        .toLowerCase();

      if (!searchableText.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });
}

function getCatalogHomeStripRandomSeed(strip: CatalogHomeStrip, randomSeed: number): number {
  let hash = (randomSeed ^ 0x811c9dc5) >>> 0;

  for (let index = 0; index < strip.id.length; index += 1) {
    hash ^= strip.id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash >>> 0;
}

function getCatalogHomeStripItems(
  strip: CatalogHomeStrip,
  items: CatalogItem[],
  randomSeed: number
): CatalogItem[] {
  const filteredItems = filterCatalogItemsByCriteria(
    items,
    strip.search ?? '',
    strip.tagIds,
    strip.excludedTagIds
  );
  return sortCatalogItems(
    filteredItems,
    strip.sortCategory,
    strip.sortDirection,
    getCatalogHomeStripRandomSeed(strip, randomSeed)
  );
}

const HOME_STRIP_MIN_ITEMS_PER_ROW = 1;
const HOME_STRIP_CARD_MIN_WIDTH_FALLBACK_PX = 260;
const HOME_STRIP_COLUMN_GAP_FALLBACK_PX = 16;

function readCssPixelValue(value: string, fallbackValue: number): number {
  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

function getHomeStripItemsPerRow(gridElement: HTMLElement): number {
  const computedStyle = window.getComputedStyle(gridElement);
  const horizontalPadding =
    readCssPixelValue(computedStyle.paddingLeft, 0) + readCssPixelValue(computedStyle.paddingRight, 0);
  const availableWidth = Math.max(0, gridElement.getBoundingClientRect().width - horizontalPadding);

  if (availableWidth <= 0) {
    return HOME_STRIP_MIN_ITEMS_PER_ROW;
  }

  const cardMinWidth = Math.max(
    1,
    readCssPixelValue(
      computedStyle.getPropertyValue('--home-strip-card-min-width'),
      HOME_STRIP_CARD_MIN_WIDTH_FALLBACK_PX
    )
  );
  const columnGap = Math.max(
    0,
    readCssPixelValue(computedStyle.columnGap, HOME_STRIP_COLUMN_GAP_FALLBACK_PX)
  );

  return Math.max(
    HOME_STRIP_MIN_ITEMS_PER_ROW,
    Math.floor((availableWidth + columnGap) / (cardMinWidth + columnGap))
  );
}

function sortCatalogItems(
  items: CatalogItem[],
  category: CatalogSortCategory,
  direction: CatalogSortDirection,
  randomSeed: number
): CatalogItem[] {
  const nextItems = [...items];

  if (category === 'random') {
    return nextItems
      .map((item) => ({
        item,
        sortValue: getSeededCatalogRandomSortValue(item, randomSeed)
      }))
      .sort((left, right) => {
        if (left.sortValue !== right.sortValue) {
          return left.sortValue < right.sortValue ? -1 : 1;
        }

        return compareCatalogItemsWithTieBreakers(left.item, right.item);
      })
      .map(({ item }) => item);
  }

  nextItems.sort((left, right) => {
    const primaryComparison = compareCatalogSortValues(left, right, category, direction);
    return primaryComparison !== 0
      ? primaryComparison
      : compareCatalogItemsWithTieBreakers(left, right);
  });

  return nextItems;
}

function appendActivityFeed(
  currentEntries: ActivityFeedEntry[],
  nextEntry: ActivityFeedEntry
): ActivityFeedEntry[] {
  const nextEntries = [nextEntry, ...currentEntries.filter((entry) => entry.id !== nextEntry.id)];
  return nextEntries.slice(0, RECENT_ACTIVITY_LIMIT);
}

function useResolvedSpriteUrl(candidates: string[], enabled: boolean): string | null {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!enabled || candidates.length === 0) {
      setResolvedUrl(null);
      return;
    }

    setResolvedUrl(null);
    let currentIndex = 0;

    const attemptCandidate = (): void => {
      if (cancelled || currentIndex >= candidates.length) {
        if (!cancelled) {
          setResolvedUrl(null);
        }
        return;
      }

      const image = new Image();
      const candidate = candidates[currentIndex];
      image.onload = () => {
        if (!cancelled) {
          setResolvedUrl(candidate);
        }
      };
      image.onerror = () => {
        currentIndex += 1;
        attemptCandidate();
      };
      image.src = candidate;
    };

    attemptCandidate();

    return () => {
      cancelled = true;
    };
  }, [enabled, candidates.join('|')]);

  return resolvedUrl;
}

function ProgressMeter({ percent, label }: { percent: number | null; label: string }): JSX.Element {
  const clampedPercent = percent === null ? null : Math.max(0, Math.min(100, percent));

  return (
    <div className="progress-meter" aria-label={label}>
      <div className="progress-meter-track" aria-hidden="true">
        <div
          className={`progress-meter-fill${clampedPercent === null ? ' is-indeterminate' : ''}`}
          style={clampedPercent === null ? undefined : { width: `${clampedPercent}%` }}
        />
      </div>
      <span className="progress-meter-label">{formatPercent(clampedPercent)}</span>
    </div>
  );
}

function Modal({
  title,
  titleId,
  onClose,
  children,
  disableClose = false,
  size = 'default'
}: ModalProps): JSX.Element {
  const handleBackdropClick = (): void => {
    if (!disableClose) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        className={`modal${size === 'wide' ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event: { stopPropagation(): void }) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="modal-close-button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            disabled={disableClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, children }: IconButtonProps): JSX.Element {
  return (
    <button type="button" className="icon-button" onClick={onClick} aria-label={label} title={label}>
      {children}
    </button>
  );
}

function RefreshIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4v4.67h4.67" />
      <path d="M21 20v-4.67h-4.67" />
      <path d="M20 11a8 8 0 0 0-13.66-5.66L3 8.67" />
      <path d="M4 13a8 8 0 0 0 13.66 5.66L21 15.33" />
    </svg>
  );
}

function UploadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function FilterIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.75" />
      <path d="m15 15 4.75 4.75" />
      <path d="M18.5 4.5v3" />
      <path d="M17 6h3" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="11" cy="18" r="2" />
    </svg>
  );
}

function AdjustmentsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="8" cy="6" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="16" cy="12" r="2" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="11" cy="18" r="2" />
    </svg>
  );
}

function LogoutIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 16l5-4-5-4" />
      <path d="M20 12H9" />
      <path d="M13 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h8" />
    </svg>
  );
}

function MinusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function MenuIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
    </svg>
  );
}

function GripIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="6.5" r="1" />
      <circle cx="15" cy="6.5" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="17.5" r="1" />
      <circle cx="15" cy="17.5" r="1" />
    </svg>
  );
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <path d="M8 6.5v11l8.5-5.5L8 6.5Z" />
    </svg>
  );
}

function PauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <rect x="6.5" y="5.5" width="4" height="13" rx="1" />
      <rect x="13.5" y="5.5" width="4" height="13" rx="1" />
    </svg>
  );
}

function VolumeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M17.5 7a7 7 0 0 1 0 10" />
    </svg>
  );
}

function VolumeMutedIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      <path d="m16 9 5 6" />
      <path d="m21 9-5 6" />
    </svg>
  );
}

function SeekBackwardIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <path d="M10.75 6.5v11L5 12l5.75-5.5Z" />
      <path d="M18.5 6.5v11L12.75 12l5.75-5.5Z" />
    </svg>
  );
}

function SeekForwardIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <path d="M13.25 6.5 19 12l-5.75 5.5v-11Z" />
      <path d="M5.5 6.5 11.25 12 5.5 17.5v-11Z" />
    </svg>
  );
}

function PencilIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 19 4.1-1.1 9.2-9.2a2.1 2.1 0 0 0-3-3l-9.2 9.2L5 19Z" />
      <path d="m13.8 6.2 4 4" />
    </svg>
  );
}

function InfoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v5.7" />
      <path d="M12 7.5h.01" />
    </svg>
  );
}

function TagIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.8 5.2h7.4l7 7a1.8 1.8 0 0 1 0 2.5l-4.5 4.5a1.8 1.8 0 0 1-2.5 0l-7-7V5.2Z" />
      <circle cx="8.3" cy="8.4" r="1.2" />
    </svg>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10" />
      <path d="m7.5 10 4.5 4.5L16.5 10" />
      <path d="M5 19h14" />
    </svg>
  );
}

function ExternalLinkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="m10 14 9-9" />
      <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

function TrashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="m10 11 .35 6" />
      <path d="m14 11-.35 6" />
      <path d="M6.5 7 7.4 20h9.2l.9-13" />
    </svg>
  );
}

function CatalogCardMedia(props: CardMediaProps): JSX.Element {
  if (!hasReadyCatalogAssets(props.item)) {
    return <CatalogProcessingCardMedia {...props} />;
  }

  return <CatalogReadyCardMedia {...props} />;
}

function CatalogReadyCardMedia({ item, compact = false, clickable = false }: CardMediaProps): JSX.Element {
  const [posterCandidateIndex, setPosterCandidateIndex] = useState(0);
  const [isPointerActive, setIsPointerActive] = useState(false);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const hoverTimerRef = useRef<number | null>(null);
  const frameTimerRef = useRef<number | null>(null);

  const posterCandidates = useMemo(() => buildPosterUrlCandidates(item), [
    item.id,
    item.thumbnailRelativePath,
    item.processing?.updatedAt,
    item.uploadedAt,
    item.status
  ]);
  const hoverPreviewCandidates = useMemo(() => buildHoverPreviewUrlCandidates(item), [
    item.id,
    item.hoverPreviewSprite?.relativePath,
    item.processing?.updatedAt,
    item.uploadedAt,
    item.status
  ]);
  const posterUrl = posterCandidates[posterCandidateIndex] ?? null;
  const resolutionBadge = getReadyResolutionBadgeInfo(item);
  const durationSeconds = item.probe?.durationSeconds ?? null;
  const canPreview = item.status === 'ready' && item.hoverPreviewSprite !== null;
  const resolvedSpriteUrl = useResolvedSpriteUrl(
    hoverPreviewCandidates,
    canPreview && isPointerActive && isPreviewVisible
  );
  const previewFrameStyle =
    resolvedSpriteUrl && item.hoverPreviewSprite
      ? createSpriteFrameStyle(item.hoverPreviewSprite, frameIndex, resolvedSpriteUrl)
      : null;

  useEffect(() => {
    setPosterCandidateIndex(0);
  }, [posterCandidates.join('|')]);

  useEffect(() => {
    setIsPointerActive(false);
    setIsPreviewVisible(false);
    setFrameIndex(0);
  }, [item.id, item.hoverPreviewSprite?.relativePath]);

  useEffect(() => {
    if (!canPreview || !isPointerActive || !isPreviewVisible || !item.hoverPreviewSprite) {
      if (frameTimerRef.current !== null) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
      setFrameIndex(0);
      return;
    }

    frameTimerRef.current = window.setInterval(() => {
      setFrameIndex((currentValue) => {
        const nextFrameCount = Math.max(1, item.hoverPreviewSprite?.frameCount ?? 1);
        return (currentValue + 1) % nextFrameCount;
      });
    }, HOVER_SPRITE_FRAME_INTERVAL_MS);

    return () => {
      if (frameTimerRef.current !== null) {
        window.clearInterval(frameTimerRef.current);
        frameTimerRef.current = null;
      }
    };
  }, [canPreview, isPointerActive, isPreviewVisible, item.hoverPreviewSprite]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
      if (frameTimerRef.current !== null) {
        window.clearInterval(frameTimerRef.current);
      }
    };
  }, []);

  const handlePointerEnter = (): void => {
    if (!canPreview) {
      return;
    }

    setIsPointerActive(true);
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setIsPreviewVisible(true);
    }, CARD_HOVER_PREVIEW_DELAY_MS);
  };

  const handlePointerLeave = (): void => {
    setIsPointerActive(false);
    setIsPreviewVisible(false);
    setFrameIndex(0);

    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  return (
    <div
      className={`media-frame${compact ? ' is-compact' : ''}${clickable ? ' is-clickable' : ''}`}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={handlePointerLeave}
      onFocus={handlePointerEnter}
      onBlur={handlePointerLeave}
    >
      {posterUrl ? (
        <img
          className="media-image"
          src={posterUrl}
          alt={getCatalogItemDisplayName(item)}
          loading={compact ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => {
            if (posterCandidates.length <= 1) {
              return;
            }

            setPosterCandidateIndex((currentValue) =>
              currentValue < posterCandidates.length - 1 ? currentValue + 1 : currentValue
            );
          }}
        />
      ) : (
        <div className="media-placeholder">{getMediaPlaceholderText(item)}</div>
      )}

      {!posterUrl && <div className="media-overlay-shadow" />}
      {previewFrameStyle && <div className="media-sprite-frame" style={previewFrameStyle} />}
      <div className="media-gradient" />

      {(resolutionBadge || durationSeconds !== null) && (
        <div className="media-badges">
          {resolutionBadge && (
            <span className={`resolution-pill ${resolutionBadge.className}`} title={resolutionBadge.title}>
              {resolutionBadge.label}
            </span>
          )}
          {durationSeconds !== null && (
            <span className="media-duration-pill">{formatDuration(durationSeconds)}</span>
          )}
        </div>
      )}
    </div>
  );
}

function CatalogProcessingCardMedia({ item, compact = false, clickable = false }: CardMediaProps): JSX.Element {
  const displayName = getCatalogItemDisplayName(item);
  const processing = item.processing;
  const stageLabel = processing ? PROCESSING_STAGE_LABELS[processing.stage] : STATUS_LABELS[item.status];
  const percent = getOverallProcessingPercent(item.sourceType, processing);
  const percentLabel = percent === null ? 'Live' : formatPercent(percent);
  const steps = getProcessingPipelineSteps(item.sourceType);
  const isFailed = item.status === 'failed' || processing?.stage === 'failed';
  const message =
    processing?.message ??
    (isFailed
      ? 'Processing failed before a detailed progress message was recorded.'
      : 'Accepted into the catalog; waiting for the next pipeline update.');

  return (
    <div
      className={`media-frame is-processing${compact ? ' is-compact' : ''}${clickable ? ' is-clickable' : ''}${isFailed ? ' is-failed' : ''}`}
      aria-label={`${displayName} is ${isFailed ? 'failed' : 'processing'}: ${stageLabel}`}
    >
      <div className="processing-media-shell">

        <div className="processing-focus-row">
          <div
            className="processing-orb"
            style={{ '--processing-progress': `${percent ?? 0}%` } as CSSProperties}
            aria-hidden="true"
          >
            <span>{percentLabel}</span>
          </div>
          <div className="processing-focus-copy">
            <strong>{stageLabel}</strong>
            <p>{message}</p>
          </div>
        </div>

        <ProgressMeter percent={percent} label={`${displayName} processing progress`} />

        <ol className="processing-step-list" aria-label="Processing pipeline">
          {steps.map((step, stepIndex) => {
            const stepState = getProcessingStepState(item.sourceType, processing, stepIndex);
            return (
              <li className={`processing-step is-${stepState}`} key={step.id}>
                <span className="processing-step-dot" aria-hidden="true" />
                <span>{step.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function getTagSuggestionOptionId(itemId: string, tagId: string): string {
  return `tag-suggestion-${itemId}-${tagId}`;
}

function CatalogTagPopover({
  item,
  popoverId,
  popoverRef,
  onAddTag,
  onRemoveTag,
  onSearchTags
}: CatalogTagPopoverProps): JSX.Element {
  const [tagInput, setTagInput] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogTag[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const inputId = `tag-input-${item.id}`;
  const suggestionListId = `tag-suggestions-${item.id}`;

  const normalizedExistingTags = useMemo(
    () => new Set(item.tags.map((tag) => tag.normalizedLabel)),
    [item.tags]
  );

  const visibleSuggestions = useMemo(() => {
    const selectedTagIds = new Set(item.tags.map((tag) => tag.id));
    return suggestions.filter(
      (tag) => !selectedTagIds.has(tag.id) && !normalizedExistingTags.has(tag.normalizedLabel)
    );
  }, [item.tags, normalizedExistingTags, suggestions]);

  const activeSuggestion =
    highlightedSuggestionIndex >= 0 ? visibleSuggestions[highlightedSuggestionIndex] ?? null : null;
  const activeSuggestionId = activeSuggestion ? getTagSuggestionOptionId(item.id, activeSuggestion.id) : undefined;

  function focusTagInputSoon(): void {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  useEffect(() => {
    setHighlightedSuggestionIndex((currentIndex) => {
      if (visibleSuggestions.length === 0) {
        return -1;
      }

      if (currentIndex >= visibleSuggestions.length) {
        return visibleSuggestions.length - 1;
      }

      return currentIndex;
    });
  }, [visibleSuggestions.length]);

  useEffect(() => {
    if (!activeSuggestionId) {
      return;
    }

    document.getElementById(activeSuggestionId)?.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestionId]);

  useEffect(() => {
    const query = tagInput.trim();
    if (query === '') {
      setSuggestions([]);
      setHighlightedSuggestionIndex(-1);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void onSearchTags(query).then((tags) => {
        if (!cancelled) {
          setSuggestions(tags);
        }
      });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onSearchTags, tagInput]);

  async function addTag(label: string): Promise<void> {
    const normalizedLabel = normalizeCatalogTagLabel(label);
    const normalizedKey = normalizeCatalogTagKey(normalizedLabel);

    if (normalizedLabel === '' || normalizedKey === '') {
      setError('Enter a tag name first.');
      focusTagInputSoon();
      return;
    }

    if (normalizedExistingTags.has(normalizedKey)) {
      setError('This item already has that tag.');
      focusTagInputSoon();
      return;
    }

    setIsBusy(true);
    setError('');
    const updatedItem = await onAddTag(item.id, normalizedLabel);
    setIsBusy(false);

    if (!updatedItem) {
      setError('Unable to add the tag.');
      focusTagInputSoon();
      return;
    }

    setTagInput('');
    setSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    focusTagInputSoon();
  }

  async function removeTag(tagId: string): Promise<void> {
    setIsBusy(true);
    setError('');
    const updatedItem = await onRemoveTag(item.id, tagId);
    setIsBusy(false);

    if (!updatedItem) {
      setError('Unable to remove the tag.');
    }
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      if (visibleSuggestions.length === 0) {
        return;
      }

      event.preventDefault();
      setHighlightedSuggestionIndex((currentIndex) =>
        currentIndex < 0 || currentIndex >= visibleSuggestions.length - 1 ? 0 : currentIndex + 1
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      if (visibleSuggestions.length === 0) {
        return;
      }

      event.preventDefault();
      setHighlightedSuggestionIndex((currentIndex) =>
        currentIndex <= 0 ? visibleSuggestions.length - 1 : currentIndex - 1
      );
      return;
    }

    if (event.key === 'Enter' && activeSuggestion && !isBusy) {
      event.preventDefault();
      void addTag(activeSuggestion.label);
    }
  }

  return (
    <div
      id={popoverId}
      className="tag-management-popover"
      ref={popoverRef}
      role="dialog"
      aria-label={`Manage tags for ${getCatalogItemDisplayName(item)}`}
    >
      <form
        className="tag-management-form"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (!isBusy) {
            void addTag(tagInput);
          }
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          Add tag
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={visibleSuggestions.length > 0}
          aria-controls={visibleSuggestions.length > 0 ? suggestionListId : undefined}
          aria-activedescendant={activeSuggestionId}
          value={tagInput}
          placeholder="Add tag…"
          autoComplete="off"
          disabled={isBusy}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setTagInput(event.target.value);
            setHighlightedSuggestionIndex(-1);
            setError('');
          }}
          onKeyDown={handleInputKeyDown}
        />
        <button type="submit" className="tag-management-add-button" disabled={isBusy || tagInput.trim() === ''}>
          Add
        </button>
      </form>

      {visibleSuggestions.length > 0 ? (
        <div id={suggestionListId} className="tag-management-suggestions" role="listbox" aria-label="Matching tags">
          {visibleSuggestions.map((tag, index) => {
            const isHighlighted = index === highlightedSuggestionIndex;

            return (
              <button
                type="button"
                id={getTagSuggestionOptionId(item.id, tag.id)}
                className={`tag-management-suggestion${isHighlighted ? ' is-highlighted' : ''}`}
                key={tag.id}
                role="option"
                aria-selected={isHighlighted}
                disabled={isBusy}
                onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                onMouseEnter={() => setHighlightedSuggestionIndex(index)}
                onClick={() => void addTag(tag.label)}
              >
                <span>{tag.label}</span>
                <span className="tag-usage-count">{tag.usageCount}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="tag-management-current-list" aria-label="Current tags">
        {item.tags.length > 0 ? (
          item.tags.map((tag) => (
            <span className="item-tag-chip" key={tag.id}>
              <span>{tag.label}</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void removeTag(tag.id)}
                aria-label={`Remove ${tag.label} tag`}
                title={`Remove ${tag.label}`}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="empty-inline-state">No tags yet.</span>
        )}
      </div>

      {error ? <p className="tag-management-error">{error}</p> : null}
    </div>
  );
}

function CatalogCard({
  item,
  contextKey,
  onOpenViewer,
  onOpenDetails,
  onAddTag,
  onRemoveTag,
  onSearchTags
}: CatalogCardProps): JSX.Element {
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false);
  const tagControlRef = useRef<HTMLDivElement | null>(null);
  const tagPopoverRef = useRef<HTMLDivElement | null>(null);
  const canOpenViewer = item.status === 'ready';
  const stageLabel = item.processing ? PROCESSING_STAGE_LABELS[item.processing.stage] : null;
  const cardSubtitle = canOpenViewer
    ? `${formatUsedCount(item.usedCount)} · ${formatViewCount(item.viewCount)}`
    : `${SOURCE_TYPE_LABELS[item.sourceType]} · ${stageLabel ?? STATUS_LABELS[item.status]}`;
  const tagPopoverId = `tag-management-popover-${contextKey ? `${contextKey}-` : ''}${item.id}`;

  useEffect(() => {
    if (!isTagPopoverOpen) {
      return undefined;
    }

    function handlePointerDown(event: Event): void {
      const target = event.target;
      if (
        target instanceof Node &&
        (tagControlRef.current?.contains(target) || tagPopoverRef.current?.contains(target))
      ) {
        return;
      }

      setIsTagPopoverOpen(false);
    }

    function handleKeyDown(event: Event): void {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        setIsTagPopoverOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTagPopoverOpen]);

  return (
    <article className={`card${canOpenViewer ? '' : ' is-processing'}${isTagPopoverOpen ? ' is-tag-popover-open' : ''}`} key={item.id}>
      <button
        type="button"
        className={`card-media-button${canOpenViewer ? ' is-openable' : ''}`}
        onClick={() => {
          if (canOpenViewer) {
            onOpenViewer(item);
          }
        }}
        disabled={!canOpenViewer}
        title={canOpenViewer ? `Open ${getCatalogItemDisplayName(item)}` : 'This item is still processing.'}
      >
        <CatalogCardMedia item={item} clickable={canOpenViewer} />
      </button>

      <div className="card-body">
        <div className="card-header-row">
          <div className="card-title-block">
            <h4 title={getCatalogItemDisplayName(item)}>{getCatalogItemDisplayName(item)}</h4>
            <p className="card-subtitle">{cardSubtitle}</p>
          </div>
          <div className="card-title-actions">
            <div className="tag-popover-anchor" ref={tagControlRef}>
              <button
                type="button"
                className={`card-icon-action${isTagPopoverOpen ? ' is-active' : ''}`}
                onClick={() => setIsTagPopoverOpen((currentValue) => !currentValue)}
                aria-label={`Manage tags for ${getCatalogItemDisplayName(item)}`}
                aria-expanded={isTagPopoverOpen}
                aria-haspopup="dialog"
                aria-controls={isTagPopoverOpen ? tagPopoverId : undefined}
                title="Manage tags"
              >
                <TagIcon />
              </button>
            </div>
            <button
              type="button"
              className="card-icon-action"
              onClick={() => onOpenDetails(item)}
              aria-label={`Show details for ${getCatalogItemDisplayName(item)}`}
              title="Details"
            >
              <InfoIcon />
            </button>
          </div>
        </div>

        {item.status === 'failed' && item.processing && (
          <p className="card-error-text">{item.processing.message}</p>
        )}
      </div>

      {isTagPopoverOpen ? (
        <CatalogTagPopover
          item={item}
          popoverId={tagPopoverId}
          popoverRef={tagPopoverRef}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
          onSearchTags={onSearchTags}
        />
      ) : null}
    </article>
  );
}

function HomeStripActionMenu({
  strip,
  index,
  totalCount,
  disabled = false,
  className = '',
  onMove,
  onEdit,
  onDelete
}: HomeStripActionMenuProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleDocumentMouseDown(event: globalThis.MouseEvent): void {
      const target = event.target;
      if (menuRef.current && target instanceof Node && !menuRef.current.contains(target)) {
        setIsOpen(false);
      }
    }

    function handleDocumentKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isOpen]);

  function runMenuAction(action: () => void): void {
    setIsOpen(false);
    action();
  }

  const menuClasses = ['home-strip-menu', className, isOpen ? 'is-open' : '', disabled ? 'is-disabled' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={menuClasses} ref={menuRef}>
      <button
        type="button"
        className="home-strip-menu-trigger"
        disabled={disabled}
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Open actions for ${strip.name}`}
        title="Actions"
      >
        <MenuIcon />
      </button>

      {isOpen ? (
        <div className="home-strip-menu-bubble" role="menu" aria-label={`Actions for ${strip.name}`}>
          <button
            type="button"
            className="home-strip-menu-item"
            role="menuitem"
            disabled={index === 0}
            onClick={() => runMenuAction(() => onMove(strip.id, 'up'))}
          >
            Move up
          </button>
          <button
            type="button"
            className="home-strip-menu-item"
            role="menuitem"
            disabled={index >= totalCount - 1}
            onClick={() => runMenuAction(() => onMove(strip.id, 'down'))}
          >
            Move down
          </button>
          <button
            type="button"
            className="home-strip-menu-item"
            role="menuitem"
            onClick={() => runMenuAction(() => onEdit(strip))}
          >
            Edit
          </button>
          <div className="home-strip-menu-divider" role="separator" />
          <button
            type="button"
            className="home-strip-menu-item danger"
            role="menuitem"
            onClick={() => runMenuAction(() => onDelete(strip))}
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CatalogHomeStripSection({
  view,
  index,
  totalCount,
  onMove,
  onEdit,
  onDelete,
  onOpenViewer,
  onOpenDetails,
  onAddTag,
  onRemoveTag,
  onSearchTags
}: CatalogHomeStripSectionProps): JSX.Element {
  const { strip, items } = view;
  const stripTitleId = `home-strip-title-${strip.id}`;
  const stripGridId = `home-strip-grid-${strip.id}`;
  const gridRef = useRef<HTMLDivElement>(null);
  const stripLayoutResetKey = [
    strip.id,
    strip.rowCount,
    strip.sortCategory,
    strip.sortDirection,
    strip.search ?? '',
    ...strip.tagIds,
    ...strip.excludedTagIds.map((tagId) => `exclude:${tagId}`)
  ].join('::');
  const [visibleRows, setVisibleRows] = useState<number>(strip.rowCount);
  const [itemsPerRow, setItemsPerRow] = useState<number>(HOME_STRIP_MIN_ITEMS_PER_ROW);

  useLayoutEffect(() => {
    setVisibleRows(strip.rowCount);
  }, [strip.rowCount, stripLayoutResetKey]);

  useLayoutEffect(() => {
    const gridElement = gridRef.current;

    if (!gridElement) {
      return;
    }

    const updateItemsPerRow = (): void => {
      const nextItemsPerRow = getHomeStripItemsPerRow(gridElement);
      setItemsPerRow((currentValue) =>
        currentValue === nextItemsPerRow ? currentValue : nextItemsPerRow
      );
    };

    updateItemsPerRow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateItemsPerRow);
      return () => {
        window.removeEventListener('resize', updateItemsPerRow);
      };
    }

    const resizeObserver = new ResizeObserver(updateItemsPerRow);
    resizeObserver.observe(gridElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [items.length]);

  const visibleItemCount = Math.min(items.length, visibleRows * itemsPerRow);
  const visibleItems = items.slice(0, visibleItemCount);
  const remainingItemCount = items.length - visibleItemCount;
  const hasMoreItems = remainingItemCount > 0;

  return (
    <section className="home-strip" aria-labelledby={stripTitleId}>
      <div className="home-strip-header">
        <div className="home-strip-heading">
          <h2 id={stripTitleId}>{strip.name}</h2>
        </div>
        <HomeStripActionMenu
          strip={strip}
          index={index}
          totalCount={totalCount}
          className="home-strip-header-menu"
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>

      {items.length > 0 ? (
        <>
          <div id={stripGridId} className="home-strip-grid" ref={gridRef}>
            {visibleItems.map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                contextKey={strip.id}
                onOpenViewer={onOpenViewer}
                onOpenDetails={onOpenDetails}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
                onSearchTags={onSearchTags}
              />
            ))}
          </div>

          {hasMoreItems ? (
            <div className="home-strip-footer">
              <span className="home-strip-visible-count">
                Showing {visibleItemCount} of {items.length}
              </span>
              <button
                type="button"
                className="app-button secondary home-strip-load-more-button"
                onClick={() => setVisibleRows((currentValue) => currentValue + 1)}
                aria-controls={stripGridId}
                aria-label={`Load another row for ${strip.name}`}
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty-state home-strip-empty">No items match this section yet.</div>
      )}
    </section>
  );
}

function CatalogItemDetailsModal({
  item,
  onClose,
  onRename,
  onDelete
}: CatalogItemDetailsModalProps): JSX.Element {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [editableVisibleName, setEditableVisibleName] = useState(item.visibleName);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSaveNotice, setNameSaveNotice] = useState<ModalNotice | null>(null);
  const displayName = getCatalogItemDisplayName(item);
  const resolutionBadge = getReadyResolutionBadgeInfo(item);
  const canDownloadRetainedVideo = item.status === 'ready';
  const deferredMetadataText = getDeferredMetadataText(item);
  const trimmedEditableVisibleName = editableVisibleName.trim();
  const canSaveVisibleName =
    trimmedEditableVisibleName !== '' && trimmedEditableVisibleName !== item.visibleName.trim();

  useEffect(() => {
    setIsConfirmingDelete(false);
    setIsDeleting(false);
    setDeleteError('');
    setEditableVisibleName(item.visibleName);
    setIsSavingName(false);
    setNameSaveNotice(null);
  }, [item.id]);

  useEffect(() => {
    if (!isSavingName) {
      setEditableVisibleName(item.visibleName);
    }
  }, [item.visibleName, isSavingName]);

  const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (trimmedEditableVisibleName === '') {
      setNameSaveNotice({
        tone: 'error',
        text: 'Enter a non-empty catalog title.'
      });
      return;
    }

    if (trimmedEditableVisibleName === item.visibleName.trim()) {
      setEditableVisibleName(item.visibleName);
      setNameSaveNotice({
        tone: 'info',
        text: 'The catalog title is already up to date.'
      });
      return;
    }

    setIsSavingName(true);
    setNameSaveNotice(null);

    const updatedItem = await onRename(item.id, trimmedEditableVisibleName);
    if (!updatedItem) {
      setNameSaveNotice({
        tone: 'error',
        text: 'Unable to save the catalog title. Please try again.'
      });
      setIsSavingName(false);
      return;
    }

    setEditableVisibleName(updatedItem.visibleName);
    setNameSaveNotice({
      tone: 'success',
      text: 'Catalog title updated.'
    });
    setIsSavingName(false);
  };

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    setDeleteError('');

    const deleted = await onDelete(item.id);
    if (!deleted) {
      setDeleteError('Unable to delete this catalog item. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      title="Item details"
      titleId="catalog-item-details-title"
      onClose={onClose}
      disableClose={isDeleting || isSavingName}
    >
      <div className="details-modal-layout">
        <section className="details-summary-panel" aria-label="Catalog item summary">
          <div>
            <h3 title={displayName}>{displayName}</h3>
            <p>Secondary catalog metadata and item actions.</p>
          </div>
          <div className="details-summary-badges">
            {resolutionBadge && (
              <span className={`resolution-pill ${resolutionBadge.className}`} title={resolutionBadge.title}>
                {resolutionBadge.label}
              </span>
            )}
            <span className={`status-badge ${getStatusBadgeClass(item.status)}`}>
              {STATUS_LABELS[item.status]}
            </span>
          </div>
        </section>

        <form
          className="details-title-editor"
          onSubmit={(event: FormEvent<HTMLFormElement>) => void handleRenameSubmit(event)}
        >
          <div className="details-title-editor-copy">
            <label htmlFor="details-visible-name">Catalog title</label>
            <p>This is the title shown in the catalog grid, viewer, and downloads.</p>
          </div>
          <div className="details-title-editor-control">
            <input
              id="details-visible-name"
              type="text"
              value={editableVisibleName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setEditableVisibleName(event.target.value);
                setNameSaveNotice(null);
              }}
              disabled={isSavingName || isDeleting}
            />
            <button
              type="submit"
              className="app-button"
              disabled={isSavingName || isDeleting || !canSaveVisibleName}
            >
              {isSavingName ? 'Saving…' : 'Save title'}
            </button>
          </div>
          {nameSaveNotice && (
            <p className={`notice notice-${nameSaveNotice.tone}`} aria-live="polite">
              {nameSaveNotice.text}
            </p>
          )}
        </form>

        <dl className="details-meta-list">
          <div>
            <dt>Added date</dt>
            <dd>{formatTimestamp(item.uploadedAt)}</dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{formatBytes(item.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{canDownloadRetainedVideo ? formatDuration(item.probe?.durationSeconds ?? null) : deferredMetadataText}</dd>
          </div>
          <div>
            <dt>Resolution</dt>
            <dd>{canDownloadRetainedVideo ? formatResolution(item.probe) : deferredMetadataText}</dd>
          </div>
          <div>
            <dt>Last viewed date</dt>
            <dd>{formatOptionalTimestamp(item.lastViewedAt)}</dd>
          </div>
          <div>
            <dt>Last downloaded date</dt>
            <dd>{formatOptionalTimestamp(item.lastDownloadedAt)}</dd>
          </div>
        </dl>

        <div className="details-action-row" aria-label="Catalog item actions">
          <a
            className={`details-action-button${canDownloadRetainedVideo ? '' : ' is-disabled'}`}
            href={canDownloadRetainedVideo ? buildDownloadUrl(item) : undefined}
            aria-disabled={!canDownloadRetainedVideo}
            onClick={(event) => {
              if (!canDownloadRetainedVideo) {
                event.preventDefault();
              }
            }}
          >
            <DownloadIcon />
            <span>Download retained video</span>
          </a>
          {item.sourceUrl && (
            <a
              className="details-action-button secondary"
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon />
              <span>Open source page</span>
            </a>
          )}
        </div>

        <section className="details-danger-zone" aria-labelledby="details-delete-title">
          <div>
            <h3 id="details-delete-title">Delete catalog item</h3>
            <p>
              Delete removes this item from the catalog and cleans up its retained media, thumbnails,
              previews, saved-moment thumbnails, and transient processing folders.
            </p>
          </div>

          {!isConfirmingDelete ? (
            <button
              type="button"
              className="details-delete-button"
              onClick={() => {
                setIsConfirmingDelete(true);
                setDeleteError('');
              }}
              disabled={isSavingName}
            >
              <TrashIcon />
              <span>Delete item</span>
            </button>
          ) : (
            <div className="details-delete-confirmation">
              <p>Delete “{displayName}” permanently from this catalog?</p>
              {deleteError && (
                <p className="notice notice-error" aria-live="polite">
                  {deleteError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => {
                    setIsConfirmingDelete(false);
                    setDeleteError('');
                  }}
                  disabled={isDeleting || isSavingName}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="app-button danger"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={isDeleting || isSavingName}
                >
                  {isDeleting ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function ActivityFeedCard({
  item,
  onOpenDuplicateResolution
}: {
  item: ActivityPanelItem;
  onOpenDuplicateResolution: (pendingIngest: PendingIngest) => void;
}): JSX.Element {
  const stageLabel = PROCESSING_STAGE_LABELS[item.processing.stage];
  const pendingIngestNeedsAction =
    item.pendingIngest !== null && pendingIngestNeedsUserAction(item.pendingIngest);
  const pendingIngestActionLabel =
    item.pendingIngest?.duplicateCheck.hasConflicts === true ? 'Review duplicate' : 'Confirm title';

  return (
    <article className="activity-card">
      <div className="activity-card-header">
        <div>
          <h4 title={item.title}>{item.title}</h4>
          <p>{SOURCE_TYPE_LABELS[item.sourceType]}</p>
        </div>
        <span className={`status-badge ${getStatusBadgeClass(item.status)}`}>
          {item.status === 'pending' ? 'Pending' : STATUS_LABELS[item.status]}
        </span>
      </div>
      <div className="activity-stage-row">
        <strong>{stageLabel}</strong>
        <span>{formatPercent(item.processing.percent)}</span>
      </div>
      <p className="activity-message">{item.processing.message}</p>
      <ProgressMeter percent={item.processing.percent} label={`${item.title} progress`} />
      <div className="activity-meta-row">
        <span>{formatTimestamp(item.processing.updatedAt)}</span>
        {pendingIngestNeedsAction && item.pendingIngest && (
          <button
            type="button"
            className="link-button"
            onClick={() => onOpenDuplicateResolution(item.pendingIngest as PendingIngest)}
          >
            {pendingIngestActionLabel}
          </button>
        )}
      </div>
    </article>
  );
}

function ViewerOverlay({
  item,
  onClose,
  onMarkUsed,
  onSetThumbnail,
  onListBookmarks,
  onCreateBookmark,
  onUpdateBookmarkName,
  onUseBookmark,
  onDeleteBookmark,
  onSaveViewerVisualAdjustments,
  attemptFullscreenOnOpen
}: ViewerOverlayProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const viewerHeaderRef = useRef<HTMLDivElement | null>(null);
  const viewerFooterRef = useRef<HTMLDivElement | null>(null);
  const viewerBookmarksDrawerRef = useRef<HTMLDivElement | null>(null);
  const viewerAdjustmentsDrawerRef = useRef<HTMLDivElement | null>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerStageRef = useRef<HTMLDivElement | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const playbackProgressTimerRef = useRef<number | null>(null);
  const loopEnforcementFrameRef = useRef<number | null>(null);
  const focusRestoreFrameRef = useRef<number | null>(null);
  const isTimelineScrubbingRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(VIEWER_MUTED_RESTORE_VOLUME);
  const closeInProgressRef = useRef(false);
  const hasClosedRef = useRef(false);
  const usedActionInProgressRef = useRef(false);
  const thumbnailActionInProgressRef = useRef(false);
  const bookmarkCreateInProgressRef = useRef(false);
  const bookmarkActionInProgressRef = useRef(false);
  const bookmarkCycleIndexRef = useRef(-1);
  const isBookmarksDrawerOpenRef = useRef(false);
  const isAdjustmentsDrawerOpenRef = useRef(false);
  const isSavingViewerVisualAdjustmentsRef = useRef(false);
  const pendingViewerVisualAdjustmentsRef = useRef<ViewerVisualAdjustments | null>(null);
  const viewerVisualAdjustmentsRef = useRef<ViewerVisualAdjustments>(getInitialViewerVisualAdjustments(item));
  const viewerLoopStateRef = useRef<ViewerLoopState>(createEmptyViewerLoopState());
  const viewerLoopShortcutPhaseRef = useRef<ViewerLoopShortcutPhase>('start');
  const [videoCandidateIndex, setVideoCandidateIndex] = useState(0);
  const [viewerError, setViewerError] = useState<string>('');
  const [fitMode, setFitMode] = useState<ViewerFitMode>('fit');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<ViewerPan>({
    x: 0,
    y: 0
  });
  const [isAttemptingPlayback, setIsAttemptingPlayback] = useState(false);
  const [isMarkingUsed, setIsMarkingUsed] = useState(false);
  const [isSettingThumbnail, setIsSettingThumbnail] = useState(false);
  const [bookmarks, setBookmarks] = useState<CatalogBookmark[]>([]);
  const [isBookmarksDrawerOpen, setIsBookmarksDrawerOpen] = useState(false);
  const [viewerVisualAdjustments, setViewerVisualAdjustments] = useState<ViewerVisualAdjustments>(() =>
    getInitialViewerVisualAdjustments(item)
  );
  const [isAdjustmentsDrawerOpen, setIsAdjustmentsDrawerOpen] = useState(false);
  const [isSavingViewerVisualAdjustments, setIsSavingViewerVisualAdjustments] = useState(false);
  const [isLoadingBookmarks, setIsLoadingBookmarks] = useState(false);
  const [isCreatingBookmark, setIsCreatingBookmark] = useState(false);
  const [bookmarkActionId, setBookmarkActionId] = useState<string | null>(null);
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkName, setEditingBookmarkName] = useState('');
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(VIEWER_DEFAULT_VOLUME);
  const [viewerStageSize, setViewerStageSize] = useState<ViewerSize>({
    width: 0,
    height: 0
  });
  const [videoNaturalSize, setVideoNaturalSize] = useState<ViewerSize | null>(null);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(item.probe?.durationSeconds ?? null);
  const [viewerLoopState, setViewerLoopState] = useState<ViewerLoopState>(() => createEmptyViewerLoopState());
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const videoCandidates = useMemo(() => buildVideoUrlCandidates(item), [
    item.id,
    item.relativePath,
    item.retainedChecksumSha256,
    item.uploadedAt
  ]);
  const videoUrl = videoCandidates[videoCandidateIndex] ?? null;
  const intrinsicVideoWidth = normalizePositiveDimension(videoNaturalSize?.width ?? item.probe?.width);
  const intrinsicVideoHeight = normalizePositiveDimension(videoNaturalSize?.height ?? item.probe?.height);
  const playbackRateLabel = useMemo(() => formatViewerPlaybackRate(playbackRate), [playbackRate]);
  const zoomLabel = useMemo(() => formatViewerZoomLabel(zoom), [zoom]);
  const resolvedDuration = duration ?? item.probe?.durationSeconds ?? null;
  const viewerLoopRange = useMemo(
    () => getViewerLoopRange(viewerLoopState, resolvedDuration),
    [resolvedDuration, viewerLoopState.endSeconds, viewerLoopState.startSeconds]
  );
  const isViewerLoopActive = viewerLoopRange !== null;
  const viewerLoopStartLabel = formatViewerClockTime(viewerLoopState.startSeconds);
  const viewerLoopEndLabel = formatViewerClockTime(viewerLoopState.endSeconds);
  const viewerLoopStatusLabel = viewerLoopRange
    ? `Loop active from ${formatViewerClockTime(viewerLoopRange.startSeconds)} to ${formatViewerClockTime(viewerLoopRange.endSeconds)}`
    : viewerLoopState.startSeconds !== null
      ? `Loop start set at ${viewerLoopStartLabel}. Set an end point to activate looping.`
      : 'No loop is set.';
  const displayedTimelineTime = isTimelineScrubbing && scrubTime !== null ? scrubTime : currentTime;
  const timelinePercent = useMemo(
    () => getViewerTimelinePercent(displayedTimelineTime, resolvedDuration),
    [displayedTimelineTime, resolvedDuration]
  );
  const timelineStyle = useMemo(
    () => ({ '--viewer-timeline-progress': `${timelinePercent}%` } as CSSProperties),
    [timelinePercent]
  );
  const timelineLoopMarkers = useMemo(() => {
    if (resolvedDuration === null || !Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
      return null;
    }

    const loopRange = getViewerLoopRange(viewerLoopState, resolvedDuration);
    const startSeconds = loopRange?.startSeconds ?? viewerLoopState.startSeconds;
    const endSeconds = loopRange?.endSeconds ?? null;

    if (startSeconds === null) {
      return null;
    }

    const startPercent = getViewerTimelinePercent(
      normalizeViewerLoopTime(startSeconds, resolvedDuration),
      resolvedDuration
    );
    const endPercent =
      endSeconds === null
        ? null
        : getViewerTimelinePercent(normalizeViewerLoopTime(endSeconds, resolvedDuration), resolvedDuration);

    return {
      isActive: loopRange !== null,
      startLabel: formatViewerClockTime(startSeconds),
      endLabel: endSeconds === null ? null : formatViewerClockTime(endSeconds),
      startStyle: {
        '--viewer-timeline-loop-start': `${startPercent}%`
      } as CSSProperties,
      endStyle:
        endPercent === null
          ? null
          : ({
              '--viewer-timeline-loop-end': `${endPercent}%`
            } as CSSProperties),
      rangeStyle:
        loopRange === null || endPercent === null
          ? null
          : ({
              '--viewer-timeline-loop-start': `${startPercent}%`,
              '--viewer-timeline-loop-width': `${Math.max(0, endPercent - startPercent)}%`
            } as CSSProperties)
    };
  }, [resolvedDuration, viewerLoopState.endSeconds, viewerLoopState.startSeconds]);
  const timelineBookmarkMarkers = useMemo(() => {
    if (resolvedDuration === null || !Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
      return [];
    }

    let previousBookmarkPercent: number | null = null;
    let nearbyMarkerLane = 0;

    return bookmarks
      .filter((bookmark) => Number.isFinite(bookmark.timeSeconds))
      .map((bookmark) => {
        const clampedBookmarkTime = clampViewerTime(bookmark.timeSeconds, resolvedDuration);
        const bookmarkPercent = getViewerTimelinePercent(clampedBookmarkTime, resolvedDuration);
        const bookmarkTimeLabel = formatViewerClockTime(clampedBookmarkTime);
        const bookmarkTitle = normalizeBookmarkName(bookmark.name);
        const markerLabel = bookmarkTitle ?? bookmarkTimeLabel;
        const markerAriaLabel =
          bookmarkTitle === null
            ? `Jump to moment at ${bookmarkTimeLabel}`
            : `Jump to ${bookmarkTitle} at ${bookmarkTimeLabel}`;

        if (previousBookmarkPercent !== null && Math.abs(bookmarkPercent - previousBookmarkPercent) <= 1.4) {
          nearbyMarkerLane = (nearbyMarkerLane + 1) % 3;
        } else {
          nearbyMarkerLane = 0;
        }

        previousBookmarkPercent = bookmarkPercent;
        const markerEdgeClass =
          bookmarkPercent <= 6 ? ' is-near-start' : bookmarkPercent >= 94 ? ' is-near-end' : '';

        return {
          bookmark,
          bookmarkTimeLabel,
          markerAriaLabel,
          markerClassName: `viewer-timeline-bookmark-marker${markerEdgeClass}`,
          markerLabel,
          markerStyle: {
            '--viewer-timeline-bookmark-left': `${bookmarkPercent}%`,
            '--viewer-timeline-bookmark-lane-offset': `${nearbyMarkerLane * 0.38}rem`
          } as CSSProperties
        };
      });
  }, [bookmarks, resolvedDuration]);
  const volumePercent = useMemo(() => Math.round(clampViewerVolume(volume) * 100), [volume]);
  const volumeStyle = useMemo(
    () => ({ '--viewer-volume-progress': `${volumePercent}%` } as CSSProperties),
    [volumePercent]
  );
  const viewerVisualAdjustmentLabels = useMemo(
    () => ({
      contrast: formatViewerVisualAdjustmentPercent(viewerVisualAdjustments.contrast),
      brightness: formatViewerVisualAdjustmentPercent(viewerVisualAdjustments.brightness),
      saturation: formatViewerVisualAdjustmentPercent(viewerVisualAdjustments.saturation)
    }),
    [
      viewerVisualAdjustments.brightness,
      viewerVisualAdjustments.contrast,
      viewerVisualAdjustments.saturation
    ]
  );
  const viewerVisualAdjustmentStyles = useMemo(
    () => ({
      contrast: createViewerVisualAdjustmentSliderStyle(viewerVisualAdjustments.contrast),
      brightness: createViewerVisualAdjustmentSliderStyle(viewerVisualAdjustments.brightness),
      saturation: createViewerVisualAdjustmentSliderStyle(viewerVisualAdjustments.saturation)
    }),
    [
      viewerVisualAdjustments.brightness,
      viewerVisualAdjustments.contrast,
      viewerVisualAdjustments.saturation
    ]
  );
  const areViewerVisualAdjustmentsDefault = useMemo(
    () => areViewerVisualAdjustmentValuesDefault(viewerVisualAdjustments),
    [
      viewerVisualAdjustments.brightness,
      viewerVisualAdjustments.contrast,
      viewerVisualAdjustments.saturation
    ]
  );
  const resolutionLabel =
    intrinsicVideoWidth !== null && intrinsicVideoHeight !== null
      ? `${intrinsicVideoWidth}×${intrinsicVideoHeight}`
      : formatResolution(item.probe);
  const renderedVideoSize = useMemo<ViewerSize | null>(() => {
    if (
      intrinsicVideoWidth === null ||
      intrinsicVideoHeight === null ||
      viewerStageSize.width <= 0 ||
      viewerStageSize.height <= 0
    ) {
      return null;
    }

    const widthScale = viewerStageSize.width / intrinsicVideoWidth;
    const heightScale = viewerStageSize.height / intrinsicVideoHeight;
    const baseScale = fitMode === 'fit' ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
    const safeScale = Number.isFinite(baseScale) && baseScale > 0 ? baseScale : 1;

    return {
      width: Math.max(1, intrinsicVideoWidth * safeScale * zoom),
      height: Math.max(1, intrinsicVideoHeight * safeScale * zoom)
    };
  }, [fitMode, intrinsicVideoHeight, intrinsicVideoWidth, viewerStageSize.height, viewerStageSize.width, zoom]);
  const viewerPanLimit = useMemo<ViewerPan>(
    () => ({
      x:
        renderedVideoSize !== null
          ? Math.max(0, (renderedVideoSize.width - viewerStageSize.width) / 2)
          : 0,
      y:
        renderedVideoSize !== null
          ? Math.max(0, (renderedVideoSize.height - viewerStageSize.height) / 2)
          : 0
    }),
    [renderedVideoSize, viewerStageSize.height, viewerStageSize.width]
  );
  const viewerPanOffset = useMemo<ViewerPan>(
    () => ({
      x:
        viewerPanLimit.x > 0 ? Number((clampViewerPanRatio(pan.x) * viewerPanLimit.x).toFixed(2)) : 0,
      y:
        viewerPanLimit.y > 0 ? Number((clampViewerPanRatio(pan.y) * viewerPanLimit.y).toFixed(2)) : 0
    }),
    [pan.x, pan.y, viewerPanLimit.x, viewerPanLimit.y]
  );
  const viewerVideoStyle = useMemo<CSSProperties>(() => {
    const baseStyle: CSSProperties = {
      display: 'block',
      position: 'relative',
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      left: 'auto',
      margin: 0,
      flex: '0 0 auto',
      maxWidth: 'none',
      maxHeight: 'none',
      filter: buildViewerVisualAdjustmentFilter(viewerVisualAdjustments),
      transform: `translate3d(${-viewerPanOffset.x}px, ${-viewerPanOffset.y}px, 0)`,
      transformOrigin: 'center center'
    };

    if (renderedVideoSize !== null) {
      return {
        ...baseStyle,
        width: `${renderedVideoSize.width}px`,
        height: `${renderedVideoSize.height}px`
      };
    }

    return {
      ...baseStyle,
      width: '100%',
      height: '100%',
      objectFit: fitMode === 'fit' ? 'contain' : 'cover'
    };
  }, [
    fitMode,
    renderedVideoSize,
    viewerPanOffset.x,
    viewerPanOffset.y,
    viewerVisualAdjustments.brightness,
    viewerVisualAdjustments.contrast,
    viewerVisualAdjustments.saturation
  ]);

  function clearControlsHideTimer(): void {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  }

  function stopPlaybackProgressTimer(): void {
    if (playbackProgressTimerRef.current !== null) {
      window.clearInterval(playbackProgressTimerRef.current);
      playbackProgressTimerRef.current = null;
    }
  }

  function clearLoopEnforcementFrame(): void {
    if (loopEnforcementFrameRef.current !== null) {
      window.cancelAnimationFrame(loopEnforcementFrameRef.current);
      loopEnforcementFrameRef.current = null;
    }
  }

  function clearFocusRestoreFrame(): void {
    if (focusRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(focusRestoreFrameRef.current);
      focusRestoreFrameRef.current = null;
    }
  }

  function focusVideoElement(): void {
    const videoElement = videoRef.current;
    if (!videoElement || document.activeElement === videoElement) {
      return;
    }

    const activeElement = document.activeElement;
    const isFocusWithinViewerControls =
      activeElement instanceof HTMLElement &&
      (viewerHeaderRef.current?.contains(activeElement) === true ||
        viewerFooterRef.current?.contains(activeElement) === true ||
        viewerBookmarksDrawerRef.current?.contains(activeElement) === true ||
        viewerAdjustmentsDrawerRef.current?.contains(activeElement) === true);

    if (isFocusWithinViewerControls) {
      activeElement.blur();
    }

    try {
      videoElement.focus({
        preventScroll: true
      });
    } catch {
      videoElement.focus();
    }
  }

  function scheduleVideoFocusRestore(): void {
    clearFocusRestoreFrame();
    focusRestoreFrameRef.current = window.requestAnimationFrame(() => {
      focusRestoreFrameRef.current = null;
      focusVideoElement();
    });
  }

  function getViewerInteractionElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) {
      return target;
    }

    if (target instanceof Node) {
      return target.parentElement;
    }

    return null;
  }

  function maybeRestoreVideoFocusFromInteractionTarget(target: EventTarget | null): void {
    const interactionElement = getViewerInteractionElement(target);
    if (!interactionElement) {
      return;
    }

    if (
      interactionElement.closest(
        '.viewer-header, .viewer-footer, .viewer-bookmarks-drawer, .viewer-adjustments-drawer'
      ) === null
    ) {
      return;
    }

    if (interactionElement.closest('.viewer-toolbar-button-close, .viewer-toolbar-button-used') !== null) {
      return;
    }

    if (interactionElement.closest('.viewer-bookmark-rename-trigger, .viewer-bookmark-rename-form') !== null) {
      return;
    }

    scheduleVideoFocusRestore();
  }

  function updateViewerLoopState(nextState: ViewerLoopState): void {
    const startSeconds =
      nextState.startSeconds === null ? null : normalizeViewerLoopTime(nextState.startSeconds, resolvedDuration);
    const endSeconds =
      startSeconds === null || nextState.endSeconds === null
        ? null
        : normalizeViewerLoopTime(nextState.endSeconds, resolvedDuration);
    const nextLoopState: ViewerLoopState =
      startSeconds === null
        ? createEmptyViewerLoopState()
        : endSeconds === null
          ? {
              startSeconds,
              endSeconds: null
            }
          : getViewerLoopRange({ startSeconds, endSeconds }, resolvedDuration) ?? {
              startSeconds,
              endSeconds: null
            };

    viewerLoopStateRef.current = nextLoopState;
    setViewerLoopState((currentValue) =>
      areViewerLoopStatesEqual(currentValue, nextLoopState) ? currentValue : nextLoopState
    );

    if (getViewerLoopRange(nextLoopState, resolvedDuration) === null) {
      clearLoopEnforcementFrame();
      return;
    }

    const videoElement = videoRef.current;
    if (videoElement && !videoElement.paused && !videoElement.ended) {
      startLoopEnforcementFrame();
    }
  }

  function setViewerLoopShortcutPhase(nextPhase: ViewerLoopShortcutPhase): void {
    viewerLoopShortcutPhaseRef.current = nextPhase;
  }

  function resetViewerLoop(
    options: { restoreFocus?: boolean; noteActivity?: boolean } = {}
  ): void {
    updateViewerLoopState(createEmptyViewerLoopState());
    setViewerLoopShortcutPhase('start');
    clearLoopEnforcementFrame();

    if (options.noteActivity !== false) {
      noteViewerActivity();
    }

    if (options.restoreFocus !== false) {
      scheduleVideoFocusRestore();
    }
  }

  function getCurrentViewerPlaybackTime(): number {
    const videoElement = videoRef.current;
    const rawCurrentTime =
      videoElement && Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : currentTime;

    return normalizeViewerLoopTime(rawCurrentTime, resolvedDuration);
  }

  function constrainTimeToActiveViewerLoop(
    nextTime: number,
    options: { loopAtEnd: boolean; endToleranceSeconds?: number }
  ): number {
    const activeLoopRange = getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration);

    if (activeLoopRange === null) {
      return normalizeViewerLoopTime(nextTime, resolvedDuration);
    }

    return constrainViewerTimeToLoopRange(nextTime, activeLoopRange, resolvedDuration, options);
  }

  function enforceActiveViewerLoop(
    options: { loopAtEnd: boolean; endToleranceSeconds?: number }
  ): boolean {
    const videoElement = videoRef.current;
    const activeLoopRange = getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration);

    if (!videoElement || activeLoopRange === null) {
      return false;
    }

    const currentVideoTime = Number.isFinite(videoElement.currentTime)
      ? videoElement.currentTime
      : currentTime;
    const constrainedTime = constrainViewerTimeToLoopRange(
      currentVideoTime,
      activeLoopRange,
      resolvedDuration,
      options
    );

    if (Math.abs(constrainedTime - currentVideoTime) < 0.001) {
      return false;
    }

    videoElement.currentTime = constrainedTime;
    setCurrentTime(constrainedTime);

    if (isTimelineScrubbingRef.current) {
      setScrubTime(constrainedTime);
    }

    return true;
  }

  function startLoopEnforcementFrame(): void {
    clearLoopEnforcementFrame();

    const tick = (): void => {
      loopEnforcementFrameRef.current = null;

      const videoElement = videoRef.current;
      if (
        !videoElement ||
        videoElement.paused ||
        videoElement.ended ||
        getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration) === null
      ) {
        return;
      }

      enforceActiveViewerLoop({
        loopAtEnd: true,
        endToleranceSeconds: VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS
      });
      loopEnforcementFrameRef.current = window.requestAnimationFrame(tick);
    };

    loopEnforcementFrameRef.current = window.requestAnimationFrame(tick);
  }

  function setViewerLoopStartAtCurrentTime(): void {
    if (videoUrl === null) {
      return;
    }

    const startSeconds = getCurrentViewerPlaybackTime();
    updateViewerLoopState({
      startSeconds,
      endSeconds: null
    });
    setViewerLoopShortcutPhase('end');
    noteViewerActivity();
    scheduleVideoFocusRestore();
  }

  function setViewerLoopEndAtCurrentTime(): void {
    if (videoUrl === null) {
      return;
    }

    const currentLoopStart = viewerLoopStateRef.current.startSeconds;
    if (currentLoopStart === null) {
      setViewerLoopStartAtCurrentTime();
      return;
    }

    const endSeconds = getCurrentViewerPlaybackTime();
    const loopRange = createViewerLoopRange(currentLoopStart, endSeconds, resolvedDuration);

    if (loopRange === null) {
      updateViewerLoopState({
        startSeconds: currentLoopStart,
        endSeconds: null
      });
      setViewerLoopShortcutPhase('reset');
      noteViewerActivity();
      scheduleVideoFocusRestore();
      return;
    }

    updateViewerLoopState(loopRange);
    setViewerLoopShortcutPhase('reset');

    const videoElement = videoRef.current;
    if (videoElement && !videoElement.paused && !videoElement.ended) {
      enforceActiveViewerLoop({
        loopAtEnd: true,
        endToleranceSeconds: VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS
      });
      startLoopEnforcementFrame();
    }

    noteViewerActivity();
    scheduleVideoFocusRestore();
  }

  function handleViewerLoopShortcut(): void {
    switch (viewerLoopShortcutPhaseRef.current) {
      case 'start':
        setViewerLoopStartAtCurrentTime();
        return;
      case 'end':
        setViewerLoopEndAtCurrentTime();
        return;
      case 'reset':
        resetViewerLoop();
        return;
      default:
        resetViewerLoop();
    }
  }

  function stopVideoPlaybackForViewerClose(): void {
    const videoElement = videoRef.current;

    if (videoElement) {
      videoElement.pause();
    }

    setIsAttemptingPlayback(false);
    setIsVideoPlaying(false);
    stopPlaybackProgressTimer();
    resetViewerLoop({
      restoreFocus: false,
      noteActivity: false
    });
  }

  function finalizeViewerClose(): void {
    if (hasClosedRef.current) {
      return;
    }

    hasClosedRef.current = true;
    clearControlsHideTimer();
    clearFocusRestoreFrame();
    clearLoopEnforcementFrame();
    stopPlaybackProgressTimer();
    updateViewerLoopState(createEmptyViewerLoopState());
    onClose();
  }

  function syncPlaybackRateFromVideo(videoElement: HTMLVideoElement | null = videoRef.current): void {
    const nextPlaybackRate =
      videoElement && Number.isFinite(videoElement.playbackRate) ? videoElement.playbackRate : 1;

    setPlaybackRate((currentValue) =>
      currentValue === nextPlaybackRate ? currentValue : nextPlaybackRate
    );
  }

  function syncPlaybackTimeFromVideo(
    videoElement: HTMLVideoElement | null = videoRef.current,
    options: { enforceLoop?: boolean; loopAtEnd?: boolean; endToleranceSeconds?: number } = {}
  ): void {
    const nextDuration =
      videoElement && Number.isFinite(videoElement.duration) && videoElement.duration > 0
        ? videoElement.duration
        : item.probe?.durationSeconds ?? null;

    if (options.enforceLoop === true) {
      enforceActiveViewerLoop({
        loopAtEnd: options.loopAtEnd ?? false,
        endToleranceSeconds: options.endToleranceSeconds
      });
    }

    const nextCurrentTime =
      videoElement && Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : 0;

    setDuration((currentValue) => (currentValue === nextDuration ? currentValue : nextDuration));
    setCurrentTime((currentValue) =>
      Math.abs(currentValue - nextCurrentTime) < 0.04 ? currentValue : nextCurrentTime
    );
  }

  function startPlaybackProgressTimer(): void {
    stopPlaybackProgressTimer();
    playbackProgressTimerRef.current = window.setInterval(() => {
      syncPlaybackTimeFromVideo(videoRef.current, {
        enforceLoop: true,
        loopAtEnd: true,
        endToleranceSeconds: VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS
      });
    }, 100);
  }

  function scheduleControlsHide(): void {
    clearControlsHideTimer();
    controlsHideTimerRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      const isFocusWithinHeader =
        activeElement !== null && viewerHeaderRef.current?.contains(activeElement) === true;
      const isFocusWithinFooter =
        activeElement !== null && viewerFooterRef.current?.contains(activeElement) === true;
      const isFocusWithinBookmarksDrawer =
        activeElement !== null && viewerBookmarksDrawerRef.current?.contains(activeElement) === true;
      const isFocusWithinAdjustmentsDrawer =
        activeElement !== null && viewerAdjustmentsDrawerRef.current?.contains(activeElement) === true;

      if (
        isFocusWithinHeader ||
        isFocusWithinFooter ||
        isFocusWithinBookmarksDrawer ||
        isFocusWithinAdjustmentsDrawer ||
        isBookmarksDrawerOpenRef.current ||
        isAdjustmentsDrawerOpenRef.current ||
        isTimelineScrubbingRef.current
      ) {
        scheduleControlsHide();
        return;
      }

      setAreControlsVisible(false);
    }, VIEWER_TOOLBAR_AUTO_HIDE_DELAY_MS);
  }

  function noteViewerActivity(): void {
    setAreControlsVisible((currentValue) => (currentValue ? currentValue : true));
    scheduleControlsHide();
  }

  function setVideoPlaybackRate(nextPlaybackRate: number): void {
    const safePlaybackRate = clampViewerPlaybackRate(nextPlaybackRate);
    const videoElement = videoRef.current;

    if (videoElement) {
      videoElement.playbackRate = safePlaybackRate;
      syncPlaybackRateFromVideo(videoElement);
      return;
    }

    setPlaybackRate(safePlaybackRate);
  }

  function panViewerBy(deltaX: number, deltaY: number): void {
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    const horizontalStep = getViewerPanStep(viewerStageSize.width);
    const verticalStep = getViewerPanStep(viewerStageSize.height);

    setPan((currentValue) => {
      const nextX =
        viewerPanLimit.x > 0
          ? clampViewerPanRatio(currentValue.x + (deltaX * horizontalStep) / viewerPanLimit.x)
          : 0;
      const nextY =
        viewerPanLimit.y > 0
          ? clampViewerPanRatio(currentValue.y + (deltaY * verticalStep) / viewerPanLimit.y)
          : 0;

      if (currentValue.x === nextX && currentValue.y === nextY) {
        return currentValue;
      }

      return {
        x: nextX,
        y: nextY
      };
    });
  }

  function resetViewerZoom(): void {
    setZoom(1);
    setPan({
      x: 0,
      y: 0
    });
  }

  function toggleViewerFitMode(): void {
    noteViewerActivity();
    setFitMode((currentValue) => (currentValue === 'fit' ? 'fill' : 'fit'));
  }

  function setVideoVolume(nextVolume: number): void {
    const safeVolume = clampViewerVolume(nextVolume);
    const videoElement = videoRef.current;

    if (safeVolume > 0) {
      lastNonZeroVolumeRef.current = safeVolume;
    }

    if (videoElement) {
      videoElement.volume = safeVolume;
      videoElement.muted = safeVolume <= 0;
    }

    setVolume((currentValue) => (currentValue === safeVolume ? currentValue : safeVolume));
  }

  function toggleVideoMute(): void {
    const videoElement = videoRef.current;
    const currentVolume =
      videoElement && Number.isFinite(videoElement.volume) ? videoElement.volume : volume;
    const safeCurrentVolume = clampViewerVolume(currentVolume);

    if (safeCurrentVolume <= 0) {
      setVideoVolume(
        lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : VIEWER_MUTED_RESTORE_VOLUME
      );
      return;
    }

    lastNonZeroVolumeRef.current = safeCurrentVolume;
    setVideoVolume(0);
  }

  function triggerViewerDownload(): void {
    noteViewerActivity();

    if (downloadLinkRef.current) {
      downloadLinkRef.current.click();
      return;
    }

    window.location.href = buildDownloadUrl(item);
  }

  function adjustVideoPlaybackRate(delta: number): void {
    const videoElement = videoRef.current;
    const currentPlaybackRate =
      videoElement && Number.isFinite(videoElement.playbackRate)
        ? videoElement.playbackRate
        : playbackRate;

    setVideoPlaybackRate(changeViewerPlaybackRate(currentPlaybackRate, delta));
  }

  function seekVideoTo(nextTime: number): number {
    const safeNextTime = constrainTimeToActiveViewerLoop(nextTime, {
      loopAtEnd: true
    });
    const videoElement = videoRef.current;

    if (videoElement) {
      videoElement.currentTime = safeNextTime;
    }

    setCurrentTime(safeNextTime);
    return safeNextTime;
  }

  function seekVideoBy(deltaSeconds: number): void {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const currentVideoTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : currentTime;
    seekVideoTo(currentVideoTime + deltaSeconds);
    syncPlaybackTimeFromVideo(videoElement, {
      enforceLoop: true,
      loopAtEnd: true
    });
  }

  function jumpToViewerBeginning(): void {
    bookmarkCycleIndexRef.current = -1;
    seekVideoTo(0);
    syncPlaybackTimeFromVideo();
  }

  function jumpToBookmarkShortcut(shortcutIndex: number): void {
    const bookmark = bookmarks[shortcutIndex];
    if (!bookmark) {
      return;
    }

    bookmarkCycleIndexRef.current = shortcutIndex;
    seekVideoTo(bookmark.timeSeconds);
    syncPlaybackTimeFromVideo();
  }

  function cycleBookmarkShortcut(): void {
    if (bookmarks.length === 0) {
      jumpToViewerBeginning();
      return;
    }

    const currentCycleIndex = bookmarkCycleIndexRef.current;

    if (currentCycleIndex >= 0) {
      if (currentCycleIndex < bookmarks.length - 1) {
        jumpToBookmarkShortcut(currentCycleIndex + 1);
        return;
      }

      jumpToViewerBeginning();
      return;
    }

    jumpToBookmarkShortcut(0);
  }

  function beginTimelineScrubbing(): void {
    isTimelineScrubbingRef.current = true;
    setIsTimelineScrubbing(true);
    noteViewerActivity();
  }

  function endTimelineScrubbing(): void {
    if (!isTimelineScrubbingRef.current) {
      return;
    }

    isTimelineScrubbingRef.current = false;
    setIsTimelineScrubbing(false);
    setScrubTime(null);
    syncPlaybackTimeFromVideo(videoRef.current, {
      enforceLoop: true,
      loopAtEnd: true
    });
    noteViewerActivity();
    scheduleVideoFocusRestore();
  }

  function handleTimelineChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextTime = clampViewerTime(Number(event.target.value), resolvedDuration);
    const safeNextTime = seekVideoTo(nextTime);
    setScrubTime(safeNextTime);
    noteViewerActivity();
  }

  function handleVolumeChange(event: ChangeEvent<HTMLInputElement>): void {
    setVideoVolume(Number(event.target.value));
    noteViewerActivity();
  }

  function handleVolumeInteractionEnd(): void {
    noteViewerActivity();

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    scheduleVideoFocusRestore();
  }

  async function flushViewerVisualAdjustmentsSaveQueue(): Promise<void> {
    if (isSavingViewerVisualAdjustmentsRef.current) {
      return;
    }

    const pendingAdjustments = pendingViewerVisualAdjustmentsRef.current;
    if (pendingAdjustments === null) {
      if (!hasClosedRef.current) {
        setIsSavingViewerVisualAdjustments(false);
      }
      return;
    }

    pendingViewerVisualAdjustmentsRef.current = null;
    isSavingViewerVisualAdjustmentsRef.current = true;

    if (!hasClosedRef.current) {
      setIsSavingViewerVisualAdjustments(true);
      setViewerError('');
    }

    try {
      const updatedItem = await onSaveViewerVisualAdjustments(item.id, pendingAdjustments);
      if (updatedItem === null && !hasClosedRef.current) {
        setViewerError('Unable to save visual adjustments for this video. Please try again.');
      }
    } catch (error) {
      if (!hasClosedRef.current) {
        setViewerError('Unable to save visual adjustments for this video. Please try again.');
      }
      console.warn('viewer.visual-adjustments.save.failed', {
        itemId: item.id,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      isSavingViewerVisualAdjustmentsRef.current = false;

      if (pendingViewerVisualAdjustmentsRef.current !== null) {
        void flushViewerVisualAdjustmentsSaveQueue();
        return;
      }

      if (!hasClosedRef.current) {
        setIsSavingViewerVisualAdjustments(false);
      }
    }
  }

  function queueViewerVisualAdjustmentsSave(adjustments: ViewerVisualAdjustments): void {
    pendingViewerVisualAdjustmentsRef.current = normalizeViewerVisualAdjustments(adjustments);
    void flushViewerVisualAdjustmentsSaveQueue();
  }

  function closeAdjustmentsDrawer(options: { restoreFocus?: boolean } = {}): void {
    isAdjustmentsDrawerOpenRef.current = false;
    setIsAdjustmentsDrawerOpen(false);
    noteViewerActivity();

    if (options.restoreFocus !== false) {
      scheduleVideoFocusRestore();
    }
  }

  function toggleAdjustmentsDrawer(): void {
    const nextOpen = !isAdjustmentsDrawerOpenRef.current;
    isAdjustmentsDrawerOpenRef.current = nextOpen;
    setIsAdjustmentsDrawerOpen(nextOpen);
    noteViewerActivity();

    if (nextOpen) {
      isBookmarksDrawerOpenRef.current = false;
      setIsBookmarksDrawerOpen(false);
      cancelBookmarkRename();
      return;
    }

    scheduleVideoFocusRestore();
  }

  function setViewerVisualAdjustmentValue(
    key: 'contrast' | 'brightness' | 'saturation',
    rawValue: number
  ): void {
    const safeValue = clampViewerVisualAdjustmentValue(rawValue);
    const nextValue = normalizeViewerVisualAdjustments({
      ...viewerVisualAdjustmentsRef.current,
      [key]: safeValue
    });

    viewerVisualAdjustmentsRef.current = nextValue;
    setViewerVisualAdjustments(nextValue);

    if (nextValue.enabled) {
      queueViewerVisualAdjustmentsSave(nextValue);
    }

    noteViewerActivity();
  }

  function handleViewerVisualAdjustmentChange(
    key: 'contrast' | 'brightness' | 'saturation',
    event: ChangeEvent<HTMLInputElement>
  ): void {
    setViewerVisualAdjustmentValue(key, Number(event.target.value));
  }

  function handleViewerVisualAdjustmentInteractionEnd(): void {
    noteViewerActivity();

    if (viewerVisualAdjustmentsRef.current.enabled) {
      queueViewerVisualAdjustmentsSave(viewerVisualAdjustmentsRef.current);
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    scheduleVideoFocusRestore();
  }

  function handleViewerVisualAdjustmentsPersistenceChange(event: ChangeEvent<HTMLInputElement>): void {
    const enabled = event.target.checked;
    const nextValue = normalizeViewerVisualAdjustments({
      ...viewerVisualAdjustmentsRef.current,
      enabled
    });

    viewerVisualAdjustmentsRef.current = nextValue;
    setViewerVisualAdjustments(nextValue);
    queueViewerVisualAdjustmentsSave(nextValue);
    noteViewerActivity();
  }

  function resetViewerVisualAdjustments(): void {
    const nextValue = normalizeViewerVisualAdjustments({
      ...DEFAULT_VIEWER_VISUAL_ADJUSTMENTS,
      enabled: viewerVisualAdjustmentsRef.current.enabled
    });

    viewerVisualAdjustmentsRef.current = nextValue;
    setViewerVisualAdjustments(nextValue);

    if (nextValue.enabled) {
      queueViewerVisualAdjustmentsSave(nextValue);
    }

    noteViewerActivity();
    scheduleVideoFocusRestore();
  }

  async function attemptPlayback(): Promise<void> {
    const videoElement = videoRef.current;
    if (!videoElement || !videoUrl) {
      return;
    }

    const activeLoopRange = getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration);
    if (activeLoopRange !== null) {
      const currentVideoTime = Number.isFinite(videoElement.currentTime) ? videoElement.currentTime : currentTime;
      const safeLoopTime = constrainViewerTimeToLoopRange(
        currentVideoTime,
        activeLoopRange,
        resolvedDuration,
        {
          loopAtEnd: true
        }
      );
      if (Math.abs(safeLoopTime - currentVideoTime) >= 0.001 || videoElement.ended) {
        videoElement.currentTime = safeLoopTime;
        setCurrentTime(safeLoopTime);
      }
    } else if (videoElement.ended && Number.isFinite(videoElement.duration)) {
      videoElement.currentTime = 0;
    }

    setIsAttemptingPlayback(true);
    setViewerError('');

    try {
      const playPromise = videoElement.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      setViewerError('');
    } catch (error) {
      const nextMessage = describeMediaPlayError(error);
      setViewerError(nextMessage);
      console.warn('viewer.play.rejected', {
        itemId: item.id,
        videoUrl,
        errorName: error instanceof DOMException ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        readyState: videoElement.readyState,
        networkState: videoElement.networkState,
        currentSrc: videoElement.currentSrc
      });
    } finally {
      setIsAttemptingPlayback(false);
    }
  }

  async function togglePlayback(): Promise<void> {
    const videoElement = videoRef.current;
    if (!videoElement || !videoUrl) {
      return;
    }

    noteViewerActivity();

    if (videoElement.paused || videoElement.ended) {
      await attemptPlayback();
      return;
    }

    videoElement.pause();
  }

  async function requestCloseViewer(): Promise<void> {
    if (closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    closeInProgressRef.current = true;
    clearFocusRestoreFrame();

    stopVideoPlaybackForViewerClose();

    finalizeViewerClose();

    try {
      if (document.fullscreenElement !== null) {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen exit is best-effort only.
    }
  }

  function handleCloseViewer(): void {
    void requestCloseViewer();
  }

  async function requestMarkUsed(): Promise<void> {
    if (usedActionInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    usedActionInProgressRef.current = true;
    setIsMarkingUsed(true);
    setViewerError('');

    stopVideoPlaybackForViewerClose();

    try {
      const didMarkUsed = await onMarkUsed(item.id);

      if (didMarkUsed) {
        await requestCloseViewer();
        return;
      }

      setViewerError('Unable to mark this item as used. Please try again.');
    } finally {
      if (!hasClosedRef.current) {
        usedActionInProgressRef.current = false;
        setIsMarkingUsed(false);
      }
    }
  }

  async function requestSetThumbnail(): Promise<void> {
    if (thumbnailActionInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement || !videoUrl) {
      return;
    }

    const videoCurrentTime = Number.isFinite(videoElement.currentTime)
      ? videoElement.currentTime
      : currentTime;
    const captureTimeSeconds = Math.max(0, Number.isFinite(videoCurrentTime) ? videoCurrentTime : 0);

    thumbnailActionInProgressRef.current = true;
    setIsSettingThumbnail(true);
    setViewerError('');
    noteViewerActivity();

    try {
      const didSetThumbnail = await onSetThumbnail(item.id, captureTimeSeconds);
      if (!didSetThumbnail) {
        setViewerError('Unable to set the thumbnail from the current frame. Please try again.');
      }
    } finally {
      if (!hasClosedRef.current) {
        thumbnailActionInProgressRef.current = false;
        setIsSettingThumbnail(false);
        scheduleVideoFocusRestore();
      }
    }
  }

  async function refreshBookmarks(showLoading = true): Promise<boolean> {
    if (showLoading) {
      setIsLoadingBookmarks(true);
    }

    try {
      const loadedBookmarks = await onListBookmarks(item.id);
      if (loadedBookmarks === null) {
        if (!hasClosedRef.current) {
          setViewerError('Unable to load bookmarks for this video. Please try again.');
        }
        return false;
      }

      if (!hasClosedRef.current) {
        setBookmarks(sortCatalogBookmarks(loadedBookmarks));
      }
      return true;
    } finally {
      if (!hasClosedRef.current && showLoading) {
        setIsLoadingBookmarks(false);
      }
    }
  }

  function cancelBookmarkRename(): void {
    setEditingBookmarkId(null);
    setEditingBookmarkName('');
  }

  function closeBookmarksDrawer(): void {
    isBookmarksDrawerOpenRef.current = false;
    setIsBookmarksDrawerOpen(false);
    cancelBookmarkRename();
    noteViewerActivity();
    scheduleVideoFocusRestore();
  }

  function toggleBookmarksDrawer(): void {
    const nextOpen = !isBookmarksDrawerOpenRef.current;
    isBookmarksDrawerOpenRef.current = nextOpen;
    setIsBookmarksDrawerOpen(nextOpen);
    noteViewerActivity();

    if (nextOpen) {
      isAdjustmentsDrawerOpenRef.current = false;
      setIsAdjustmentsDrawerOpen(false);
      void refreshBookmarks();
    } else {
      cancelBookmarkRename();
      scheduleVideoFocusRestore();
    }
  }

  function beginBookmarkRename(bookmark: CatalogBookmark): void {
    if (bookmarkActionInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    setEditingBookmarkId(bookmark.id);
    setEditingBookmarkName(bookmark.name ?? '');
    noteViewerActivity();
  }

  async function requestRenameBookmark(bookmark: CatalogBookmark): Promise<void> {
    if (bookmarkActionInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    const nextName = normalizeBookmarkName(editingBookmarkName);
    if (nextName === normalizeBookmarkName(bookmark.name)) {
      cancelBookmarkRename();
      scheduleVideoFocusRestore();
      return;
    }

    bookmarkActionInProgressRef.current = true;
    setBookmarkActionId(bookmark.id);
    setViewerError('');
    noteViewerActivity();

    let didCompleteRename = false;

    try {
      const updatedBookmark = await onUpdateBookmarkName(item.id, bookmark.id, nextName);
      if (updatedBookmark === null) {
        setViewerError('Unable to rename this bookmark. Please try again.');
        return;
      }

      setBookmarks((currentBookmarks) => upsertCatalogBookmark(currentBookmarks, updatedBookmark));
      cancelBookmarkRename();
      didCompleteRename = true;
    } finally {
      if (!hasClosedRef.current) {
        bookmarkActionInProgressRef.current = false;
        setBookmarkActionId(null);
        if (didCompleteRename) {
          scheduleVideoFocusRestore();
        }
      }
    }
  }

  async function requestCreateBookmark(): Promise<void> {
    if (bookmarkCreateInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement || !videoUrl) {
      return;
    }

    const videoCurrentTime = Number.isFinite(videoElement.currentTime)
      ? videoElement.currentTime
      : currentTime;
    const bookmarkTimeSeconds = Math.max(0, Number.isFinite(videoCurrentTime) ? videoCurrentTime : 0);

    bookmarkCreateInProgressRef.current = true;
    setIsCreatingBookmark(true);
    setViewerError('');
    noteViewerActivity();

    try {
      const createdBookmark = await onCreateBookmark(item.id, bookmarkTimeSeconds);
      if (createdBookmark === null) {
        setViewerError('Unable to create a bookmark at the current frame. Please try again.');
        return;
      }

      setBookmarks((currentBookmarks) => upsertCatalogBookmark(currentBookmarks, createdBookmark));
      isBookmarksDrawerOpenRef.current = true;
      setIsBookmarksDrawerOpen(true);
    } finally {
      if (!hasClosedRef.current) {
        bookmarkCreateInProgressRef.current = false;
        setIsCreatingBookmark(false);
        scheduleVideoFocusRestore();
      }
    }
  }

  async function requestUseBookmark(
    bookmark: CatalogBookmark,
    options: { closeDrawer?: boolean } = {}
  ): Promise<void> {
    if (bookmarkActionInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    bookmarkActionInProgressRef.current = true;
    setBookmarkActionId(bookmark.id);
    setViewerError('');
    noteViewerActivity();
    seekVideoTo(bookmark.timeSeconds);
    syncPlaybackTimeFromVideo();
    if (options.closeDrawer !== false) {
      closeBookmarksDrawer();
    }

    try {
      const updatedBookmark = await onUseBookmark(item.id, bookmark.id);
      if (updatedBookmark === null) {
        setViewerError('Unable to update bookmark usage. The jump still succeeded locally.');
        return;
      }

      setBookmarks((currentBookmarks) => upsertCatalogBookmark(currentBookmarks, updatedBookmark));
    } finally {
      if (!hasClosedRef.current) {
        bookmarkActionInProgressRef.current = false;
        setBookmarkActionId(null);
        scheduleVideoFocusRestore();
      }
    }
  }

  async function requestDeleteBookmark(bookmark: CatalogBookmark): Promise<void> {
    if (bookmarkActionInProgressRef.current || closeInProgressRef.current || hasClosedRef.current) {
      return;
    }

    bookmarkActionInProgressRef.current = true;
    setBookmarkActionId(bookmark.id);
    setViewerError('');
    noteViewerActivity();

    try {
      const didDeleteBookmark = await onDeleteBookmark(item.id, bookmark.id);
      if (!didDeleteBookmark) {
        setViewerError('Unable to delete this bookmark. Please try again.');
        return;
      }

      setBookmarks((currentBookmarks) =>
        currentBookmarks.filter((currentBookmark) => currentBookmark.id !== bookmark.id)
      );
    } finally {
      if (!hasClosedRef.current) {
        bookmarkActionInProgressRef.current = false;
        setBookmarkActionId(null);
        scheduleVideoFocusRestore();
      }
    }
  }

  function renderBookmarksDrawer(): JSX.Element {
    return (
      <div
        ref={viewerBookmarksDrawerRef}
        className={`viewer-bookmarks-drawer${isBookmarksDrawerOpen ? ' is-open' : ''}`}
        aria-label="Saved moments"
        aria-hidden={!isBookmarksDrawerOpen}
      >
        <div className="viewer-bookmarks-drawer-header">
          <div>
            <h3>Moments</h3>
            <p>{bookmarks.length === 1 ? '1 saved moment' : `${bookmarks.length} saved moments`}</p>
          </div>
          <button
            type="button"
            className="viewer-bookmarks-drawer-close"
            onClick={closeBookmarksDrawer}
            aria-label="Close moments"
            tabIndex={isBookmarksDrawerOpen ? 0 : -1}
          >
            ×
          </button>
        </div>
        <div className="viewer-bookmarks-drawer-body">
          {isLoadingBookmarks ? (
            <div className="viewer-bookmarks-empty" role="status">
              Loading moments…
            </div>
          ) : bookmarks.length === 0 ? (
            <div className="viewer-bookmarks-empty">
              No moments saved yet. Use Save Moment to capture the current moment.
            </div>
          ) : (
            <div className="viewer-bookmark-list">
              {bookmarks.map((bookmark) => {
                const bookmarkTimeLabel = formatViewerClockTime(bookmark.timeSeconds);
                const bookmarkTitle = getBookmarkDisplayTitle(bookmark);
                const isBookmarkBusy = bookmarkActionId === bookmark.id;
                const isEditingBookmark = editingBookmarkId === bookmark.id;

                return (
                  <div className="viewer-bookmark-entry" key={bookmark.id}>
                    <div className="viewer-bookmark-card">
                      <button
                        type="button"
                        className="viewer-bookmark-thumbnail-button"
                        onClick={() => {
                          void requestUseBookmark(bookmark);
                        }}
                        disabled={isBookmarkBusy}
                        aria-label={`Jump to bookmark at ${bookmarkTimeLabel}`}
                        tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                      >
                        <img
                          className="viewer-bookmark-thumbnail"
                          src={buildBookmarkThumbnailUrl(bookmark)}
                          alt={`Preview for bookmark at ${bookmarkTimeLabel}`}
                        />
                      </button>
                      <span className="viewer-bookmark-meta">
                        {isEditingBookmark ? (
                          <form
                            className="viewer-bookmark-rename-form"
                            onSubmit={(event: FormEvent<HTMLFormElement>) => {
                              event.preventDefault();
                              void requestRenameBookmark(bookmark);
                            }}
                          >
                            <input
                              className="viewer-bookmark-title-input"
                              value={editingBookmarkName}
                              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                                setEditingBookmarkName(event.target.value);
                                noteViewerActivity();
                              }}
                              placeholder={bookmarkTitle}
                              aria-label={`Bookmark name for ${bookmarkTimeLabel}`}
                              disabled={isBookmarkBusy}
                              autoFocus
                              tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                            />
                            <span className="viewer-bookmark-rename-actions">
                              <button
                                type="submit"
                                className="viewer-bookmark-rename-button"
                                disabled={isBookmarkBusy}
                                aria-label={`Save bookmark name for ${bookmarkTimeLabel}`}
                                title="Save name"
                                tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                              >
                                {isBookmarkBusy ? '…' : '✓'}
                              </button>
                              <button
                                type="button"
                                className="viewer-bookmark-rename-button"
                                onClick={() => {
                                  cancelBookmarkRename();
                                  scheduleVideoFocusRestore();
                                }}
                                disabled={isBookmarkBusy}
                                aria-label={`Cancel renaming bookmark at ${bookmarkTimeLabel}`}
                                title="Cancel rename"
                                tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                              >
                                ×
                              </button>
                            </span>
                          </form>
                        ) : (
                          <span className="viewer-bookmark-title-row">
                            <button
                              type="button"
                              className="viewer-bookmark-rename-trigger"
                              onClick={() => {
                                beginBookmarkRename(bookmark);
                              }}
                              disabled={isBookmarkBusy}
                              aria-label={`Rename ${bookmarkTitle}`}
                              title="Rename bookmark"
                              tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                            >
                              <PencilIcon />
                            </button>
                            <button
                              type="button"
                              className="viewer-bookmark-title-button"
                              onClick={() => {
                                void requestUseBookmark(bookmark);
                              }}
                              disabled={isBookmarkBusy}
                              aria-label={`Jump to ${bookmarkTitle} at ${bookmarkTimeLabel}`}
                              title={`Jump to ${bookmarkTimeLabel}`}
                              tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                            >
                              {bookmarkTitle}
                            </button>
                          </span>
                        )}
                        <button
                          type="button"
                          className="viewer-bookmark-subtext-button"
                          onClick={() => {
                            void requestUseBookmark(bookmark);
                          }}
                          disabled={isBookmarkBusy}
                          aria-label={`Jump to bookmark at ${bookmarkTimeLabel}`}
                          tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                        >
                          <span className="viewer-bookmark-time">{bookmarkTimeLabel}</span>
                          <span className="viewer-bookmark-use-count">
                            {formatBookmarkUseCount(bookmark.useCount)}
                          </span>
                        </button>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="viewer-bookmark-delete-button"
                      onClick={() => {
                        void requestDeleteBookmark(bookmark);
                      }}
                      disabled={isBookmarkBusy}
                      aria-label={`Delete bookmark at ${bookmarkTimeLabel}`}
                      title="Delete bookmark"
                      tabIndex={isBookmarksDrawerOpen ? 0 : -1}
                    >
                      {isBookmarkBusy ? '…' : '×'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderViewerAdjustmentsDrawer(): JSX.Element {
    return (
      <div
        id="viewer-adjustments-drawer"
        ref={viewerAdjustmentsDrawerRef}
        className={`viewer-adjustments-drawer${isAdjustmentsDrawerOpen ? ' is-open' : ''}`}
        aria-label="Video visual adjustments"
        aria-hidden={!isAdjustmentsDrawerOpen}
        aria-busy={isSavingViewerVisualAdjustments}
      >
        <div className="viewer-adjustments-drawer-header">
          <h3>Visual Adjustments</h3>
          <button
            type="button"
            className="viewer-adjustments-drawer-close"
            onClick={() => closeAdjustmentsDrawer()}
            aria-label="Close visual adjustments"
            tabIndex={isAdjustmentsDrawerOpen ? 0 : -1}
          >
            ×
          </button>
        </div>
        <div className="viewer-adjustments-drawer-body">
          <label className="viewer-adjustment-control">
            <span className="viewer-adjustment-label-row">
              <span>Contrast</span>
              <strong>{viewerVisualAdjustmentLabels.contrast}</strong>
            </span>
            <input
              type="range"
              className="viewer-adjustment-range"
              min={VIEWER_VISUAL_ADJUSTMENT_MIN}
              max={VIEWER_VISUAL_ADJUSTMENT_MAX}
              step={VIEWER_VISUAL_ADJUSTMENT_STEP}
              value={viewerVisualAdjustments.contrast}
              onChange={(event) => handleViewerVisualAdjustmentChange('contrast', event)}
              onMouseUp={handleViewerVisualAdjustmentInteractionEnd}
              onTouchEnd={handleViewerVisualAdjustmentInteractionEnd}
              onPointerUp={handleViewerVisualAdjustmentInteractionEnd}
              onFocus={noteViewerActivity}
              disabled={videoUrl === null}
              aria-label="Contrast"
              aria-valuetext={`${viewerVisualAdjustmentLabels.contrast} contrast`}
              title={`Contrast ${viewerVisualAdjustmentLabels.contrast}`}
              style={viewerVisualAdjustmentStyles.contrast}
              tabIndex={isAdjustmentsDrawerOpen ? 0 : -1}
            />
          </label>

          <label className="viewer-adjustment-control">
            <span className="viewer-adjustment-label-row">
              <span>Brightness</span>
              <strong>{viewerVisualAdjustmentLabels.brightness}</strong>
            </span>
            <input
              type="range"
              className="viewer-adjustment-range"
              min={VIEWER_VISUAL_ADJUSTMENT_MIN}
              max={VIEWER_VISUAL_ADJUSTMENT_MAX}
              step={VIEWER_VISUAL_ADJUSTMENT_STEP}
              value={viewerVisualAdjustments.brightness}
              onChange={(event) => handleViewerVisualAdjustmentChange('brightness', event)}
              onMouseUp={handleViewerVisualAdjustmentInteractionEnd}
              onTouchEnd={handleViewerVisualAdjustmentInteractionEnd}
              onPointerUp={handleViewerVisualAdjustmentInteractionEnd}
              onFocus={noteViewerActivity}
              disabled={videoUrl === null}
              aria-label="Brightness"
              aria-valuetext={`${viewerVisualAdjustmentLabels.brightness} brightness`}
              title={`Brightness ${viewerVisualAdjustmentLabels.brightness}`}
              style={viewerVisualAdjustmentStyles.brightness}
              tabIndex={isAdjustmentsDrawerOpen ? 0 : -1}
            />
          </label>

          <label className="viewer-adjustment-control">
            <span className="viewer-adjustment-label-row">
              <span>Saturation</span>
              <strong>{viewerVisualAdjustmentLabels.saturation}</strong>
            </span>
            <input
              type="range"
              className="viewer-adjustment-range"
              min={VIEWER_VISUAL_ADJUSTMENT_MIN}
              max={VIEWER_VISUAL_ADJUSTMENT_MAX}
              step={VIEWER_VISUAL_ADJUSTMENT_STEP}
              value={viewerVisualAdjustments.saturation}
              onChange={(event) => handleViewerVisualAdjustmentChange('saturation', event)}
              onMouseUp={handleViewerVisualAdjustmentInteractionEnd}
              onTouchEnd={handleViewerVisualAdjustmentInteractionEnd}
              onPointerUp={handleViewerVisualAdjustmentInteractionEnd}
              onFocus={noteViewerActivity}
              disabled={videoUrl === null}
              aria-label="Saturation"
              aria-valuetext={`${viewerVisualAdjustmentLabels.saturation} saturation`}
              title={`Saturation ${viewerVisualAdjustmentLabels.saturation}`}
              style={viewerVisualAdjustmentStyles.saturation}
              tabIndex={isAdjustmentsDrawerOpen ? 0 : -1}
            />
          </label>

          <div className="viewer-adjustments-actions">
            <button
              type="button"
              className="viewer-adjustment-reset-button"
              onClick={resetViewerVisualAdjustments}
              disabled={videoUrl === null || areViewerVisualAdjustmentsDefault}
              tabIndex={isAdjustmentsDrawerOpen ? 0 : -1}
            >
              Reset
            </button>
          </div>

          <label className="viewer-adjustment-persist-row">
            <input
              type="checkbox"
              checked={viewerVisualAdjustments.enabled}
              onChange={handleViewerVisualAdjustmentsPersistenceChange}
              disabled={videoUrl === null}
              tabIndex={isAdjustmentsDrawerOpen ? 0 : -1}
            />
            <span>Apply these settings every time this video is opened</span>
          </label>
        </div>
      </div>
    );
  }

  useEffect(() => {
    setVideoCandidateIndex(0);
    setViewerError('');
    setFitMode('fit');
    setZoom(1);
    setPan({
      x: 0,
      y: 0
    });
    setIsAttemptingPlayback(false);
    usedActionInProgressRef.current = false;
    thumbnailActionInProgressRef.current = false;
    bookmarkCreateInProgressRef.current = false;
    bookmarkActionInProgressRef.current = false;
    bookmarkCycleIndexRef.current = -1;
    setIsMarkingUsed(false);
    setIsSettingThumbnail(false);
    setBookmarks([]);
    isBookmarksDrawerOpenRef.current = false;
    setIsBookmarksDrawerOpen(false);
    isAdjustmentsDrawerOpenRef.current = false;
    setIsAdjustmentsDrawerOpen(false);
    pendingViewerVisualAdjustmentsRef.current = null;
    isSavingViewerVisualAdjustmentsRef.current = false;
    setIsSavingViewerVisualAdjustments(false);
    viewerVisualAdjustmentsRef.current = getInitialViewerVisualAdjustments(item);
    setViewerVisualAdjustments(viewerVisualAdjustmentsRef.current);
    setIsLoadingBookmarks(false);
    setIsCreatingBookmark(false);
    setBookmarkActionId(null);
    setEditingBookmarkId(null);
    setEditingBookmarkName('');
    setIsVideoPlaying(false);
    setPlaybackRate(1);
    setVolume(VIEWER_DEFAULT_VOLUME);
    setVideoNaturalSize(null);
    setAreControlsVisible(true);
    setCurrentTime(0);
    setDuration(item.probe?.durationSeconds ?? null);
    setIsTimelineScrubbing(false);
    setScrubTime(null);
    resetViewerLoop({
      restoreFocus: false,
      noteActivity: false
    });
    isTimelineScrubbingRef.current = false;
    lastNonZeroVolumeRef.current = VIEWER_MUTED_RESTORE_VOLUME;
    closeInProgressRef.current = false;
    hasClosedRef.current = false;
    clearFocusRestoreFrame();
    stopPlaybackProgressTimer();
    noteViewerActivity();
    scheduleVideoFocusRestore();
    void refreshBookmarks(false);

    return () => {
      clearControlsHideTimer();
      clearFocusRestoreFrame();
      clearLoopEnforcementFrame();
      stopPlaybackProgressTimer();
    };
  }, [item.id, item.probe?.durationSeconds, videoCandidates.join('|')]);

  useEffect(() => {
    const stageElement = viewerStageRef.current;
    if (!stageElement) {
      setViewerStageSize({
        width: 0,
        height: 0
      });
      return;
    }

    const updateStageSize = (): void => {
      const rect = stageElement.getBoundingClientRect();
      const nextWidth = rect.width;
      const nextHeight = rect.height;

      setViewerStageSize((currentValue) => {
        if (currentValue.width === nextWidth && currentValue.height === nextHeight) {
          return currentValue;
        }

        return {
          width: nextWidth,
          height: nextHeight
        };
      });
    };

    updateStageSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateStageSize);
      return () => {
        window.removeEventListener('resize', updateStageSize);
      };
    }

    const observer = new ResizeObserver(() => {
      updateStageSize();
    });

    observer.observe(stageElement);
    return () => {
      observer.disconnect();
    };
  }, [videoUrl]);

  useEffect(() => {
    setPan((currentValue) => {
      const nextX = viewerPanLimit.x > 0 ? clampViewerPanRatio(currentValue.x) : 0;
      const nextY = viewerPanLimit.y > 0 ? clampViewerPanRatio(currentValue.y) : 0;

      if (currentValue.x === nextX && currentValue.y === nextY) {
        return currentValue;
      }

      return {
        x: nextX,
        y: nextY
      };
    });
  }, [viewerPanLimit.x, viewerPanLimit.y]);

  useEffect(() => {
    let previousFullscreenElement = document.fullscreenElement;

    const handleFullscreenChange = (): void => {
      const overlayElement = overlayRef.current;
      const currentFullscreenElement = document.fullscreenElement;
      const viewerWasFullscreen = overlayElement !== null && previousFullscreenElement === overlayElement;
      const viewerIsFullscreen = overlayElement !== null && currentFullscreenElement === overlayElement;

      previousFullscreenElement = currentFullscreenElement;

      if (viewerIsFullscreen || !viewerWasFullscreen) {
        return;
      }

      stopVideoPlaybackForViewerClose();

      if (closeInProgressRef.current || usedActionInProgressRef.current) {
        return;
      }

      finalizeViewerClose();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [item.id]);

  useEffect(() => {
    const activeLoopRange = getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration);

    if (activeLoopRange === null) {
      clearLoopEnforcementFrame();
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    enforceActiveViewerLoop({
      loopAtEnd: false
    });

    if (!videoElement.paused && !videoElement.ended) {
      startLoopEnforcementFrame();
    }
  }, [resolvedDuration, videoUrl, viewerLoopState.endSeconds, viewerLoopState.startSeconds]);

  useEffect(() => {
    const handlePointerUp = (): void => {
      endTimelineScrubbing();
    };

    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [item.id, resolvedDuration]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const safeVolume = clampViewerVolume(volume);

    if (safeVolume > 0) {
      lastNonZeroVolumeRef.current = safeVolume;
    }

    videoElement.volume = safeVolume;
    videoElement.muted = safeVolume <= 0;
  }, [item.id, videoUrl, volume]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !videoUrl) {
      return;
    }

    setViewerError('');
    resetViewerLoop({
      restoreFocus: false,
      noteActivity: false
    });
    videoElement.load();
    syncPlaybackRateFromVideo(videoElement);
    syncPlaybackTimeFromVideo(videoElement);

    if (attemptFullscreenOnOpen && overlayRef.current && document.fullscreenElement === null) {
      void overlayRef.current.requestFullscreen?.().catch(() => {
        // Fullscreen is best-effort only.
      });
    }
  }, [videoUrl, attemptFullscreenOnOpen, item.id]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent): void => {
      const videoElement = videoRef.current;
      if (!videoElement) {
        return;
      }

      noteViewerActivity();

      const target = event.target;
      const isTextEditableTarget =
        target instanceof HTMLElement &&
        (target.closest('textarea, input:not([type="range"]), select') !== null ||
          target.isContentEditable);
      const isInteractiveTarget =
        target instanceof HTMLElement &&
        (target.closest('button, a, input, select, textarea') !== null || target.isContentEditable);
      const isSpaceKey = event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
      const hasShortcutModifier = event.altKey || event.ctrlKey || event.metaKey;
      const isMuteKey = event.key.toLowerCase() === 'm' || event.code === 'KeyM';
      const isUsedKey = event.key.toLowerCase() === 's' || event.code === 'KeyS';
      const isThumbnailKey = event.key.toLowerCase() === 't' || event.code === 'KeyT';
      const isFitModeKey =
        !hasShortcutModifier && (event.key.toLowerCase() === 'f' || event.code === 'KeyF');
      const isDownloadKey =
        !hasShortcutModifier && (event.key.toLowerCase() === 'd' || event.code === 'KeyD');
      const isLoopKey =
        !hasShortcutModifier && (event.key.toLowerCase() === 'l' || event.code === 'KeyL');
      const isAddBookmarkKey =
        !hasShortcutModifier && (event.key.toLowerCase() === 'a' || event.code === 'KeyA');
      const isCycleBookmarksKey =
        !hasShortcutModifier && (event.key.toLowerCase() === 'b' || event.code === 'KeyB');
      const isCloseKey =
        !hasShortcutModifier &&
        (event.key.toLowerCase() === 'c' ||
          event.key.toLowerCase() === 'x' ||
          event.code === 'KeyC' ||
          event.code === 'KeyX');

      if (event.key === 'Escape') {
        claimViewerKeyboardShortcut(event, true);

        if (editingBookmarkId !== null) {
          cancelBookmarkRename();
          scheduleVideoFocusRestore();
          return;
        }

        void requestCloseViewer();
        return;
      }

      if (isSpaceKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          void togglePlayback();
        }
        return;
      }

      if (isMuteKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          toggleVideoMute();
        }
        return;
      }

      if (isUsedKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event, true);
        if (!event.repeat) {
          void requestMarkUsed();
        }
        return;
      }

      if (isThumbnailKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          void requestSetThumbnail();
        }
        return;
      }

      if (isFitModeKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          toggleViewerFitMode();
        }
        return;
      }

      if (isDownloadKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          triggerViewerDownload();
        }
        return;
      }

      if (isLoopKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          handleViewerLoopShortcut();
        }
        return;
      }

      if (isCloseKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          void requestCloseViewer();
        }
        return;
      }

      if (isAddBookmarkKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          void requestCreateBookmark();
        }
        return;
      }

      if (isCycleBookmarksKey && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        if (!event.repeat) {
          cycleBookmarkShortcut();
        }
        return;
      }

      if (isViewerBeginningShortcutKey(event) && !isTextEditableTarget) {
        claimViewerKeyboardShortcut(event);
        jumpToViewerBeginning();
        return;
      }

      if (isInteractiveTarget) {
        return;
      }

      const bookmarkShortcutIndex = getBookmarkShortcutIndexForKey(event);
      if (bookmarkShortcutIndex !== null) {
        claimViewerKeyboardShortcut(event);
        jumpToBookmarkShortcut(bookmarkShortcutIndex);
        return;
      }

      if (event.shiftKey) {
        switch (event.key) {
          case 'ArrowLeft':
            claimViewerKeyboardShortcut(event);
            panViewerBy(-1, 0);
            return;
          case 'ArrowRight':
            claimViewerKeyboardShortcut(event);
            panViewerBy(1, 0);
            return;
          case 'ArrowUp':
            claimViewerKeyboardShortcut(event);
            panViewerBy(0, -1);
            return;
          case 'ArrowDown':
            claimViewerKeyboardShortcut(event);
            panViewerBy(0, 1);
            return;
          default:
            break;
        }
      }

      switch (event.key) {
        case 'ArrowLeft':
          claimViewerKeyboardShortcut(event);
          seekVideoBy(
            videoElement.paused
              ? -getViewerFrameDurationSeconds(item.probe, resolvedDuration)
              : -VIEWER_SEEK_SECONDS
          );
          break;
        case 'ArrowRight':
          claimViewerKeyboardShortcut(event);
          seekVideoBy(
            videoElement.paused
              ? getViewerFrameDurationSeconds(item.probe, resolvedDuration)
              : VIEWER_SEEK_SECONDS
          );
          break;
        case 'ArrowDown':
        case '[':
          claimViewerKeyboardShortcut(event);
          adjustVideoPlaybackRate(-VIEWER_PLAYBACK_RATE_STEP);
          break;
        case 'ArrowUp':
        case ']':
          claimViewerKeyboardShortcut(event);
          adjustVideoPlaybackRate(VIEWER_PLAYBACK_RATE_STEP);
          break;
        case '+':
        case '=':
          claimViewerKeyboardShortcut(event);
          setZoom((currentValue) => changeViewerZoom(currentValue, VIEWER_ZOOM_STEP));
          break;
        case '-':
        case '_':
          claimViewerKeyboardShortcut(event);
          setZoom((currentValue) => changeViewerZoom(currentValue, -VIEWER_ZOOM_STEP));
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeydown, true);
    return () => {
      document.removeEventListener('keydown', handleKeydown, true);
    };
  }, [
    bookmarks,
    editingBookmarkId,
    item.id,
    item.probe?.estimatedFrameCount,
    item.probe?.fps,
    playbackRate,
    resolvedDuration,
    videoUrl,
    volume,
    viewerPanLimit.x,
    viewerPanLimit.y,
    viewerStageSize.height,
    viewerStageSize.width
  ]);

  const handleVideoError = (): void => {
    const videoElement = videoRef.current;
    console.error('viewer.video.error', {
      itemId: item.id,
      storedName: item.storedName,
      videoUrl,
      mediaErrorCode: videoElement?.error?.code ?? null,
      mediaErrorMessage: videoElement?.error?.message ?? null,
      readyState: videoElement?.readyState ?? null,
      networkState: videoElement?.networkState ?? null,
      currentSrc: videoElement?.currentSrc ?? null,
      probe: item.probe
    });

    if (videoCandidateIndex < videoCandidates.length - 1) {
      setVideoCandidateIndex((currentValue) => currentValue + 1);
      return;
    }

    setViewerError(describeVideoElementError(videoRef.current));
  };

  return (
    <div className="viewer-backdrop" role="presentation">
      <div
        className="viewer-shell"
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-label={getCatalogItemDisplayName(item)}
        onMouseMove={noteViewerActivity}
        onMouseDown={noteViewerActivity}
        onPointerDown={noteViewerActivity}
        onTouchStart={noteViewerActivity}
        onWheel={noteViewerActivity}
        onFocusCapture={noteViewerActivity}
        onClickCapture={(event) => {
          maybeRestoreVideoFocusFromInteractionTarget(event.target);
        }}
        onPointerUpCapture={(event) => {
          maybeRestoreVideoFocusFromInteractionTarget(event.target);
        }}
      >
        <div
          ref={viewerHeaderRef}
          className={`viewer-header${areControlsVisible ? '' : ' is-hidden'}`}
        >
          <div className="viewer-metadata">
            <div className="viewer-metadata-line">
              <h2 className="viewer-title-heading" title={getCatalogItemDisplayName(item)}>
                {getCatalogItemDisplayName(item)}
              </h2>
              <span className="viewer-metadata-separator" aria-hidden="true">
                ·
              </span>
              <span className="viewer-metadata-detail">{formatDuration(resolvedDuration)}</span>
              <span className="viewer-metadata-separator" aria-hidden="true">
                ·
              </span>
              <span className="viewer-metadata-detail">{resolutionLabel}</span>
              <span className="viewer-metadata-separator" aria-hidden="true">
                ·
              </span>
                ·
              <span className="viewer-metadata-detail">{formatUsedCount(item.usedCount)}</span>
              <span className="viewer-metadata-separator" aria-hidden="true"></span>
                ·
              <span className="viewer-metadata-detail">{formatViewCount(item.viewCount)}</span>
            </div>
            {viewerError && (
              <p className="viewer-error" role="status" aria-live="polite">
                {viewerError}
              </p>
            )}
          </div>

          <div className="viewer-centered-controls">
            <div className="viewer-toolbar-group viewer-zoom-group">
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-text"
                onClick={toggleViewerFitMode}
                aria-pressed={fitMode === 'fill'}
                title={
                  fitMode === 'fit'
                    ? 'Switch to fill the available viewer area. Shortcut: F.'
                    : 'Switch to fit the entire video in the available viewer area. Shortcut: F.'
                }
              >
                <ViewerShortcutLabel text={fitMode === 'fit' ? 'Fill' : 'Fit'} shortcut="F" />
              </button>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon"
                onClick={() => {
                  noteViewerActivity();
                  setZoom((currentValue) => changeViewerZoom(currentValue, -VIEWER_ZOOM_STEP));
                }}
                disabled={zoom <= VIEWER_MIN_ZOOM}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <MinusIcon />
              </button>
                            <span
                className="viewer-toolbar-indicator"
                role="status"
                aria-live="polite"
                aria-label={`Zoom ${zoomLabel}`}
                title="Current zoom level"
              >
                {zoomLabel}
              </span>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon"
                onClick={() => {
                  noteViewerActivity();
                  setZoom((currentValue) => changeViewerZoom(currentValue, VIEWER_ZOOM_STEP));
                }}
                disabled={zoom >= VIEWER_MAX_ZOOM}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-text"
                onClick={() => {
                  noteViewerActivity();
                  resetViewerZoom();
                }}
                disabled={zoom === 1 && viewerPanOffset.x === 0 && viewerPanOffset.y === 0}
                title="Reset zoom"
              >
                Reset
              </button>
            </div>

            <div className="viewer-toolbar-group viewer-transport-group">
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-transport"
                onClick={() => {
                  noteViewerActivity();
                  seekVideoBy(-VIEWER_SEEK_SECONDS);
                }}
                disabled={!videoUrl}
                aria-label="Seek backward 5 seconds"
                title="Seek backward 5 seconds"
              >
                <SeekBackwardIcon />
              </button>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-primary viewer-toolbar-button-transport"
                onClick={() => {
                  void togglePlayback();
                }}
                disabled={!videoUrl || (isAttemptingPlayback && !isVideoPlaying)}
                aria-label={isVideoPlaying ? 'Pause video' : 'Play video'}
                title={isVideoPlaying ? 'Pause video' : 'Play video'}
              >
                {isVideoPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-transport"
                onClick={() => {
                  noteViewerActivity();
                  seekVideoBy(VIEWER_SEEK_SECONDS);
                }}
                disabled={!videoUrl}
                aria-label="Seek forward 5 seconds"
                title="Seek forward 5 seconds"
              >
                <SeekForwardIcon />
              </button>
            </div>

            <div className="viewer-toolbar-group viewer-speed-group">
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon"
                onClick={() => {
                  noteViewerActivity();
                  adjustVideoPlaybackRate(-VIEWER_PLAYBACK_RATE_STEP);
                }}
                disabled={!videoUrl || playbackRate <= VIEWER_PLAYBACK_RATE_MIN}
                aria-label="Decrease playback speed"
                title="Decrease playback speed"
              >
                <MinusIcon />
              </button>
              <span
                className="viewer-toolbar-indicator"
                role="status"
                aria-live="polite"
                aria-label={`Playback speed ${playbackRateLabel}`}
                title="Current playback speed"
              >
                {playbackRateLabel}
              </span>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon"
                onClick={() => {
                  noteViewerActivity();
                  adjustVideoPlaybackRate(VIEWER_PLAYBACK_RATE_STEP);
                }}
                disabled={!videoUrl || playbackRate >= VIEWER_PLAYBACK_RATE_MAX}
                aria-label="Increase playback speed"
                title="Increase playback speed"
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-text"
                onClick={() => {
                  noteViewerActivity();
                  setVideoPlaybackRate(1);
                }}
                disabled={playbackRate === 1}
                title="Reset playback speed"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="viewer-toolbar-group viewer-utility-actions">
            <button
              type="button"
              className="viewer-toolbar-button viewer-toolbar-button-text"
              onClick={() => {
                noteViewerActivity();
                void requestSetThumbnail();
              }}
              disabled={!videoUrl || isSettingThumbnail}
              title="Set current frame as thumbnail. Shortcut: T"
              aria-label="Set current frame as thumbnail"
            >
              {isSettingThumbnail ? (
                'Saving...'
              ) : (
                <ViewerShortcutLabel text="Thumbnail Set" shortcut="T" />
              )}
            </button>
            <a
              ref={downloadLinkRef}
              className="viewer-toolbar-button viewer-toolbar-button-text"
              href={buildDownloadUrl(item)}
              onClick={noteViewerActivity}
              title="Download video. Shortcut: D"
            >
              <ViewerShortcutLabel text="Download" shortcut="D" />
            </a>
            <button
              type="button"
              className="viewer-toolbar-button viewer-toolbar-button-text viewer-toolbar-button-used"
              onClick={() => {
                noteViewerActivity();
                void requestMarkUsed();
              }}
              disabled={isMarkingUsed}
              title="Mark as used and return to the catalog. Shortcut: S"
            >
              <ViewerShortcutLabel text="Spice! & Close" shortcut="S" />
            </button>
            <button
              type="button"
              className="viewer-toolbar-button viewer-toolbar-button-text viewer-toolbar-button-close"
              onClick={handleCloseViewer}
              title="Close viewer. Shortcuts: C or X"
            >
              <ViewerShortcutLabel text="Close" shortcut="C" />
            </button>
          </div>
        </div>

        <div className="viewer-body">
          {videoUrl ? (
            <div className="viewer-stage" ref={viewerStageRef}>
              <video
                key={videoUrl}
                ref={videoRef}
                className={`viewer-video viewer-video-${fitMode}`}
                src={videoUrl}
                autoPlay
                muted={volume <= 0}
                playsInline
                preload="metadata"
                tabIndex={-1}
                onClick={() => {
                  focusVideoElement();
                  void togglePlayback();
                }}
                onError={handleVideoError}
                onLoadedMetadata={() => {
                  const videoElement = videoRef.current;
                  const naturalWidth = normalizePositiveDimension(videoElement?.videoWidth);
                  const naturalHeight = normalizePositiveDimension(videoElement?.videoHeight);

                  if (naturalWidth !== null && naturalHeight !== null) {
                    setVideoNaturalSize({
                      width: naturalWidth,
                      height: naturalHeight
                    });
                  } else {
                    setVideoNaturalSize(null);
                  }

                  setIsVideoPlaying(videoElement ? !videoElement.paused && !videoElement.ended : false);
                  syncPlaybackRateFromVideo(videoElement);
                  syncPlaybackTimeFromVideo(videoElement);
                  scheduleVideoFocusRestore();
                  console.info('viewer.video.metadata.loaded', {
                    itemId: item.id,
                    videoUrl,
                    duration: videoElement?.duration ?? null,
                    videoWidth: videoElement?.videoWidth ?? null,
                    videoHeight: videoElement?.videoHeight ?? null,
                    readyState: videoElement?.readyState ?? null,
                    networkState: videoElement?.networkState ?? null,
                    currentSrc: videoElement?.currentSrc ?? null
                  });
                }}
                onLoadedData={() => {
                  const videoElement = videoRef.current;
                  if (videoElement?.autoplay && videoElement.paused) {
                    setViewerError((currentValue) =>
                      currentValue === ''
                        ? 'If playback does not start automatically, press Play to start the video.'
                        : currentValue
                    );
                  }
                }}
                onDurationChange={() => {
                  syncPlaybackTimeFromVideo(videoRef.current, {
                    enforceLoop: true,
                    loopAtEnd: false
                  });
                }}
                onTimeUpdate={() => {
                  syncPlaybackTimeFromVideo(videoRef.current, {
                    enforceLoop: true,
                    loopAtEnd: true,
                    endToleranceSeconds: VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS
                  });
                }}
                onSeeking={() => {
                  syncPlaybackTimeFromVideo(videoRef.current, {
                    enforceLoop: true,
                    loopAtEnd: true
                  });
                }}
                onSeeked={() => {
                  syncPlaybackTimeFromVideo(videoRef.current, {
                    enforceLoop: true,
                    loopAtEnd: true
                  });
                }}
                onPlay={() => {
                  setIsVideoPlaying(true);
                  setViewerError('');
                  syncPlaybackTimeFromVideo(videoRef.current, {
                    enforceLoop: true,
                    loopAtEnd: true,
                    endToleranceSeconds: VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS
                  });
                  startPlaybackProgressTimer();
                  if (getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration) !== null) {
                    startLoopEnforcementFrame();
                  }
                }}
                onPause={() => {
                  setIsVideoPlaying(false);
                  syncPlaybackTimeFromVideo(videoRef.current, {
                    enforceLoop: true,
                    loopAtEnd: false
                  });
                  stopPlaybackProgressTimer();
                  clearLoopEnforcementFrame();
                }}
                onEnded={() => {
                  if (getViewerLoopRange(viewerLoopStateRef.current, resolvedDuration) !== null) {
                    setIsVideoPlaying(false);
                    stopPlaybackProgressTimer();
                    clearLoopEnforcementFrame();
                    enforceActiveViewerLoop({
                      loopAtEnd: true,
                      endToleranceSeconds: VIEWER_LOOP_BOUNDARY_EPSILON_SECONDS
                    });
                    void attemptPlayback();
                    return;
                  }

                  setIsVideoPlaying(false);
                  syncPlaybackTimeFromVideo();
                  stopPlaybackProgressTimer();
                  clearLoopEnforcementFrame();
                }}
                onRateChange={() => {
                  syncPlaybackRateFromVideo();
                }}
                style={viewerVideoStyle}
              />
            </div>
          ) : (
            <div className="viewer-placeholder">No playable media URL is available for this item.</div>
          )}
        </div>


        <div
          ref={viewerFooterRef}
          className={`viewer-footer${areControlsVisible ? '' : ' is-hidden'}`}
        >
          <div className="viewer-footer-inner">
            <div className="viewer-left-footer-actions">
              <div className="viewer-bookmark-actions" aria-label="Moment controls">
                <button
                  type="button"
                  className="viewer-bookmark-action-button"
                  onClick={() => {
                    void requestCreateBookmark();
                  }}
                  disabled={!videoUrl || isCreatingBookmark}
                  title="Save moment at the current playback position. Shortcut: A"
                >
                  {isCreatingBookmark ? (
                    'Saving…'
                  ) : (
                    <ViewerShortcutLabel text="Save Moment" shortcut="A" />
                  )}
                </button>
                <span className="viewer-bookmarks-control">
                  {renderBookmarksDrawer()}
                  <button
                    type="button"
                    className="viewer-bookmark-action-button"
                    onClick={toggleBookmarksDrawer}
                    aria-expanded={isBookmarksDrawerOpen}
                    title="Show saved moments"
                  >
                    {isBookmarksDrawerOpen
                      ? 'Hide Moments'
                      : `Moments${bookmarks.length > 0 ? ` (${bookmarks.length})` : ''}`}
                  </button>
                </span>
              </div>
              <div
                className={`viewer-loop-actions${isViewerLoopActive ? ' is-active' : ''}`}
                aria-label="Loop controls"
                title={viewerLoopStatusLabel}
              >
                <button
                  type="button"
                  className="viewer-loop-action-button"
                  onClick={setViewerLoopStartAtCurrentTime}
                  disabled={videoUrl === null}
                  aria-pressed={viewerLoopState.startSeconds !== null}
                  title={
                    viewerLoopState.startSeconds !== null
                      ? `Loop start set at ${viewerLoopStartLabel}`
                      : 'Set loop start at the current playback position. Shortcut: L'
                  }
                >
                  <ViewerShortcutLabel text="Start Loop" shortcut="L" />
                </button>
                <button
                  type="button"
                  className="viewer-loop-action-button"
                  onClick={setViewerLoopEndAtCurrentTime}
                  disabled={videoUrl === null || viewerLoopState.startSeconds === null}
                  aria-pressed={viewerLoopState.endSeconds !== null && isViewerLoopActive}
                  title={
                    viewerLoopState.startSeconds === null
                      ? 'Set a loop start point first'
                      : viewerLoopState.endSeconds !== null && isViewerLoopActive
                        ? `Loop end set at ${viewerLoopEndLabel}`
                        : 'Set loop end at the current playback position. Shortcut: L'
                  }
                >
                  <ViewerShortcutLabel text="End Loop" shortcut="L" />
                </button>
                <button
                  type="button"
                  className="viewer-loop-action-button"
                  onClick={() => resetViewerLoop()}
                  disabled={
                    videoUrl === null ||
                    (viewerLoopState.startSeconds === null && viewerLoopState.endSeconds === null)
                  }
                  title="Clear loop start and loop end. Shortcut: L"
                >
                  <ViewerShortcutLabel text="Reset Loop" shortcut="L" />
                </button>
              </div>
            </div>
            <div className="viewer-timeline-time" aria-label="Current time and total duration">
              {`${formatViewerClockTime(displayedTimelineTime)} / ${formatViewerClockTime(resolvedDuration)}`}
            </div>
            <div className="viewer-timeline-range-wrap">
              {videoUrl !== null && timelineLoopMarkers !== null && (
                <div
                  className={`viewer-timeline-loop-overlay${timelineLoopMarkers.isActive ? ' is-active' : ''}`}
                  aria-hidden="true"
                >
                  {timelineLoopMarkers.rangeStyle !== null && (
                    <span className="viewer-timeline-loop-region" style={timelineLoopMarkers.rangeStyle} />
                  )}
                  <span
                    className="viewer-timeline-loop-marker is-start"
                    style={timelineLoopMarkers.startStyle}
                    title={`Loop start ${timelineLoopMarkers.startLabel}`}
                  />
                  {timelineLoopMarkers.endStyle !== null && timelineLoopMarkers.endLabel !== null && (
                    <span
                      className="viewer-timeline-loop-marker is-end"
                      style={timelineLoopMarkers.endStyle}
                      title={`Loop end ${timelineLoopMarkers.endLabel}`}
                    />
                  )}
                </div>
              )}
              {videoUrl !== null && timelineBookmarkMarkers.length > 0 && (
                <div className="viewer-timeline-bookmarks" role="group" aria-label="Saved moment markers">
                  {timelineBookmarkMarkers.map((marker) => (
                    <button
                      key={marker.bookmark.id}
                      type="button"
                      className={marker.markerClassName}
                      style={marker.markerStyle}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void requestUseBookmark(marker.bookmark, { closeDrawer: false });
                      }}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                      onTouchStart={(event) => {
                        event.stopPropagation();
                      }}
                      onMouseEnter={noteViewerActivity}
                      onFocus={noteViewerActivity}
                      aria-label={marker.markerAriaLabel}
                      title={marker.markerLabel}
                      data-label={marker.markerLabel}
                    />
                  ))}
                </div>
              )}
              <input
                type="range"
                className="viewer-timeline-range"
                min={0}
                max={resolvedDuration !== null && resolvedDuration > 0 ? resolvedDuration : 0}
                step={0.1}
                value={resolvedDuration !== null && resolvedDuration > 0 ? displayedTimelineTime : 0}
                onMouseDown={beginTimelineScrubbing}
                onTouchStart={beginTimelineScrubbing}
                onPointerDown={beginTimelineScrubbing}
                onChange={handleTimelineChange}
                onFocus={noteViewerActivity}
                disabled={videoUrl === null || resolvedDuration === null || resolvedDuration <= 0}
                aria-label="Seek video position"
                aria-valuetext={`${formatViewerClockTime(displayedTimelineTime)} of ${formatViewerClockTime(resolvedDuration)}`}
                style={timelineStyle}
              />
            </div>
            <div className="viewer-timeline-time viewer-timeline-time-end" aria-label="Time remaining">
              {resolvedDuration !== null ? `-${formatViewerClockTime(Math.max(0, resolvedDuration - displayedTimelineTime))}` : '--:--'}
            </div>
            <div className="viewer-volume-group">
              <button
                type="button"
                className="viewer-toolbar-button viewer-toolbar-button-icon viewer-volume-mute-button"
                onClick={() => {
                  noteViewerActivity();
                  toggleVideoMute();
                  scheduleVideoFocusRestore();
                }}
                disabled={videoUrl === null}
                aria-label={volume <= 0 ? 'Unmute video' : 'Mute video'}
                aria-pressed={volume <= 0}
                title={volume <= 0 ? 'Unmute video (M)' : 'Mute video (M)'}
              >
                {volume <= 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
              </button>
              <input
                type="range"
                className="viewer-volume-range"
                min={VIEWER_VOLUME_MIN}
                max={VIEWER_VOLUME_MAX}
                step={VIEWER_VOLUME_STEP}
                value={volume}
                onChange={handleVolumeChange}
                onMouseUp={handleVolumeInteractionEnd}
                onTouchEnd={handleVolumeInteractionEnd}
                onPointerUp={handleVolumeInteractionEnd}
                onFocus={noteViewerActivity}
                disabled={videoUrl === null}
                aria-label="Volume"
                aria-valuetext={`${volumePercent}% volume`}
                title={`Volume ${volumePercent}%`}
                style={volumeStyle}
              />
              <span className="viewer-adjustments-control">
                {renderViewerAdjustmentsDrawer()}
                <button
                  type="button"
                  className="viewer-toolbar-button viewer-toolbar-button-icon viewer-adjustments-button"
                  onClick={toggleAdjustmentsDrawer}
                  disabled={videoUrl === null}
                  aria-label="Adjust video image"
                  aria-expanded={isAdjustmentsDrawerOpen}
                  aria-controls="viewer-adjustments-drawer"
                  title="Adjust contrast, brightness, and saturation"
                >
                  <AdjustmentsIcon />
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getGoogleSearchUrl(query: string): string {
  const trimmedQuery = query.trim();

  if (trimmedQuery === '') {
    return 'https://www.google.com/';
  }

  const searchUrl = new URL('https://www.google.com/search');
  searchUrl.searchParams.set('q', trimmedQuery);
  return searchUrl.toString();
}

function redirectToGoogleSearch(query: string): void {
  window.location.assign(getGoogleSearchUrl(query));
}

export default function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    applyBrowserIdentity(
      authenticated ? AUTHENTICATED_BROWSER_IDENTITY : GOOGLE_LOCK_BROWSER_IDENTITY
    );
  }, [authenticated]);

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [homeStrips, setHomeStrips] = useState<CatalogHomeStrip[]>([]);
  const [homeStripRandomSeed, setHomeStripRandomSeed] = useState(() => createCatalogRandomSeed());
  const [draggedHomeStripId, setDraggedHomeStripId] = useState<string | null>(null);
  const [homeStripDropTarget, setHomeStripDropTarget] = useState<HomeStripDropTarget | null>(null);
  const [pendingIngests, setPendingIngests] = useState<PendingIngest[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityFeedEntry[]>([]);
  const [idleLockMinutes, setIdleLockMinutes] = useState(30);
  const [toolAvailability, setToolAvailability] = useState<ToolAvailability>(
    DEFAULT_TOOL_AVAILABILITY
  );
  const [storageUsage, setStorageUsage] = useState<StorageUsageInfo | null>(null);
  const [toolUpdateState, setToolUpdateState] = useState<ToolUpdateUiState>({
    status: 'idle',
    message: DEFAULT_TOOL_UPDATE_MESSAGE,
    result: null
  });
  const [socketConnectionState, setSocketConnectionState] = useState<SocketConnectionState>('disconnected');
  const [addVideoMode, setAddVideoMode] = useState<CatalogItemSourceType>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [importUrl, setImportUrl] = useState('');
  const [pendingIngest, setPendingIngest] = useState<PendingIngest | null>(null);
  const [duplicateVisibleName, setDuplicateVisibleName] = useState('');
  const [addVideoNotice, setAddVideoNotice] = useState<ModalNotice | null>(null);
  const [isAddVideoBusy, setIsAddVideoBusy] = useState(false);
  const [isAddVideoModalOpen, setIsAddVideoModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [viewerItem, setViewerItem] = useState<CatalogItem | null>(null);
  const [detailsItemId, setDetailsItemId] = useState<string | null>(null);
  const [attemptFullscreenOnOpen, setAttemptFullscreenOnOpen] = useState(true);
  const [visibleTagListSettings, setVisibleTagListSettings] = useState<VisibleTagListSettings>(() =>
    readStoredVisibleTagListSettings()
  );
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(true);
  const [filters, setFilters] = useState<CatalogFilters>(() => readStoredCatalogFilters());
  const [isAdHocCatalogSortActive, setIsAdHocCatalogSortActive] = useState(false);
  const [tagFilterSuggestions, setTagFilterSuggestions] = useState<CatalogTag[]>([]);
  const [isTagFilterSearchFocused, setIsTagFilterSearchFocused] = useState(false);
  const [homeStripEditor, setHomeStripEditor] = useState<HomeStripEditorState | null>(null);
  const [homeStripTagSuggestions, setHomeStripTagSuggestions] = useState<CatalogTag[]>([]);
  const [isHomeStripTagSearchFocused, setIsHomeStripTagSearchFocused] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const socketCommandIdRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const lastInteractionRef = useRef<number>(Date.now());
  const isAddVideoModalOpenRef = useRef(false);
  const viewerCloseRequestedRef = useRef(false);

  const duplicateReasonCodes = pendingIngest
    ? getDistinctDuplicateReasonCodes(pendingIngest.duplicateCheck)
    : [];
  const pendingIngestHasDuplicateConflicts = pendingIngest?.duplicateCheck.hasConflicts === true;
  const isAnyModalOpen =
    isAddVideoModalOpen ||
    isSettingsModalOpen ||
    viewerItem !== null ||
    detailsItemId !== null ||
    homeStripEditor !== null;
  const isToolUpdateRunning = toolUpdateState.status === 'running';

  const filteredCatalog = useMemo(() => {
    const nextItems = filterCatalogItemsByCriteria(
      catalog,
      filters.search,
      filters.selectedTagIds,
      filters.excludedTagIds
    );
    return sortCatalogItems(nextItems, filters.sortCategory, filters.sortDirection, filters.randomSeed);
  }, [
    catalog,
    filters.randomSeed,
    filters.search,
    filters.selectedTagIds,
    filters.excludedTagIds,
    filters.sortCategory,
    filters.sortDirection
  ]);

  const homeStripViews = useMemo<CatalogHomeStripView[]>(
    () =>
      homeStrips.map((strip) => ({
        strip,
        items: getCatalogHomeStripItems(strip, catalog, homeStripRandomSeed)
      })),
    [catalog, homeStripRandomSeed, homeStrips]
  );

  const availableTagOptions = useMemo(() => {
    const tagsById = new Map<string, CatalogTag>();

    for (const item of catalog) {
      for (const tag of item.tags) {
        const existingTag = tagsById.get(tag.id);
        if (!existingTag || tag.usageCount > existingTag.usageCount) {
          tagsById.set(tag.id, tag);
        }
      }
    }

    return Array.from(tagsById.values()).sort(compareCatalogTagsForOptions);
  }, [catalog]);

  const popularTagOptions = useMemo(() => {
    if (visibleTagListSettings.mode === 'unlimited') {
      return availableTagOptions;
    }

    return availableTagOptions.slice(0, visibleTagListSettings.limit);
  }, [availableTagOptions, visibleTagListSettings.limit, visibleTagListSettings.mode]);

  const catalogTagById = useMemo(() => {
    const tagsById = new Map<string, CatalogTag>();

    for (const tag of availableTagOptions) {
      tagsById.set(tag.id, tag);
    }

    for (const tag of tagFilterSuggestions) {
      tagsById.set(tag.id, tag);
    }

    for (const tag of homeStripTagSuggestions) {
      tagsById.set(tag.id, tag);
    }

    return tagsById;
  }, [availableTagOptions, homeStripTagSuggestions, tagFilterSuggestions]);

  const selectedFilterTags = filters.selectedTagIds
    .map((tagId) => catalogTagById.get(tagId))
    .filter((tag): tag is CatalogTag => tag !== undefined);
  const excludedFilterTags = filters.excludedTagIds
    .map((tagId) => catalogTagById.get(tagId))
    .filter((tag): tag is CatalogTag => tag !== undefined);
  const activeTagFilterCount = filters.selectedTagIds.length + filters.excludedTagIds.length;

  const activeTagOptions: CatalogTag[] = [];
  const activeTagOptionIds = new Set<string>();
  for (const tag of [...selectedFilterTags, ...excludedFilterTags]) {
    if (!activeTagOptionIds.has(tag.id)) {
      activeTagOptions.push(tag);
      activeTagOptionIds.add(tag.id);
    }
  }
  const popularTagOptionIds = new Set(popularTagOptions.map((tag) => tag.id));
  const visibleTagOptions = [
    ...activeTagOptions,
    ...popularTagOptions.filter((tag) => !activeTagOptionIds.has(tag.id))
  ];
  const hiddenTagOptionCount = availableTagOptions.length - popularTagOptions.length;
  const activeTagOptionsBeyondLimitCount = activeTagOptions.filter(
    (tag) => !popularTagOptionIds.has(tag.id)
  ).length;
  const tagListLimitNote =
    hiddenTagOptionCount > 0
      ? `Showing top ${popularTagOptions.length} of ${availableTagOptions.length} tags${
          activeTagOptionsBeyondLimitCount > 0
            ? `, plus ${activeTagOptionsBeyondLimitCount} active ${
                activeTagOptionsBeyondLimitCount === 1 ? 'tag' : 'tags'
              }`
            : ''
        }. Adjust the tag list limit in Settings.`
      : null;

  const visibleTagFilterSuggestions = tagFilterSuggestions.filter(
    (tag) => !filters.selectedTagIds.includes(tag.id) && !filters.excludedTagIds.includes(tag.id)
  );
  const homeStripDraftSelectedTags = homeStripEditor
    ? homeStripEditor.draft.selectedTagIds
        .map((tagId) => catalogTagById.get(tagId))
        .filter((tag): tag is CatalogTag => tag !== undefined)
    : [];
  const homeStripDraftExcludedTags = homeStripEditor
    ? homeStripEditor.draft.excludedTagIds
        .map((tagId) => catalogTagById.get(tagId))
        .filter((tag): tag is CatalogTag => tag !== undefined)
    : [];
  const homeStripDraftActiveTagCount = homeStripEditor
    ? homeStripEditor.draft.selectedTagIds.length + homeStripEditor.draft.excludedTagIds.length
    : 0;
  const visibleHomeStripTagSuggestions = homeStripEditor
    ? homeStripTagSuggestions.filter(
        (tag) =>
          !homeStripEditor.draft.selectedTagIds.includes(tag.id) &&
          !homeStripEditor.draft.excludedTagIds.includes(tag.id)
      )
    : [];
  const homeStripEditorAvailableTagOptions = homeStripEditor ? popularTagOptions : [];
  const isRandomSortActive = filters.sortCategory === 'random';

  const detailsItem = useMemo(
    () => catalog.find((candidate) => candidate.id === detailsItemId) ?? null,
    [catalog, detailsItemId]
  );

  const isAnyCatalogFilterActive =
    filters.search.trim() !== '' ||
    filters.tagSearch.trim() !== '' ||
    filters.selectedTagIds.length > 0 ||
    filters.excludedTagIds.length > 0 ||
    isAdHocCatalogSortActive;
  const isHomeViewActive = !isAnyCatalogFilterActive;
  const catalogCountLabel = `${filteredCatalog.length} ${filteredCatalog.length === 1 ? 'item' : 'items'} shown`;
  const storageUsageSummary = storageUsage ? formatStorageUsageSummary(storageUsage) : null;
  const addVideoPrimaryMessage = addVideoMode === 'upload' ? DEFAULT_UPLOAD_MESSAGE : DEFAULT_IMPORT_MESSAGE;

  function clearCatalogFilters(): void {
    setFilters(getDefaultCatalogFilters());
    setTagFilterSuggestions([]);
    setIsAdHocCatalogSortActive(false);
  }

  function applyTagFilter(tag: CatalogTag, mode: TagFilterMode): void {
    setFilters((currentValue) => {
      const selectedTagIds = currentValue.selectedTagIds.filter((selectedTagId) => selectedTagId !== tag.id);
      const excludedTagIds = currentValue.excludedTagIds.filter((excludedTagId) => excludedTagId !== tag.id);

      if (mode === 'include') {
        selectedTagIds.push(tag.id);
      } else {
        excludedTagIds.push(tag.id);
      }

      return {
        ...currentValue,
        tagSearch: '',
        selectedTagIds: Array.from(new Set(selectedTagIds)),
        excludedTagIds: Array.from(new Set(excludedTagIds))
      };
    });
    setTagFilterSuggestions([]);
  }

  function toggleTagFilter(tag: CatalogTag, mode: TagFilterMode): void {
    setFilters((currentValue) => {
      const isActive =
        mode === 'include'
          ? currentValue.selectedTagIds.includes(tag.id)
          : currentValue.excludedTagIds.includes(tag.id);
      const selectedTagIds = currentValue.selectedTagIds.filter((selectedTagId) => selectedTagId !== tag.id);
      const excludedTagIds = currentValue.excludedTagIds.filter((excludedTagId) => excludedTagId !== tag.id);

      if (!isActive) {
        if (mode === 'include') {
          selectedTagIds.push(tag.id);
        } else {
          excludedTagIds.push(tag.id);
        }
      }

      return {
        ...currentValue,
        tagSearch: '',
        selectedTagIds: Array.from(new Set(selectedTagIds)),
        excludedTagIds: Array.from(new Set(excludedTagIds))
      };
    });
    setTagFilterSuggestions([]);
  }

  function removeTagFilter(tagId: string): void {
    setFilters((currentValue) => ({
      ...currentValue,
      selectedTagIds: currentValue.selectedTagIds.filter((selectedTagId) => selectedTagId !== tagId),
      excludedTagIds: currentValue.excludedTagIds.filter((excludedTagId) => excludedTagId !== tagId)
    }));
  }

  function reshuffleCatalogSort(): void {
    setIsAdHocCatalogSortActive(true);
    setFilters((currentValue) => ({
      ...currentValue,
      sortCategory: 'random',
      randomSeed: createNextCatalogRandomSeed(currentValue.randomSeed)
    }));
  }

  function createHomeStripDraftFromCurrentFilters(): HomeStripDraft {
    const normalizedSearch = normalizeHomeStripText(filters.search);
    let name = 'Latest Items';

    if (normalizedSearch !== '') {
      name = `Search: ${normalizedSearch.slice(0, 64)}`;
    } else if (selectedFilterTags.length === 1 && excludedFilterTags.length === 0) {
      name = `${selectedFilterTags[0].label} Clips`;
    } else if (selectedFilterTags.length === 0 && excludedFilterTags.length === 1) {
      name = `Without ${excludedFilterTags[0].label}`;
    } else if (activeTagFilterCount > 1) {
      const firstTagLabel = selectedFilterTags[0]?.label ?? `Without ${excludedFilterTags[0]?.label ?? 'tag'}`;
      name = `${firstTagLabel} + ${activeTagFilterCount - 1} tags`;
    } else if (filters.sortCategory !== 'uploadedAt' || filters.sortDirection !== 'desc') {
      name = `${CATALOG_SORT_CATEGORY_LABELS[filters.sortCategory]} ${
        filters.sortDirection === 'asc' ? 'Ascending' : 'Descending'
      }`;
    }

    return {
      name,
      rowCount: 1,
      search: normalizedSearch,
      sortCategory: filters.sortCategory,
      sortDirection: filters.sortDirection,
      tagSearch: '',
      selectedTagIds: [...filters.selectedTagIds],
      excludedTagIds: [...filters.excludedTagIds]
    };
  }

  function createHomeStripDraftFromStrip(strip: CatalogHomeStrip): HomeStripDraft {
    return {
      name: strip.name,
      rowCount: strip.rowCount,
      search: strip.search ?? '',
      sortCategory: strip.sortCategory,
      sortDirection: strip.sortDirection,
      tagSearch: '',
      selectedTagIds: [...strip.tagIds],
      excludedTagIds: [...strip.excludedTagIds]
    };
  }

  function openCreateHomeStripFromFilters(): void {
    setHomeStripEditor({
      mode: 'add',
      stripId: null,
      draft: createHomeStripDraftFromCurrentFilters(),
      notice: null,
      saving: false
    });
    setHomeStripTagSuggestions([]);
    setIsHomeStripTagSearchFocused(false);
  }

  function openEditHomeStrip(strip: CatalogHomeStrip): void {
    setHomeStripEditor({
      mode: 'edit',
      stripId: strip.id,
      draft: createHomeStripDraftFromStrip(strip),
      notice: null,
      saving: false
    });
    setHomeStripTagSuggestions([]);
    setIsHomeStripTagSearchFocused(false);
  }

  function updateHomeStripDraft(updater: (draft: HomeStripDraft) => HomeStripDraft): void {
    setHomeStripEditor((currentValue) =>
      currentValue
        ? {
            ...currentValue,
            draft: updater(currentValue.draft),
            notice: null
          }
        : currentValue
    );
  }

  function createHomeStripRequestBody(draft: HomeStripDraft): {
    name: string;
    rowCount: CatalogHomeStripRowCount;
    sortCategory: CatalogSortCategory;
    sortDirection: CatalogSortDirection;
    search: string | null;
    tagIds: string[];
    excludedTagIds: string[];
  } {
    const normalizedName = normalizeHomeStripText(draft.name);
    const normalizedSearch = normalizeHomeStripText(draft.search);

    return {
      name: normalizedName,
      rowCount: draft.rowCount,
      sortCategory: draft.sortCategory,
      sortDirection: draft.sortDirection,
      search: normalizedSearch === '' ? null : normalizedSearch,
      tagIds: Array.from(new Set(draft.selectedTagIds)),
      excludedTagIds: Array.from(new Set(draft.excludedTagIds))
    };
  }

  function setHomeStripEditorNotice(tone: NoticeTone, text: string): void {
    setHomeStripEditor((currentValue) =>
      currentValue
        ? {
            ...currentValue,
            notice: { tone, text },
            saving: false
          }
        : currentValue
    );
  }

  function applyHomeStripsPayload(payload: unknown): boolean {
    const strips = parseCatalogHomeStripsPayload(payload);
    if (!strips) {
      return false;
    }

    applyLoadedHomeStrips(strips);
    return true;
  }

  async function saveHomeStripEditor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const editor = homeStripEditor;
    if (!editor) {
      return;
    }

    const requestBody = createHomeStripRequestBody(editor.draft);
    if (requestBody.name === '') {
      setHomeStripEditorNotice('error', 'Enter a section title.');
      return;
    }

    setHomeStripEditor((currentValue) =>
      currentValue
        ? {
            ...currentValue,
            draft: {
              ...currentValue.draft,
              name: requestBody.name,
              search: requestBody.search ?? ''
            },
            notice: null,
            saving: true
          }
        : currentValue
    );

    const isEdit = editor.mode === 'edit' && editor.stripId !== null;
    const endpoint = isEdit
      ? `/api/home-strips/${encodeURIComponent(editor.stripId as string)}`
      : '/api/home-strips';

    try {
      const response = await fetch(endpoint, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return;
      }

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        setHomeStripEditorNotice('error', message ?? 'Unable to save this home section.');
        return;
      }

      if (!applyHomeStripsPayload(payload)) {
        await loadHomeStrips();
      }

      setHomeStripEditor(null);
      setHomeStripTagSuggestions([]);
      setIsHomeStripTagSearchFocused(false);
    } catch (error) {
      setHomeStripEditorNotice(
        'error',
        error instanceof Error ? error.message : 'Unable to save this home section.'
      );
    }
  }

  async function deleteHomeStrip(strip: CatalogHomeStrip): Promise<void> {
    const confirmed = window.confirm(`Delete the "${strip.name}" home section?`);
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/home-strips/${encodeURIComponent(strip.id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return;
      }

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('home-strip.delete.failed', {
          stripId: strip.id,
          status: response.status,
          message
        });
        return;
      }

      if (!applyHomeStripsPayload(payload)) {
        setHomeStrips((currentValue) => currentValue.filter((candidate) => candidate.id !== strip.id));
      }

      setHomeStripEditor((currentValue) =>
        currentValue?.stripId === strip.id ? null : currentValue
      );
    } catch (error) {
      console.warn('home-strip.delete.failed', {
        stripId: strip.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function saveHomeStripOrder(
    nextStrips: CatalogHomeStrip[],
    previousStrips: CatalogHomeStrip[],
    failureContext: Record<string, unknown>
  ): Promise<void> {
    const optimisticStrips = nextStrips.map((strip, index) => ({
      ...strip,
      displayOrder: index
    }));
    setHomeStrips(optimisticStrips);

    try {
      const response = await fetch('/api/home-strips/reorder', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ stripIds: optimisticStrips.map((strip) => strip.id) })
      });

      if (response.status === 401) {
        setHomeStrips(previousStrips);
        resetAuthenticatedState();
        return;
      }

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        throw new Error(isRecord(payload) ? readString(payload.message) ?? 'Unable to reorder home sections.' : 'Unable to reorder home sections.');
      }

      if (!applyHomeStripsPayload(payload)) {
        await loadHomeStrips();
      }
    } catch (error) {
      setHomeStrips(previousStrips);
      console.warn('home-strip.reorder.failed', {
        ...failureContext,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function moveHomeStrip(stripId: string, direction: HomeStripMoveDirection): Promise<void> {
    const currentIndex = homeStrips.findIndex((candidate) => candidate.id === stripId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= homeStrips.length) {
      return;
    }

    const nextStrips = [...homeStrips];
    const [movedStrip] = nextStrips.splice(currentIndex, 1);
    nextStrips.splice(targetIndex, 0, movedStrip);

    await saveHomeStripOrder(nextStrips, homeStrips, {
      action: 'move',
      stripId,
      direction
    });
  }

  async function reorderHomeStripRelative(
    sourceStripId: string,
    targetStripId: string,
    position: HomeStripDropPosition
  ): Promise<void> {
    if (sourceStripId === targetStripId) {
      return;
    }

    const sourceStrip = homeStrips.find((strip) => strip.id === sourceStripId);
    if (!sourceStrip) {
      return;
    }

    const remainingStrips = homeStrips.filter((strip) => strip.id !== sourceStripId);
    const targetIndex = remainingStrips.findIndex((strip) => strip.id === targetStripId);
    if (targetIndex < 0) {
      return;
    }

    const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    const nextStrips = [...remainingStrips];
    nextStrips.splice(insertionIndex, 0, sourceStrip);

    await saveHomeStripOrder(nextStrips, homeStrips, {
      action: 'drag-reorder',
      sourceStripId,
      targetStripId,
      position
    });
  }

  function getHomeStripDropPosition(event: ReactDragEvent<HTMLElement>): HomeStripDropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
  }

  function clearHomeStripDragState(): void {
    setDraggedHomeStripId(null);
    setHomeStripDropTarget(null);
  }

  function handleHomeStripDragStart(stripId: string, event: ReactDragEvent<HTMLElement>): void {
    if (!isFilterDrawerOpen || homeStrips.length < 2) {
      event.preventDefault();
      return;
    }

    setDraggedHomeStripId(stripId);
    setHomeStripDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', stripId);
  }

  function handleHomeStripDragOver(targetStripId: string, event: ReactDragEvent<HTMLElement>): void {
    const sourceStripId = draggedHomeStripId || event.dataTransfer.getData('text/plain');
    if (!isFilterDrawerOpen || sourceStripId === '' || sourceStripId === targetStripId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = getHomeStripDropPosition(event);
    setHomeStripDropTarget((currentValue) =>
      currentValue?.stripId === targetStripId && currentValue.position === position
        ? currentValue
        : { stripId: targetStripId, position }
    );
  }

  function handleHomeStripDragLeave(stripId: string, event: ReactDragEvent<HTMLElement>): void {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setHomeStripDropTarget((currentValue) =>
      currentValue?.stripId === stripId ? null : currentValue
    );
  }

  function handleHomeStripDrop(targetStripId: string, event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault();

    const sourceStripId = draggedHomeStripId || event.dataTransfer.getData('text/plain');
    const position = getHomeStripDropPosition(event);
    clearHomeStripDragState();

    if (!isFilterDrawerOpen || sourceStripId === '' || sourceStripId === targetStripId) {
      return;
    }

    void reorderHomeStripRelative(sourceStripId, targetStripId, position);
  }

  function addHomeStripDraftTag(tag: CatalogTag, mode: TagFilterMode): void {
    updateHomeStripDraft((draft) => {
      const selectedTagIds = draft.selectedTagIds.filter((selectedTagId) => selectedTagId !== tag.id);
      const excludedTagIds = draft.excludedTagIds.filter((excludedTagId) => excludedTagId !== tag.id);

      if (mode === 'include') {
        selectedTagIds.push(tag.id);
      } else {
        excludedTagIds.push(tag.id);
      }

      return {
        ...draft,
        tagSearch: '',
        selectedTagIds: Array.from(new Set(selectedTagIds)),
        excludedTagIds: Array.from(new Set(excludedTagIds))
      };
    });
    setHomeStripTagSuggestions([]);
  }

  function toggleHomeStripDraftTag(tag: CatalogTag, mode: TagFilterMode): void {
    updateHomeStripDraft((draft) => {
      const isActive =
        mode === 'include' ? draft.selectedTagIds.includes(tag.id) : draft.excludedTagIds.includes(tag.id);
      const selectedTagIds = draft.selectedTagIds.filter((selectedTagId) => selectedTagId !== tag.id);
      const excludedTagIds = draft.excludedTagIds.filter((excludedTagId) => excludedTagId !== tag.id);

      if (!isActive) {
        if (mode === 'include') {
          selectedTagIds.push(tag.id);
        } else {
          excludedTagIds.push(tag.id);
        }
      }

      return {
        ...draft,
        tagSearch: '',
        selectedTagIds: Array.from(new Set(selectedTagIds)),
        excludedTagIds: Array.from(new Set(excludedTagIds))
      };
    });
    setHomeStripTagSuggestions([]);
  }

  function removeHomeStripDraftTag(tagId: string): void {
    updateHomeStripDraft((draft) => ({
      ...draft,
      selectedTagIds: draft.selectedTagIds.filter((selectedTagId) => selectedTagId !== tagId),
      excludedTagIds: draft.excludedTagIds.filter((excludedTagId) => excludedTagId !== tagId)
    }));
  }

  function applyCurrentFiltersToHomeStripDraft(): void {
    updateHomeStripDraft((draft) => ({
      ...draft,
      search: normalizeHomeStripText(filters.search),
      sortCategory: filters.sortCategory,
      sortDirection: filters.sortDirection,
      tagSearch: '',
      selectedTagIds: [...filters.selectedTagIds],
      excludedTagIds: [...filters.excludedTagIds]
    }));
    setHomeStripTagSuggestions([]);
  }

  const activePipelineItems = useMemo<ActivityPanelItem[]>(() => {
    const pendingItems = pendingIngests
      .filter((candidate) => candidate.processing !== null)
      .map((candidate) => ({
        key: `pending-${candidate.id}`,
        title: getPendingIngestDisplayName(candidate),
        sourceType: candidate.sourceType,
        status: 'pending' as const,
        processing: candidate.processing as ProcessingSnapshot,
        pendingIngest: candidate,
        itemId: null
      }));

    const catalogItems = catalog
      .filter((candidate) => candidate.processing !== null && candidate.status !== 'ready')
      .map((candidate) => ({
        key: `item-${candidate.id}`,
        title: getCatalogItemDisplayName(candidate),
        sourceType: candidate.sourceType,
        status: candidate.status,
        processing: candidate.processing as ProcessingSnapshot,
        pendingIngest: null,
        itemId: candidate.id
      }));

    return [...pendingItems, ...catalogItems].sort((left, right) =>
      new Date(right.processing.updatedAt).getTime() - new Date(left.processing.updatedAt).getTime()
    );
  }, [catalog, pendingIngests]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        VISIBLE_TAG_LIST_SETTINGS_STORAGE_KEY,
        JSON.stringify(visibleTagListSettings)
      );
    } catch {
      // Ignore storage failures, such as private browsing or disabled local storage.
    }
  }, [visibleTagListSettings]);

  useEffect(() => {
    try {
      window.localStorage.removeItem(CATALOG_FILTERS_STORAGE_KEY);
    } catch {
      // Ignore storage failures, such as private browsing or disabled local storage.
    }
  }, []);

  useEffect(() => {
    if (!authenticated) {
      setTagFilterSuggestions([]);
      return undefined;
    }

    const query = filters.tagSearch.trim();
    if (query === '') {
      setTagFilterSuggestions([]);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchTagSuggestions(query, 10).then((tags) => {
        if (!cancelled) {
          setTagFilterSuggestions(tags);
        }
      });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authenticated, filters.tagSearch]);

  useEffect(() => {
    if (!authenticated || !homeStripEditor) {
      setHomeStripTagSuggestions([]);
      return undefined;
    }

    const query = homeStripEditor.draft.tagSearch.trim();
    if (query === '') {
      setHomeStripTagSuggestions([]);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchTagSuggestions(query, 10).then((tags) => {
        if (!cancelled) {
          setHomeStripTagSuggestions(tags);
        }
      });
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authenticated, homeStripEditor?.draft.tagSearch]);

  function resetUploadSelection(): void {
    setSelectedFile(null);
    setUploadInputKey((currentValue) => currentValue + 1);
  }

  function resetAddVideoState(): void {
    resetUploadSelection();
    setImportUrl('');
    setPendingIngest(null);
    setDuplicateVisibleName('');
    setAddVideoNotice(null);
    setIsAddVideoBusy(false);
    setAddVideoMode((currentMode) => {
      if (currentMode === 'yt_dlp' && !toolAvailability.ytDlp) {
        return 'upload';
      }
      return currentMode;
    });
  }

  function clearReconnectTimer(): void {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function closeActiveSocket(): void {
    clearReconnectTimer();
    if (socketRef.current) {
      const socket = socketRef.current;
      socketRef.current = null;
      shouldReconnectRef.current = false;
      try {
        socket.close();
      } catch {
        // Ignore socket close failures during teardown.
      }
    }
  }

  function resetAuthenticatedState(): void {
    closeActiveSocket();
    setAuthenticated(false);
    setCatalog([]);
    setHomeStrips([]);
    setHomeStripRandomSeed(createCatalogRandomSeed());
    setPendingIngests([]);
    setRecentActivity([]);
    setFilters(getDefaultCatalogFilters());
    setIsAdHocCatalogSortActive(false);
    setTagFilterSuggestions([]);
    setIsTagFilterSearchFocused(false);
    setHomeStripEditor(null);
    setHomeStripTagSuggestions([]);
    setIsHomeStripTagSearchFocused(false);
    setToolAvailability(DEFAULT_TOOL_AVAILABILITY);
    setStorageUsage(null);
    setSocketConnectionState('disconnected');
    setIsAddVideoModalOpen(false);
    setIsSettingsModalOpen(false);
    setViewerItem(null);
    setDetailsItemId(null);
    setToolUpdateState({
      status: 'idle',
      message: DEFAULT_TOOL_UPDATE_MESSAGE,
      result: null
    });
    resetAddVideoState();
  }

  function openAddVideoModal(): void {
    setIsAddVideoModalOpen(true);
    setAddVideoNotice(null);
    if (!toolAvailability.ytDlp && addVideoMode === 'yt_dlp') {
      setAddVideoMode('upload');
    }
  }

  function openPendingIngestForResolution(activePendingIngest: PendingIngest): void {
    const hasDuplicateConflicts = activePendingIngest.duplicateCheck.hasConflicts;

    setPendingIngest(activePendingIngest);
    setDuplicateVisibleName(activePendingIngest.visibleName);
    setAddVideoMode(activePendingIngest.sourceType);
    setAddVideoNotice({
      tone: hasDuplicateConflicts ? 'warning' : 'info',
      text: hasDuplicateConflicts
        ? 'Duplicate validation is waiting for your decision.'
        : 'Confirm or edit the catalog title before finalizing this item.'
    });
    setIsAddVideoModalOpen(true);
  }

  function handleOpenViewer(item: CatalogItem): void {
    viewerCloseRequestedRef.current = false;
    setViewerItem(item);
    void incrementCatalogItemViewCount(item.id);
  }

  function handleOpenDetails(item: CatalogItem): void {
    setDetailsItemId(item.id);
  }

  async function closeAddVideoModal(): Promise<void> {
    if (isAddVideoBusy) {
      return;
    }

    if (pendingIngest) {
      setIsAddVideoBusy(true);
      const response = await resolveDuplicateRequest(pendingIngest, 'cancel', duplicateVisibleName);
      setIsAddVideoBusy(false);

      if (response.kind === 'error') {
        setAddVideoNotice({
          tone: 'error',
          text: `Unable to close the dialog cleanly: ${response.message}`
        });
        return;
      }
    }

    resetAddVideoState();
    setIsAddVideoModalOpen(false);
  }

  function closeSettingsModal(): void {
    setIsSettingsModalOpen(false);
  }

  function requestCatalogList(): void {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      sendStructuredSocketCommand('state.sync');
    }
  }

  function sendStructuredSocketCommand(name: string, payload?: unknown): void {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      return;
    }

    socketCommandIdRef.current += 1;
    socketRef.current.send(
      JSON.stringify({
        id: `cmd-${Date.now()}-${socketCommandIdRef.current}`,
        type: 'cmd',
        name,
        ...(payload === undefined ? {} : { payload })
      })
    );
  }

  function refreshHomeStripRandomSeed(): void {
    setHomeStripRandomSeed((currentSeed) => createNextCatalogRandomSeed(currentSeed));
  }

  function applyLoadedCatalogItems(items: CatalogItem[]): void {
    setCatalog(items);
    refreshHomeStripRandomSeed();
  }

  function applyLoadedHomeStrips(strips: CatalogHomeStrip[]): void {
    setHomeStrips(strips);
    refreshHomeStripRandomSeed();
  }

  function applyRuntime(data: RuntimeInfo): void {
    setIdleLockMinutes(data.config.idleLockMinutes);
    setToolAvailability(data.toolAvailability);
    setStorageUsage(data.storageUsage);
  }

  function applySocketStateSnapshot(snapshot: SocketStateSnapshot): void {
    setCatalog(snapshot.catalogItems);
    setHomeStrips(snapshot.homeStrips);
    refreshHomeStripRandomSeed();
    setPendingIngests(snapshot.pendingIngests);
    applyRuntime(snapshot.runtime);
  }

  function applyCatalogItemUpdate(item: CatalogItem): void {
    setCatalog((currentItems) => upsertCatalogItem(currentItems, item));
    setViewerItem((currentValue) => (currentValue?.id === item.id ? item : currentValue));
    setRecentActivity((currentItems) =>
      currentItems.map((candidate) =>
        candidate.itemId === item.id
          ? {
              ...candidate,
              title: getCatalogItemDisplayName(item)
            }
          : candidate
      )
    );
  }

  function recordJobActivity(jobEvent: JobEvent): void {
    const targetId = jobEvent.targetKind === 'catalog_item' ? jobEvent.itemId : jobEvent.pendingIngestId;
    const activityId = `${jobEvent.targetKind}:${targetId ?? 'unknown'}:${jobEvent.processing.stage}`;

    if (jobEvent.targetKind === 'catalog_item' && jobEvent.itemId && jobEvent.status !== 'pending') {
      const nextStatus: CatalogItemStatus = jobEvent.status;
      const nextProcessing = jobEvent.processing;
      const nextItemId = jobEvent.itemId;

      setCatalog((currentItems) =>
        currentItems.map((candidate) =>
          candidate.id === nextItemId
            ? {
                ...candidate,
                status: nextStatus,
                processing: nextProcessing
              }
            : candidate
        )
      );
    }

    if (jobEvent.targetKind === 'pending_ingest' && jobEvent.pendingIngestId) {
      const nextPendingIngestId = jobEvent.pendingIngestId;
      const nextProcessing = jobEvent.processing;

      setPendingIngests((currentItems) =>
        currentItems.map((candidate) =>
          candidate.id === nextPendingIngestId
            ? {
                ...candidate,
                processing: nextProcessing
              }
            : candidate
        )
      );
      setPendingIngest((currentValue) =>
        currentValue?.id === nextPendingIngestId
          ? {
              ...currentValue,
              processing: nextProcessing
            }
          : currentValue
      );
    }

    setRecentActivity((currentEntries) =>
      appendActivityFeed(currentEntries, {
        id: activityId,
        title: jobEvent.visibleName,
        sourceType: jobEvent.sourceType,
        targetKind: jobEvent.targetKind,
        itemId: jobEvent.itemId,
        pendingIngestId: jobEvent.pendingIngestId,
        status: jobEvent.status,
        processing: jobEvent.processing
      })
    );
  }

  function handleSocketEnvelope(envelope: Record<string, unknown>): void {
    const type = readString(envelope.type);
    if (!type) {
      return;
    }

    switch (type) {
      case 'catalog:item-updated': {
        const item = hydrateCatalogItem(envelope.payload);
        if (item) {
          applyCatalogItemUpdate(item);
        }
        return;
      }
      case 'pending-ingest-updated': {
        const nextPendingIngest = hydratePendingIngest(envelope.payload);
        if (nextPendingIngest) {
          setPendingIngests((currentItems) => upsertPendingIngest(currentItems, nextPendingIngest));

          if (pendingIngestNeedsUserAction(nextPendingIngest) && isAddVideoModalOpenRef.current) {
            setPendingIngest(nextPendingIngest);
            setDuplicateVisibleName(nextPendingIngest.visibleName);
            setAddVideoMode(nextPendingIngest.sourceType);
          }
        }
        return;
      }
      case 'pending-ingest-deleted': {
        const payload = envelope.payload;
        if (!isRecord(payload)) {
          return;
        }

        const id = readString(payload.id);
        if (!id) {
          return;
        }

        setPendingIngests((currentItems) => currentItems.filter((candidate) => candidate.id !== id));
        setPendingIngest((currentValue) => (currentValue?.id === id ? null : currentValue));
        return;
      }
      case 'catalog:list': {
        const items = parseCatalogItemsPayload(envelope.payload);
        if (items) {
          applyLoadedCatalogItems(items);
        }
        return;
      }
      case 'pending-ingests:list': {
        const pendingItems = parsePendingIngestsPayload(envelope.payload);
        if (pendingItems) {
          setPendingIngests(pendingItems);
        }
        return;
      }
      case 'runtime': {
        const runtime = hydrateRuntimeInfo(envelope.payload);
        if (runtime) {
          applyRuntime(runtime);
        }
        return;
      }
      case 'ack': {
        if (envelope.ok === true) {
          const snapshot = hydrateSocketStateSnapshot(envelope.data);
          if (snapshot) {
            applySocketStateSnapshot(snapshot);
          }
        }
        return;
      }
      case 'panic':
        resetAuthenticatedState();
        return;
      case 'evt': {
        const name = readString(envelope.name);
        if (!name) {
          return;
        }

        switch (name) {
          case 'state.snapshot': {
            const snapshot = hydrateSocketStateSnapshot(envelope.data);
            if (snapshot) {
              applySocketStateSnapshot(snapshot);
            }
            return;
          }
          case 'runtime.updated': {
            const runtime = hydrateRuntimeInfo(envelope.data);
            if (runtime) {
              applyRuntime(runtime);
            }
            return;
          }
          case 'homeStrips.updated': {
            const payload = parseCatalogHomeStripsPayload(envelope.data);
            if (payload) {
              applyLoadedHomeStrips(payload);
            }
            return;
          }
          case 'catalog.delta': {
            const payload = envelope.data;
            if (!isRecord(payload)) {
              return;
            }

            const op = readString(payload.op);
            if (op === 'delete') {
              const itemId = readString(payload.itemId);
              if (itemId) {
                setCatalog((currentItems) => currentItems.filter((candidate) => candidate.id !== itemId));
                setViewerItem((currentValue) => (currentValue?.id === itemId ? null : currentValue));
                setDetailsItemId((currentValue) => (currentValue === itemId ? null : currentValue));
                void loadRuntime();
              }
              return;
            }

            if (op === 'upsert') {
              const item = hydrateCatalogItem(payload.item);
              if (item) {
                applyCatalogItemUpdate(item);
              }
            }
            return;
          }
          case 'video.updated': {
            const item = hydrateCatalogItem(envelope.data);
            if (item) {
              applyCatalogItemUpdate(item);
            }
            return;
          }
          case 'video.processingStateChanged': {
            const payload = envelope.data;
            if (!isRecord(payload)) {
              return;
            }

            const itemId = readString(payload.itemId);
            const status = readString(payload.status);
            const processing =
              payload.processing === null ? null : hydrateProcessingSnapshot(payload.processing);

            if (!itemId || !status || !isCatalogItemStatus(status)) {
              return;
            }

            if (payload.processing !== null && !processing) {
              return;
            }

            setCatalog((currentItems) =>
              currentItems.map((candidate) =>
                candidate.id === itemId
                  ? {
                      ...candidate,
                      status,
                      processing
                    }
                  : candidate
              )
            );
            return;
          }
          case 'pendingIngest.updated': {
            const nextPendingIngest = hydratePendingIngest(envelope.data);
            if (!nextPendingIngest) {
              return;
            }

            setPendingIngests((currentItems) => upsertPendingIngest(currentItems, nextPendingIngest));

            if (pendingIngestNeedsUserAction(nextPendingIngest) && isAddVideoModalOpenRef.current) {
              setPendingIngest(nextPendingIngest);
              setDuplicateVisibleName(nextPendingIngest.visibleName);
              setAddVideoMode(nextPendingIngest.sourceType);
            }
            return;
          }
          case 'pendingIngest.deleted': {
            const payload = envelope.data;
            if (!isRecord(payload)) {
              return;
            }

            const id = readString(payload.id);
            if (!id) {
              return;
            }

            setPendingIngests((currentItems) => currentItems.filter((candidate) => candidate.id !== id));
            setPendingIngest((currentValue) => (currentValue?.id === id ? null : currentValue));
            return;
          }
          case 'job.progress':
          case 'job.completed':
          case 'job.failed': {
            const jobEvent = hydrateJobEvent(envelope.data);
            if (jobEvent) {
              recordJobActivity(jobEvent);
              if (name === 'job.completed') {
                void loadRuntime();
              }
            }
            return;
          }
          case 'auth.locked':
          case 'auth.expired':
            resetAuthenticatedState();
            return;
          default:
            return;
        }
      }
      default:
        return;
    }
  }

  async function loadCatalog(): Promise<void> {
    const response = await fetch('/api/catalog', {
      credentials: 'include'
    });

    if (response.status === 401) {
      resetAuthenticatedState();
      return;
    }

    if (!response.ok) {
      return;
    }

    const payload = await readJsonPayload(response);
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      return;
    }

    const items = payload.items
      .map((candidate) => hydrateCatalogItem(candidate))
      .filter((candidate): candidate is CatalogItem => candidate !== null);

    if (items.length !== payload.items.length) {
      return;
    }

    applyLoadedCatalogItems(items);
  }

  async function loadHomeStrips(): Promise<void> {
    const response = await fetch('/api/home-strips', {
      credentials: 'include'
    });

    if (response.status === 401) {
      resetAuthenticatedState();
      return;
    }

    if (!response.ok) {
      return;
    }

    const payload = await readJsonPayload(response);
    const strips = parseCatalogHomeStripsPayload(payload);
    if (!strips) {
      return;
    }

    applyLoadedHomeStrips(strips);
  }

  async function fetchTagSuggestions(query: string, limit = 10): Promise<CatalogTag[]> {
    try {
      const searchParameters = new URLSearchParams({
        search: query,
        limit: String(limit)
      });
      const response = await fetch(`/api/tags?${searchParameters.toString()}`, {
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return [];
      }

      if (!response.ok) {
        return [];
      }

      const payload = await readJsonPayload(response);
      if (!isRecord(payload)) {
        return [];
      }

      const tags = parseCatalogTagsPayload(payload.tags);
      return tags ?? [];
    } catch (error) {
      console.warn('catalog.tags.search.failed', {
        query,
        message: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async function renameCatalogItem(itemId: string, visibleName: string): Promise<CatalogItem | null> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ visibleName })
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.item.rename.failed', {
          itemId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return null;
      }

      applyCatalogItemUpdate(updatedItem);
      return updatedItem;
    } catch (error) {
      console.warn('catalog.item.rename.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function addCatalogItemTag(itemId: string, label: string): Promise<CatalogItem | null> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/tags`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ label })
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.tag.add.failed', {
          itemId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return null;
      }

      setCatalog((currentItems) => upsertCatalogItem(currentItems, updatedItem));
      setViewerItem((currentValue) => (currentValue?.id === updatedItem.id ? updatedItem : currentValue));
      return updatedItem;
    } catch (error) {
      console.warn('catalog.tag.add.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function removeCatalogItemTag(itemId: string, tagId: string): Promise<CatalogItem | null> {
    try {
      const response = await fetch(
        `/api/catalog/${encodeURIComponent(itemId)}/tags/${encodeURIComponent(tagId)}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.tag.remove.failed', {
          itemId,
          tagId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return null;
      }

      setCatalog((currentItems) => upsertCatalogItem(currentItems, updatedItem));
      setViewerItem((currentValue) => (currentValue?.id === updatedItem.id ? updatedItem : currentValue));
      return updatedItem;
    } catch (error) {
      console.warn('catalog.tag.remove.failed', {
        itemId,
        tagId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function incrementCatalogItemViewCount(itemId: string): Promise<void> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/views`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.view-count.increment.failed', {
          itemId,
          status: response.status,
          message
        });
        return;
      }

      if (!isRecord(payload)) {
        return;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return;
      }

      setCatalog((currentItems) => upsertCatalogItem(currentItems, updatedItem));
      setViewerItem((currentValue) => (currentValue?.id === updatedItem.id ? updatedItem : currentValue));
    } catch (error) {
      console.warn('catalog.view-count.increment.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function deleteCatalogItem(itemId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return false;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.item.delete.failed', {
          itemId,
          status: response.status,
          message
        });
        return false;
      }

      setCatalog((currentItems) => currentItems.filter((candidate) => candidate.id !== itemId));
      setViewerItem((currentValue) => (currentValue?.id === itemId ? null : currentValue));
      setDetailsItemId((currentValue) => (currentValue === itemId ? null : currentValue));
      void loadRuntime();
      return true;
    } catch (error) {
      console.warn('catalog.item.delete.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async function markCatalogItemUsed(itemId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/used`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return false;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.used-count.increment.failed', {
          itemId,
          status: response.status,
          message
        });
        return false;
      }

      if (!isRecord(payload)) {
        return false;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return false;
      }

      setCatalog((currentItems) => upsertCatalogItem(currentItems, updatedItem));
      // setViewerItem((currentValue) => (currentValue?.id === updatedItem.id ? updatedItem : currentValue));
      return true;
    } catch (error) {
      console.warn('catalog.used-count.increment.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async function setCatalogItemThumbnail(itemId: string, timeSeconds: number): Promise<boolean> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/thumbnail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ timeSeconds })
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return false;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.thumbnail.update.failed', {
          itemId,
          status: response.status,
          message
        });
        return false;
      }

      if (!isRecord(payload)) {
        return false;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return false;
      }

      setCatalog((currentItems) => upsertCatalogItem(currentItems, updatedItem));
      setViewerItem((currentValue) => (currentValue?.id === updatedItem.id ? updatedItem : currentValue));
      return true;
    } catch (error) {
      console.warn('catalog.thumbnail.update.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async function saveCatalogItemViewerVisualAdjustments(
    itemId: string,
    adjustments: ViewerVisualAdjustments
  ): Promise<CatalogItem | null> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/viewer-adjustments`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(normalizeViewerVisualAdjustments(adjustments))
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.viewer-adjustments.update.failed', {
          itemId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      const updatedItem = hydrateCatalogItem(payload.item);
      if (!updatedItem) {
        return null;
      }

      setCatalog((currentItems) => upsertCatalogItem(currentItems, updatedItem));
      setViewerItem((currentValue) => (currentValue?.id === updatedItem.id ? updatedItem : currentValue));
      return updatedItem;
    } catch (error) {
      console.warn('catalog.viewer-adjustments.update.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function listCatalogItemBookmarks(itemId: string): Promise<CatalogBookmark[] | null> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/bookmarks`, {
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.bookmarks.list.failed', {
          itemId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload) || !Array.isArray(payload.bookmarks)) {
        return null;
      }

      const bookmarks = payload.bookmarks
        .map((candidate) => hydrateCatalogBookmark(candidate))
        .filter((candidate): candidate is CatalogBookmark => candidate !== null);

      if (bookmarks.length !== payload.bookmarks.length) {
        return null;
      }

      return sortCatalogBookmarks(bookmarks);
    } catch (error) {
      console.warn('catalog.bookmarks.list.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function createCatalogItemBookmark(
    itemId: string,
    timeSeconds: number
  ): Promise<CatalogBookmark | null> {
    try {
      const response = await fetch(`/api/catalog/${encodeURIComponent(itemId)}/bookmarks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ timeSeconds })
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.bookmarks.create.failed', {
          itemId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      return hydrateCatalogBookmark(payload.bookmark);
    } catch (error) {
      console.warn('catalog.bookmarks.create.failed', {
        itemId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function updateCatalogItemBookmarkName(
    itemId: string,
    bookmarkId: string,
    name: string | null
  ): Promise<CatalogBookmark | null> {
    try {
      const response = await fetch(
        `/api/catalog/${encodeURIComponent(itemId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ name })
        }
      );

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.bookmarks.rename.failed', {
          itemId,
          bookmarkId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      return hydrateCatalogBookmark(payload.bookmark);
    } catch (error) {
      console.warn('catalog.bookmarks.rename.failed', {
        itemId,
        bookmarkId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function useCatalogItemBookmark(
    itemId: string,
    bookmarkId: string
  ): Promise<CatalogBookmark | null> {
    try {
      const response = await fetch(
        `/api/catalog/${encodeURIComponent(itemId)}/bookmarks/${encodeURIComponent(bookmarkId)}/use`,
        {
          method: 'POST',
          credentials: 'include'
        }
      );

      if (response.status === 401) {
        resetAuthenticatedState();
        return null;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.bookmarks.use.failed', {
          itemId,
          bookmarkId,
          status: response.status,
          message
        });
        return null;
      }

      if (!isRecord(payload)) {
        return null;
      }

      return hydrateCatalogBookmark(payload.bookmark);
    } catch (error) {
      console.warn('catalog.bookmarks.use.failed', {
        itemId,
        bookmarkId,
        message: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async function deleteCatalogItemBookmark(itemId: string, bookmarkId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `/api/catalog/${encodeURIComponent(itemId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );

      if (response.status === 401) {
        resetAuthenticatedState();
        return false;
      }

      const payload = await readJsonPayload(response);

      if (!response.ok) {
        const message = isRecord(payload) ? readString(payload.message) : null;
        console.warn('catalog.bookmarks.delete.failed', {
          itemId,
          bookmarkId,
          status: response.status,
          message
        });
        return false;
      }

      return true;
    } catch (error) {
      console.warn('catalog.bookmarks.delete.failed', {
        itemId,
        bookmarkId,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async function updateServerSideToolsFromSettings(): Promise<void> {
    if (toolUpdateState.status === 'running') {
      return;
    }

    setToolUpdateState({
      status: 'running',
      message: 'Updating server-side tools…',
      result: null
    });

    try {
      const response = await fetch('/api/tools/update', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.status === 401) {
        resetAuthenticatedState();
        return;
      }

      const payload = await readJsonPayload(response);
      const message = isRecord(payload) ? readString(payload.message) : null;

      if (!response.ok) {
        setToolUpdateState({
          status: 'error',
          message: message ?? 'Tool update failed.',
          result: null
        });
        return;
      }

      const data = hydrateServerToolUpdateResponse(payload);
      if (!data) {
        setToolUpdateState({
          status: 'error',
          message: message ?? 'Tool update finished, but the server response could not be read.',
          result: null
        });
        return;
      }

      applyRuntime(data.runtime);
      setToolUpdateState({
        status: getToolUpdateUiStatusFromResult(data.result),
        message: data.message || data.result.summary,
        result: data.result
      });
    } catch (error) {
      setToolUpdateState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Tool update failed.',
        result: null
      });
    }
  }

  async function loadRuntime(): Promise<void> {
    const response = await fetch('/api/runtime', {
      credentials: 'include'
    });

    if (response.status === 401) {
      resetAuthenticatedState();
      return;
    }

    if (!response.ok) {
      return;
    }

    const payload = await readJsonPayload(response);
    const data = hydrateRuntimeInfo(payload);
    if (!data) {
      return;
    }

    applyRuntime(data);
  }

  async function checkSession(): Promise<void> {
    const response = await fetch('/api/me', {
      credentials: 'include'
    });
    const payload = await readJsonPayload(response);
    const authenticatedValue =
      isRecord(payload) && readBoolean(payload.authenticated) !== null
        ? readBoolean(payload.authenticated)
        : false;

    if (!authenticatedValue) {
      resetAuthenticatedState();
      return;
    }

    setAuthenticated(true);
    await Promise.all([loadCatalog(), loadRuntime(), loadHomeStrips()]);
  }

  async function login(query: string): Promise<void> {
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ password: query })
      });

      if (!response.ok) {
        redirectToGoogleSearch(query);
        return;
      }

      setAuthenticated(true);
      await Promise.all([loadCatalog(), loadRuntime(), loadHomeStrips()]);
    } catch {
      redirectToGoogleSearch(query);
    }
  }

  async function requestPanicLock(): Promise<void> {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      sendStructuredSocketCommand('auth.lock');
      socketRef.current.send(JSON.stringify({ type: 'panic' }));
    }

    try {
      await fetch('/api/panic', {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // Keep the client-side panic behavior immediate even if the request fails.
    } finally {
      resetAuthenticatedState();
    }
  }

  async function parseIngestResponseFromHttp(response: Response): Promise<ParsedIngestResponse> {
    if (response.status === 401) {
      resetAuthenticatedState();
      return {
        kind: 'error',
        message: 'Session expired. Enter your password again.'
      };
    }

    const payload = await readJsonPayload(response);
    const parsed = parseIngestResponse(payload);

    if (parsed) {
      return parsed;
    }

    if (!response.ok) {
      return {
        kind: 'error',
        message: 'Request failed.'
      };
    }

    return {
      kind: 'error',
      message: 'Received an unexpected server response.'
    };
  }

  async function performMultipartIngestRequest(
    formData: FormData,
    endpoint: string
  ): Promise<ParsedIngestResponse> {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    return await parseIngestResponseFromHttp(response);
  }

  async function performJsonIngestRequest(
    payload: { url: string },
    endpoint: string
  ): Promise<ParsedIngestResponse> {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    return await parseIngestResponseFromHttp(response);
  }

  async function resolveDuplicateRequest(
    activePendingIngest: PendingIngest,
    action: DuplicateResolutionAction,
    visibleName: string
  ): Promise<ParsedIngestResponse> {
    const endpoint =
      activePendingIngest.sourceType === 'upload'
        ? `/api/uploads/${encodeURIComponent(activePendingIngest.id)}/resolve-duplicate`
        : `/api/imports/${encodeURIComponent(activePendingIngest.id)}/resolve-duplicate`;

    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        visibleName
      })
    });

    if (response.status === 401) {
      resetAuthenticatedState();
      return {
        kind: 'error',
        message: 'Session expired. Enter your password again.'
      };
    }

    const payload = await readJsonPayload(response);
    const parsed = parseIngestResponse(payload);

    if (parsed) {
      return parsed;
    }

    if (!response.ok) {
      return {
        kind: 'error',
        message: 'Duplicate resolution failed.'
      };
    }

    return {
      kind: 'error',
      message: 'Received an unexpected server response.'
    };
  }

  async function finalizeSuccessfulIngest(item: CatalogItem): Promise<void> {
    setCatalog((currentItems) => upsertCatalogItem(currentItems, item));
    setPendingIngest(null);
    setDuplicateVisibleName('');
    setAddVideoNotice(null);
    resetUploadSelection();
    setImportUrl('');
    setIsAddVideoModalOpen(false);
    requestCatalogList();
    void loadCatalog();
    void loadRuntime();
  }

  async function applyIngestResponse(
    response: ParsedIngestResponse,
    cancellationText: string
  ): Promise<void> {
    switch (response.kind) {
      case 'error':
        setAddVideoNotice({
          tone: 'error',
          text: response.message
        });
        return;
      case 'cancelled':
        setPendingIngest(null);
        setDuplicateVisibleName('');
        setAddVideoNotice({
          tone: 'info',
          text: cancellationText
        });
        resetUploadSelection();
        setImportUrl('');
        return;
      case 'duplicate': {
        const hasDuplicateConflicts = response.pendingIngest.duplicateCheck.hasConflicts;

        setPendingIngest(response.pendingIngest);
        setAddVideoMode(response.pendingIngest.sourceType);
        setDuplicateVisibleName(response.pendingIngest.visibleName);
        setAddVideoNotice({
          tone: hasDuplicateConflicts ? 'warning' : 'info',
          text: hasDuplicateConflicts
            ? 'Duplicate validation needs your decision before processing can continue.'
            : 'Confirm or edit the catalog title before finalizing this item.'
        });
        resetUploadSelection();
        setImportUrl('');
        return;
      }
      case 'success':
        await finalizeSuccessfulIngest(response.item);
        return;
    }
  }

  async function handleUploadSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedFile) {
      setAddVideoNotice({
        tone: 'error',
        text: 'Choose a file first.'
      });
      return;
    }

    setIsAddVideoBusy(true);
    setAddVideoNotice({
      tone: 'info',
      text: 'Upload started. Live progress will appear in the activity panel.'
    });
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await performMultipartIngestRequest(formData, '/api/uploads/file');
      await applyIngestResponse(response, 'The staged upload was cancelled.');
    } catch {
      setAddVideoNotice({
        tone: 'error',
        text: 'Upload failed.'
      });
    } finally {
      setIsAddVideoBusy(false);
    }
  }

  async function handleImportSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!toolAvailability.ytDlp) {
      setAddVideoNotice({
        tone: 'error',
        text: 'yt-dlp is not available on this server.'
      });
      return;
    }

    const trimmedUrl = importUrl.trim();
    if (trimmedUrl === '') {
      setAddVideoNotice({
        tone: 'error',
        text: 'Enter a URL first.'
      });
      return;
    }

    setIsAddVideoBusy(true);
    setAddVideoNotice({
      tone: 'info',
      text: 'Metadata preflight started. Live progress will appear over WebSocket as the import advances.'
    });

    try {
      const response = await performJsonIngestRequest(
        { url: trimmedUrl },
        '/api/imports/yt-dlp'
      );
      await applyIngestResponse(response, 'The staged import was cancelled.');
    } catch {
      setAddVideoNotice({
        tone: 'error',
        text: 'URL import failed.'
      });
    } finally {
      setIsAddVideoBusy(false);
    }
  }

  async function handleDuplicateContinue(): Promise<void> {
    if (!pendingIngest) {
      return;
    }

    if (duplicateVisibleName.trim() === '') {
      setAddVideoNotice({
        tone: 'error',
        text: 'Enter a catalog title before continuing.'
      });
      return;
    }

    setIsAddVideoBusy(true);

    try {
      const response = await resolveDuplicateRequest(
        pendingIngest,
        'continue',
        duplicateVisibleName
      );
      await applyIngestResponse(
        response,
        pendingIngest.sourceType === 'upload'
          ? 'The staged upload was cancelled.'
          : 'The staged import was cancelled.'
      );
    } catch {
      setAddVideoNotice({
        tone: 'error',
        text: 'Unable to continue the staged ingest.'
      });
    } finally {
      setIsAddVideoBusy(false);
    }
  }

  async function handleDuplicateCancel(): Promise<void> {
    if (!pendingIngest) {
      return;
    }

    setIsAddVideoBusy(true);

    try {
      const response = await resolveDuplicateRequest(
        pendingIngest,
        'cancel',
        duplicateVisibleName
      );
      await applyIngestResponse(
        response,
        pendingIngest.sourceType === 'upload'
          ? 'The staged upload was cancelled.'
          : 'The staged import was cancelled.'
      );
    } catch {
      setAddVideoNotice({
        tone: 'error',
        text: 'Unable to cancel the staged ingest.'
      });
    } finally {
      setIsAddVideoBusy(false);
    }
  }

  useEffect(() => {
    void checkSession();
  }, []);

  useEffect(() => {
    isAddVideoModalOpenRef.current = isAddVideoModalOpen;
  }, [isAddVideoModalOpen]);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    shouldReconnectRef.current = true;
    let closed = false;
    let firstMessageTimer: number | null = null;
    let openTimer: number | null = null;
    const candidateUrls = getWebSocketCandidateUrls();

    const clearFirstMessageTimer = (): void => {
      if (firstMessageTimer !== null) {
        window.clearTimeout(firstMessageTimer);
        firstMessageTimer = null;
      }
    };

    const clearOpenTimer = (): void => {
      if (openTimer !== null) {
        window.clearTimeout(openTimer);
        openTimer = null;
      }
    };

    const clearSocketTimers = (): void => {
      clearFirstMessageTimer();
      clearOpenTimer();
    };

    const connectSocket = (isReconnect: boolean, candidateIndex = 0): void => {
      if (closed) {
        return;
      }

      const socketUrl = candidateUrls[candidateIndex] ?? candidateUrls[0] ?? getSameOriginWebSocketUrl();
      let receivedApplicationMessage = false;

      setSocketConnectionState(isReconnect ? 'reconnecting' : 'connecting');
      clearSocketTimers();

      let socket: WebSocket;
      try {
        socket = new WebSocket(socketUrl);
      } catch (error) {
        console.warn('catalog.websocket.construct_failed', {
          url: socketUrl,
          error: error instanceof Error ? error.message : String(error),
          fallbackAvailable: candidateIndex + 1 < candidateUrls.length
        });

        if (candidateIndex + 1 < candidateUrls.length) {
          setSocketConnectionState('reconnecting');
          reconnectTimerRef.current = window.setTimeout(() => {
            connectSocket(true, candidateIndex + 1);
          }, 0);
          return;
        }

        setSocketConnectionState('disconnected');
        return;
      }

      if (getViteClientEnv().DEV === true) {
        console.info('catalog.websocket.connecting', {
          url: socketUrl,
          candidateIndex,
          candidateUrls
        });
      }

      socketRef.current = socket;
      openTimer = window.setTimeout(() => {
        if (closed || socketRef.current !== socket || socket.readyState !== WebSocket.CONNECTING) {
          return;
        }

        console.warn('catalog.websocket.open_timeout', {
          url: socketUrl,
          fallbackAvailable: candidateIndex + 1 < candidateUrls.length
        });

        try {
          socket.close(4002, 'WebSocket upgrade timed out.');
        } catch {
          // Ignore close failures while forcing a retry path.
        }
      }, APPLICATION_SOCKET_OPEN_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        clearOpenTimer();

        if (closed || socketRef.current !== socket) {
          return;
        }

        setSocketConnectionState('connected');
        clearReconnectTimer();
        sendStructuredSocketCommand('jobs.subscribe', { enabled: true });
        sendStructuredSocketCommand('state.sync');

        firstMessageTimer = window.setTimeout(() => {
          if (closed || socketRef.current !== socket || receivedApplicationMessage) {
            return;
          }

          console.warn('catalog.websocket.no_application_messages', {
            url: socketUrl,
            fallbackAvailable: candidateIndex + 1 < candidateUrls.length
          });

          try {
            socket.close(4002, 'No application WebSocket messages received.');
          } catch {
            // Ignore close failures while forcing a retry path.
          }
        }, APPLICATION_SOCKET_FIRST_MESSAGE_TIMEOUT_MS);
      });

      socket.addEventListener('message', (event) => {
        const parsedEnvelope = parseSocketEnvelope(event.data);
        if (!parsedEnvelope || !isApplicationSocketEnvelope(parsedEnvelope)) {
          return;
        }

        receivedApplicationMessage = true;
        clearFirstMessageTimer();
        handleSocketEnvelope(parsedEnvelope);
      });

      socket.addEventListener('close', (event) => {
        clearSocketTimers();

        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        if (closed) {
          return;
        }

        if (event.code === 4000) {
          resetAuthenticatedState();
          return;
        }

        if (!receivedApplicationMessage && candidateIndex + 1 < candidateUrls.length) {
          console.warn('catalog.websocket.retrying_next_candidate', {
            failedUrl: socketUrl,
            closeCode: event.code,
            closeReason: event.reason,
            nextUrl: candidateUrls[candidateIndex + 1]
          });
          setSocketConnectionState('reconnecting');
          connectSocket(true, candidateIndex + 1);
          return;
        }

        if (event.code === 4001) {
          resetAuthenticatedState();
          return;
        }

        if (event.code === 4003) {
          console.warn('catalog.websocket.origin_rejected', {
            url: socketUrl,
            closeCode: event.code,
            closeReason: event.reason
          });
        }

        if (!shouldReconnectRef.current) {
          setSocketConnectionState('disconnected');
          return;
        }

        setSocketConnectionState('reconnecting');
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          connectSocket(true);
        }, 1500);
      });

      socket.addEventListener('error', () => {
        if (!closed) {
          setSocketConnectionState('reconnecting');
        }
      });
    };

    connectSocket(false);

    return () => {
      closed = true;
      shouldReconnectRef.current = false;
      clearSocketTimers();
      clearReconnectTimer();
      if (socketRef.current) {
        const socket = socketRef.current;
        socketRef.current = null;
        try {
          socket.close();
        } catch {
          // Ignore socket close failures during teardown.
        }
      }
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void loadRuntime();
    }, RUNTIME_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [authenticated]);

  useEffect(() => {
    if (!toolAvailability.ytDlp && addVideoMode === 'yt_dlp' && pendingIngest === null) {
      setAddVideoMode('upload');
    }
  }, [toolAvailability.ytDlp, addVideoMode, pendingIngest]);

  useEffect(() => {
    if (!pendingIngest) {
      return;
    }

    const latestPendingIngest = pendingIngests.find((candidate) => candidate.id === pendingIngest.id);
    if (!latestPendingIngest) {
      return;
    }

    setPendingIngest(latestPendingIngest);
  }, [pendingIngest, pendingIngests]);

  useEffect(() => {
    if (!viewerItem || viewerCloseRequestedRef.current) {
      return;
    }

    const latestViewerItem = catalog.find((candidate) => candidate.id === viewerItem.id);
    if (!latestViewerItem || latestViewerItem === viewerItem) {
      return;
    }

    setViewerItem(latestViewerItem);
  }, [catalog, viewerItem]);

  useEffect(() => {
    if (detailsItemId !== null && detailsItem === null) {
      setDetailsItemId(null);
    }
  }, [detailsItemId, detailsItem]);

  useEffect(() => {
    const markInteraction = (): void => {
      lastInteractionRef.current = Date.now();
    };

    const handleKeydown = (event: KeyboardEvent): void => {
      markInteraction();
      if (event.key === 'Escape' && !event.repeat && authenticated && viewerItem === null) {
        void requestPanicLock();
      }
    };

    const events: Array<keyof DocumentEventMap> = [
      'mousemove',
      'mousedown',
      'pointerdown',
      'touchstart',
      'wheel',
      'keydown'
    ];

    document.addEventListener('keydown', handleKeydown);
    for (const eventName of events) {
      if (eventName !== 'keydown') {
        document.addEventListener(eventName, markInteraction as EventListener, {
          passive: true
        });
      }
    }

    const interval = window.setInterval(() => {
      if (!authenticated) {
        return;
      }

      if (viewerItem !== null) {
        lastInteractionRef.current = Date.now();
        return;
      }

      const idleMs = idleLockMinutes * 60 * 1000;
      if (Date.now() - lastInteractionRef.current >= idleMs) {
        void requestPanicLock();
      }
    }, 10000);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      for (const eventName of events) {
        if (eventName !== 'keydown') {
          document.removeEventListener(eventName, markInteraction as EventListener);
        }
      }
      window.clearInterval(interval);
    };
  }, [authenticated, idleLockMinutes, viewerItem]);

  useEffect(() => {
    if (!isAnyModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isAnyModalOpen]);

  if (!authenticated) {
    return <GoogleLockScreen onSubmit={login} />;
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-start">
          <button
            type="button"
            className={`icon-button filter-drawer-toggle${isFilterDrawerOpen ? ' is-active' : ''}`}
            onClick={() => setIsFilterDrawerOpen((currentValue) => !currentValue)}
            aria-label={
              isFilterDrawerOpen
                ? 'Close search, sort, and tags panel'
                : 'Open search, sort, and tags panel'
            }
            aria-expanded={isFilterDrawerOpen}
            aria-controls="filter-drawer"
            title={
              isFilterDrawerOpen
                ? 'Close search, sort, and tags panel'
                : 'Open search, sort, and tags panel'
            }
          >
            <FilterIcon />
          </button>

          <div className="titlebar-title">
            <h1 className="yesteryear-regular">Sugar&amp;Spice</h1>
          </div>
        </div>

        <div className="titlebar-actions">
          <IconButton
            label="Refresh"
            onClick={() => {
              void loadCatalog();
              void loadRuntime();
              void loadHomeStrips();
              requestCatalogList();
            }}
          >
            <RefreshIcon />
          </IconButton>
          <IconButton label="Add video" onClick={openAddVideoModal}>
            <UploadIcon />
          </IconButton>
          <IconButton label="Settings" onClick={() => setIsSettingsModalOpen(true)}>
            <SettingsIcon />
          </IconButton>
          <IconButton label="Lock" onClick={() => void requestPanicLock()}>
            <LogoutIcon />
          </IconButton>
        </div>
      </header>

      <main className={`app-main${isFilterDrawerOpen ? ' is-filter-drawer-open' : ''}`}>
        <aside
          id="filter-drawer"
          className="filter-drawer"
          aria-label="Catalog search, sort, and tags"
          aria-hidden={!isFilterDrawerOpen}
        >
          <div className="filter-drawer-inner">
            <section className="sidebar-panel filter-drawer-panel">
              <div className="form-stack">
                <div>
                  <label className="field-label" htmlFor="catalog-search">
                    Search
                  </label>
                    {isAnyCatalogFilterActive ? (
                    <button
                      type="button"
                      className="clear-filter-text link-button filter-clear-button"
                      disabled={!isFilterDrawerOpen}
                      onClick={clearCatalogFilters}
                    >
                      Clear all filters
                    </button>
                  ) : null}
                  <input
                    id="catalog-search"
                    type="search"
                    value={filters.search}
                    placeholder="Search by name, source, or URL"
                    disabled={!isFilterDrawerOpen}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setFilters((currentValue) => ({
                        ...currentValue,
                        search: event.target.value
                      }))
                    }
                  />
                </div>

                <div className="sort-control-group">
                  <div className="sort-control-row">
                    <div>
                      <label className="field-label" htmlFor="sort-filter">
                        Sort by
                      </label>
                      <select
                        id="sort-filter"
                        value={filters.sortCategory}
                        disabled={!isFilterDrawerOpen}
                        onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                          const nextSortCategory = event.target.value as CatalogSortCategory;
                          setIsAdHocCatalogSortActive(true);
                          setFilters((currentValue) => ({
                            ...currentValue,
                            sortCategory: nextSortCategory,
                            randomSeed:
                              nextSortCategory === 'random' && currentValue.sortCategory !== 'random'
                                ? createNextCatalogRandomSeed(currentValue.randomSeed)
                                : currentValue.randomSeed
                          }));
                        }}
                      >
                        {Object.entries(CATALOG_SORT_CATEGORY_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      className={`sort-direction-button${isRandomSortActive ? ' is-random-disabled' : ''}`}
                      disabled={!isFilterDrawerOpen || isRandomSortActive}
                      onClick={() => {
                        setIsAdHocCatalogSortActive(true);
                        setFilters((currentValue) => ({
                          ...currentValue,
                          sortDirection: currentValue.sortDirection === 'asc' ? 'desc' : 'asc'
                        }));
                      }}
                      aria-label={
                        isRandomSortActive
                          ? 'Sort direction is not used while randomized sorting is active.'
                          : `Sort order: ${filters.sortDirection === 'asc' ? 'ascending' : 'descending'}. Toggle sort direction.`
                      }
                      title={
                        isRandomSortActive
                          ? 'Randomized sorting ignores ascending and descending order'
                          : `Sort ${filters.sortDirection === 'asc' ? 'ascending' : 'descending'}`
                      }
                    >
                      <span className="sort-direction-icon" aria-hidden="true">
                        {filters.sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </div>

                  {isRandomSortActive ? (
                    <div className="random-sort-controls">
                      <button
                        type="button"
                        className="randomize-sort-button"
                        disabled={!isFilterDrawerOpen}
                        onClick={reshuffleCatalogSort}
                      >
                        Shuffle again
                      </button>
                      <p className="sort-help-text">
                        Randomized sorting uses the current search and tag filters. Ascending and descending order
                        are ignored.
                      </p>
                    </div>
                  ) : null}
                </div>

                <section className="tag-filter-section" aria-labelledby="tag-filter-heading">
                  <div className="filter-section-heading">
                    <label className="field-label" id="tag-filter-heading" htmlFor="tag-filter-search">
                      Tags
                    </label>
                    {activeTagFilterCount > 0 ? (
                      <span className="tag-selected-count">{activeTagFilterCount}</span>
                    ) : null}
                  </div>
                  <p className="filter-section-description">
                    Include tags to require them. Exclude tags to hide matching items.
                  </p>

                  <div className="tag-filter-input-wrap">
                    <input
                      id="tag-filter-search"
                      type="search"
                      value={filters.tagSearch}
                      placeholder="Search tags"
                      disabled={!isFilterDrawerOpen}
                      autoComplete="off"
                      onFocus={() => setIsTagFilterSearchFocused(true)}
                      onBlur={() => {
                        window.setTimeout(() => setIsTagFilterSearchFocused(false), 120);
                      }}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setFilters((currentValue) => ({
                          ...currentValue,
                          tagSearch: event.target.value
                        }))
                      }
                    />

                    {isFilterDrawerOpen && filters.tagSearch.trim() !== '' && isTagFilterSearchFocused ? (
                      <div className="tag-filter-suggestion-list" role="listbox" aria-label="Matching tags">
                        {visibleTagFilterSuggestions.length > 0 ? (
                          visibleTagFilterSuggestions.map((tag) => (
                            <div className="tag-filter-suggestion-row" key={tag.id} role="option" aria-selected="false">
                              <span className="tag-filter-suggestion-copy">
                                <span>{tag.label}</span>
                                <span className="tag-usage-count">{tag.usageCount}</span>
                              </span>
                              <span className="tag-filter-suggestion-actions">
                                <button
                                  type="button"
                                  className="tag-mode-button include"
                                  onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                                  onClick={() => applyTagFilter(tag, 'include')}
                                >
                                  Include
                                </button>
                                <button
                                  type="button"
                                  className="tag-mode-button exclude"
                                  onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                                  onClick={() => applyTagFilter(tag, 'exclude')}
                                >
                                  Exclude
                                </button>
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="empty-inline-state">No matching tags.</div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="tag-options-list tag-filter-action-list" role="group" aria-label="Available tags">
                    {visibleTagOptions.length > 0 ? (
                      visibleTagOptions.map((tag) => {
                        const isIncluded = filters.selectedTagIds.includes(tag.id);
                        const isExcluded = filters.excludedTagIds.includes(tag.id);

                        return (
                          <div
                            className={`tag-filter-option${isIncluded ? ' is-included' : ''}${
                              isExcluded ? ' is-excluded' : ''
                            }`}
                            key={tag.id}
                          >
                            <span className="tag-filter-option-copy">
                              <span className="tag-filter-option-label">{tag.label}</span>
                              <span className="tag-usage-count">{tag.usageCount}</span>
                            </span>
                            <span className="tag-filter-option-actions">
                              <button
                                type="button"
                                className={`tag-mode-button include${isIncluded ? ' is-active' : ''}`}
                                disabled={!isFilterDrawerOpen}
                                onClick={() => toggleTagFilter(tag, 'include')}
                                aria-pressed={isIncluded}
                              >
                                Include
                              </button>
                              <button
                                type="button"
                                className={`tag-mode-button exclude${isExcluded ? ' is-active' : ''}`}
                                disabled={!isFilterDrawerOpen}
                                onClick={() => toggleTagFilter(tag, 'exclude')}
                                aria-pressed={isExcluded}
                              >
                                Exclude
                              </button>
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="empty-inline-state">No tags in use yet.</div>
                    )}
                  </div>
                  {tagListLimitNote ? <p className="tag-list-limit-note">{tagListLimitNote}</p> : null}
                </section>

                <section className="home-strip-sidebar-section" aria-labelledby="home-strip-sidebar-heading">
                  <div className="filter-section-heading home-strip-sidebar-heading">
                    <div className="home-strip-sidebar-title">
                      <h3 id="home-strip-sidebar-heading">Quick Strips</h3>
                    </div>
                    <button
                      type="button"
                      className="home-strip-create-icon-button"
                      disabled={!isFilterDrawerOpen}
                      onClick={openCreateHomeStripFromFilters}
                      aria-label="Save current filters to Home"
                      title="Save current filters to Home"
                    >
                      <PlusIcon />
                    </button>
                  </div>
                  <p className="filter-section-description home-strip-sidebar-hint">
                    Drag to reorder. Use + to save the current search, sort, and tags to a new strip.
                  </p>

                  {homeStrips.length > 0 ? (
                    <div className="home-strip-sidebar-list" role="list" aria-label="Saved home layout sections">
                      {homeStrips.map((strip, index) => {
                        const isDragging = draggedHomeStripId === strip.id;
                        const isDropBefore =
                          homeStripDropTarget?.stripId === strip.id && homeStripDropTarget.position === 'before';
                        const isDropAfter =
                          homeStripDropTarget?.stripId === strip.id && homeStripDropTarget.position === 'after';
                        const canDragHomeStrip = isFilterDrawerOpen && homeStrips.length > 1;

                        return (
                          <article
                            className={`home-strip-sidebar-item${isDragging ? ' is-dragging' : ''}${
                              isDropBefore ? ' is-drop-before' : ''
                            }${isDropAfter ? ' is-drop-after' : ''}`}
                            key={strip.id}
                            role="listitem"
                            onDragOver={(event: ReactDragEvent<HTMLElement>) =>
                              handleHomeStripDragOver(strip.id, event)
                            }
                            onDragLeave={(event: ReactDragEvent<HTMLElement>) =>
                              handleHomeStripDragLeave(strip.id, event)
                            }
                            onDrop={(event: ReactDragEvent<HTMLElement>) => handleHomeStripDrop(strip.id, event)}
                          >
                            <span
                              className={`home-strip-sidebar-drag-handle${canDragHomeStrip ? '' : ' is-disabled'}`}
                              draggable={canDragHomeStrip}
                              onDragStart={(event: ReactDragEvent<HTMLElement>) =>
                                handleHomeStripDragStart(strip.id, event)
                              }
                              onDragEnd={clearHomeStripDragState}
                              aria-label={`Drag ${strip.name} to reorder`}
                              title="Drag to reorder"
                            >
                              <GripIcon />
                            </span>
                            <div className="home-strip-sidebar-item-copy">
                              <strong>{strip.name}</strong>
                            </div>
                            <HomeStripActionMenu
                              strip={strip}
                              index={index}
                              totalCount={homeStrips.length}
                              disabled={!isFilterDrawerOpen}
                              className="home-strip-sidebar-menu"
                              onMove={(stripId, direction) => void moveHomeStrip(stripId, direction)}
                              onEdit={openEditHomeStrip}
                              onDelete={(candidate) => void deleteHomeStrip(candidate)}
                            />
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-inline-state">
                      No home sections yet. Use + to save the current search, sort, and tags.
                    </div>
                  )}
                </section>
              </div>
            </section>
          </div>
        </aside>

        <section className="catalog-panel" aria-label={isHomeViewActive ? 'Home layout sections' : 'Catalog results'}>
          {isHomeViewActive ? (
            <div className="home-view">

              {homeStripViews.length > 0 ? (
                homeStripViews.map((view, index) => (
                  <CatalogHomeStripSection
                    key={view.strip.id}
                    view={view}
                    index={index}
                    totalCount={homeStripViews.length}
                    onMove={(stripId, direction) => void moveHomeStrip(stripId, direction)}
                    onEdit={openEditHomeStrip}
                    onDelete={(strip) => void deleteHomeStrip(strip)}
                    onOpenViewer={handleOpenViewer}
                    onOpenDetails={handleOpenDetails}
                    onAddTag={addCatalogItemTag}
                    onRemoveTag={removeCatalogItemTag}
                    onSearchTags={fetchTagSuggestions}
                  />
                ))
              ) : (
                <div className="empty-state home-view-empty">
                  {catalog.length === 0
                    ? 'No items yet. Use Add Video to upload or import one, then save home sections from the side panel.'
                    : 'No home sections yet. Use the + button in the side panel to save the current search, sort, and tags.'}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="catalog-panel-header results-view-header">
                <div>
                  <h2>Catalog results</h2>
                  <p>{catalogCountLabel}</p>
                </div>
                <button type="button" className="app-button secondary" onClick={clearCatalogFilters}>
                  Return to home
                </button>
              </div>

              <div className="grid">
                {filteredCatalog.map((item) => (
                  <CatalogCard
                    key={item.id}
                    item={item}
                    onOpenViewer={handleOpenViewer}
                    onOpenDetails={handleOpenDetails}
                    onAddTag={addCatalogItemTag}
                    onRemoveTag={removeCatalogItemTag}
                    onSearchTags={fetchTagSuggestions}
                  />
                ))}
                {filteredCatalog.length === 0 && (
                  <div className="empty-state">
                    {catalog.length === 0
                      ? 'No items yet. Use Add Video to upload or import one.'
                      : 'No items match the current filters.'}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <p className="muted footer-summary">
          <span>
            {catalog.length} total {catalog.length === 1 ? 'item' : 'items'}
          </span>
          {storageUsageSummary && (
            <>
              <span className="footer-summary-separator" aria-hidden="true">
                ·
              </span>
              <span title={`Storage path: ${storageUsage?.storagePath ?? ''}`}>
                {storageUsageSummary}
              </span>
            </>
          )}
        </p>
        <div className="footer-connection-status" aria-live="polite">
          <span className={`connection-pill connection-${socketConnectionState}`}>
            {SOCKET_CONNECTION_LABELS[socketConnectionState]}
          </span>
        </div>
      </footer>

      {homeStripEditor && (
        <Modal
          title={homeStripEditor.mode === 'add' ? 'Add home section' : 'Edit home section'}
          titleId="home-strip-editor-title"
          onClose={() => {
            if (!homeStripEditor.saving) {
              setHomeStripEditor(null);
              setHomeStripTagSuggestions([]);
              setIsHomeStripTagSearchFocused(false);
            }
          }}
          disableClose={homeStripEditor.saving}
        >
          <form
            className="home-strip-editor-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => void saveHomeStripEditor(event)}
          >
            <p className="filter-section-description">
              Save the search, sort, and tag criteria used by this home section. It appears in the
              default home view until you start browsing with active filters.
            </p>

            {homeStripEditor.notice ? (
              <p className={`notice notice-${homeStripEditor.notice.tone}`} aria-live="polite">
                {homeStripEditor.notice.text}
              </p>
            ) : null}

            <div className="field-grid-two">
              <div>
                <label htmlFor="home-strip-name">Section title</label>
                <input
                  id="home-strip-name"
                  type="text"
                  value={homeStripEditor.draft.name}
                  disabled={homeStripEditor.saving}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateHomeStripDraft((draft) => ({
                      ...draft,
                      name: event.target.value
                    }))
                  }
                />
              </div>
              <div>
                <label htmlFor="home-strip-row-count">Rows</label>
                <select
                  id="home-strip-row-count"
                  value={String(homeStripEditor.draft.rowCount)}
                  disabled={homeStripEditor.saving}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateHomeStripDraft((draft) => ({
                      ...draft,
                      rowCount: normalizeCatalogHomeStripRowCount(event.target.value)
                    }))
                  }
                >
                  <option value="1">1 row</option>
                  <option value="2">2 rows</option>
                  <option value="3">3 rows</option>
                </select>
              </div>
            </div>

            <div className="field-grid-two">
              <div>
                <label htmlFor="home-strip-sort">Sort by</label>
                <select
                  id="home-strip-sort"
                  value={homeStripEditor.draft.sortCategory}
                  disabled={homeStripEditor.saving}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateHomeStripDraft((draft) => ({
                      ...draft,
                      sortCategory: event.target.value as CatalogSortCategory
                    }))
                  }
                >
                  {Object.entries(CATALOG_SORT_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="home-strip-sort-direction">Direction</label>
                <select
                  id="home-strip-sort-direction"
                  value={homeStripEditor.draft.sortDirection}
                  disabled={homeStripEditor.saving || homeStripEditor.draft.sortCategory === 'random'}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateHomeStripDraft((draft) => ({
                      ...draft,
                      sortDirection: event.target.value as CatalogSortDirection
                    }))
                  }
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="home-strip-search">Search term</label>
              <input
                id="home-strip-search"
                type="search"
                value={homeStripEditor.draft.search}
                placeholder="Optional search text"
                disabled={homeStripEditor.saving}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateHomeStripDraft((draft) => ({
                    ...draft,
                    search: event.target.value
                  }))
                }
              />
            </div>

            <section className="tag-filter-section home-strip-editor-tags" aria-labelledby="home-strip-editor-tags-heading">
              <div className="filter-section-heading">
                <h3 id="home-strip-editor-tags-heading">Tag filters</h3>
                <span className="tag-selected-count">{homeStripDraftActiveTagCount}</span>
              </div>
              <p className="filter-section-description">
                Included tags are required. Excluded tags remove matching items from this saved section.
              </p>

              {homeStripDraftActiveTagCount > 0 ? (
                <div className="tag-filter-selected-groups">
                  {homeStripDraftSelectedTags.length > 0 ? (
                    <div className="tag-filter-mode-group" aria-label="Included home section tag filters">
                      <span className="tag-filter-mode-label">Included</span>
                      <div className="selected-tag-list">
                        {homeStripDraftSelectedTags.map((tag) => (
                          <span className="selected-tag-chip is-included" key={tag.id}>
                            <span className="tag-filter-chip-mode">Include</span>
                            <span className="tag-filter-chip-label">{tag.label}</span>
                            <button
                              type="button"
                              className="selected-tag-chip-mode-button"
                              disabled={homeStripEditor.saving}
                              onClick={() => addHomeStripDraftTag(tag, 'exclude')}
                              aria-label={`Exclude ${tag.label} instead`}
                              title={`Exclude ${tag.label} instead`}
                            >
                              Exclude
                            </button>
                            <button
                              type="button"
                              className="selected-tag-chip-remove-button"
                              disabled={homeStripEditor.saving}
                              onClick={() => removeHomeStripDraftTag(tag.id)}
                              aria-label={`Remove ${tag.label} home section filter`}
                              title={`Remove ${tag.label}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {homeStripDraftExcludedTags.length > 0 ? (
                    <div className="tag-filter-mode-group" aria-label="Excluded home section tag filters">
                      <span className="tag-filter-mode-label">Excluded</span>
                      <div className="selected-tag-list">
                        {homeStripDraftExcludedTags.map((tag) => (
                          <span className="selected-tag-chip is-excluded" key={tag.id}>
                            <span className="tag-filter-chip-mode">Exclude</span>
                            <span className="tag-filter-chip-label">{tag.label}</span>
                            <button
                              type="button"
                              className="selected-tag-chip-mode-button"
                              disabled={homeStripEditor.saving}
                              onClick={() => addHomeStripDraftTag(tag, 'include')}
                              aria-label={`Include ${tag.label} instead`}
                              title={`Include ${tag.label} instead`}
                            >
                              Include
                            </button>
                            <button
                              type="button"
                              className="selected-tag-chip-remove-button"
                              disabled={homeStripEditor.saving}
                              onClick={() => removeHomeStripDraftTag(tag.id)}
                              aria-label={`Remove ${tag.label} home section exclusion`}
                              title={`Remove ${tag.label}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="filter-section-description">Leave tags empty to match the whole catalog.</p>
              )}

              <div className="tag-filter-input-wrap">
                <input
                  id="home-strip-tag-search"
                  type="search"
                  value={homeStripEditor.draft.tagSearch}
                  placeholder="Search tags to add"
                  disabled={homeStripEditor.saving}
                  autoComplete="off"
                  onFocus={() => setIsHomeStripTagSearchFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsHomeStripTagSearchFocused(false), 120);
                  }}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateHomeStripDraft((draft) => ({
                      ...draft,
                      tagSearch: event.target.value
                    }))
                  }
                />

                {homeStripEditor.draft.tagSearch.trim() !== '' && isHomeStripTagSearchFocused ? (
                  <div className="tag-filter-suggestion-list" role="listbox" aria-label="Matching home section tags">
                    {visibleHomeStripTagSuggestions.length > 0 ? (
                      visibleHomeStripTagSuggestions.map((tag) => (
                        <div className="tag-filter-suggestion-row" key={tag.id} role="option" aria-selected="false">
                          <span className="tag-filter-suggestion-copy">
                            <span>{tag.label}</span>
                            <span className="tag-usage-count">{tag.usageCount}</span>
                          </span>
                          <span className="tag-filter-suggestion-actions">
                            <button
                              type="button"
                              className="tag-mode-button include"
                              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                              onClick={() => addHomeStripDraftTag(tag, 'include')}
                            >
                              Include
                            </button>
                            <button
                              type="button"
                              className="tag-mode-button exclude"
                              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
                              onClick={() => addHomeStripDraftTag(tag, 'exclude')}
                            >
                              Exclude
                            </button>
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="empty-inline-state">No matching tags.</div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="tag-options-list tag-filter-action-list" role="group" aria-label="Available home section tags">
                {homeStripEditorAvailableTagOptions.length > 0 ? (
                  homeStripEditorAvailableTagOptions.map((tag) => {
                    const isIncluded = homeStripEditor.draft.selectedTagIds.includes(tag.id);
                    const isExcluded = homeStripEditor.draft.excludedTagIds.includes(tag.id);

                    return (
                      <div
                        className={`tag-filter-option${isIncluded ? ' is-included' : ''}${
                          isExcluded ? ' is-excluded' : ''
                        }`}
                        key={tag.id}
                      >
                        <span className="tag-filter-option-copy">
                          <span className="tag-filter-option-label">{tag.label}</span>
                          <span className="tag-usage-count">{tag.usageCount}</span>
                        </span>
                        <span className="tag-filter-option-actions">
                          <button
                            type="button"
                            className={`tag-mode-button include${isIncluded ? ' is-active' : ''}`}
                            disabled={homeStripEditor.saving}
                            onClick={() => toggleHomeStripDraftTag(tag, 'include')}
                            aria-pressed={isIncluded}
                          >
                            Include
                          </button>
                          <button
                            type="button"
                            className={`tag-mode-button exclude${isExcluded ? ' is-active' : ''}`}
                            disabled={homeStripEditor.saving}
                            onClick={() => toggleHomeStripDraftTag(tag, 'exclude')}
                            aria-pressed={isExcluded}
                          >
                            Exclude
                          </button>
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-inline-state">No additional tags available.</div>
                )}
              </div>
            </section>

            <div className="modal-actions">
              <button
                type="button"
                className="app-button secondary"
                disabled={homeStripEditor.saving}
                onClick={applyCurrentFiltersToHomeStripDraft}
              >
                Use current filters
              </button>
              <button
                type="button"
                className="app-button secondary"
                disabled={homeStripEditor.saving}
                onClick={() => {
                  setHomeStripEditor(null);
                  setHomeStripTagSuggestions([]);
                  setIsHomeStripTagSearchFocused(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="app-button"
                disabled={homeStripEditor.saving || normalizeHomeStripText(homeStripEditor.draft.name) === ''}
              >
                {homeStripEditor.saving ? 'Saving…' : 'Save section'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isAddVideoModalOpen && (
        <Modal
          title="Add Video"
          titleId="add-video-modal-title"
          onClose={() => {
            void closeAddVideoModal();
          }}
          disableClose={isAddVideoBusy}
          size="wide"
        >
          <div className="mode-switch" role="tablist" aria-label="Add video mode">
            <button
              type="button"
              role="tab"
              aria-selected={addVideoMode === 'upload'}
              className={`mode-switch-button${addVideoMode === 'upload' ? ' is-active' : ''}`}
              onClick={() => setAddVideoMode('upload')}
              disabled={pendingIngest !== null || isAddVideoBusy}
            >
              Upload file
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={addVideoMode === 'yt_dlp'}
              className={`mode-switch-button${addVideoMode === 'yt_dlp' ? ' is-active' : ''}`}
              onClick={() => setAddVideoMode('yt_dlp')}
              disabled={!toolAvailability.ytDlp || pendingIngest !== null || isAddVideoBusy}
            >
              Import URL
            </button>
          </div>

          <div className="info-panel">
            {addVideoMode === 'upload' ? (
              <p>
                Uploads stage into pending ingest first. You can confirm or edit the catalog title
                before finalization, duplicate checks still run before processing, and downstream FFmpeg
                processing is shown live over WebSocket.
              </p>
            ) : (
              <p>
                yt-dlp imports run metadata preflight first, suggest an extracted catalog title for
                confirmation, resolve duplicates before download, and then expose source download plus
                post-download processing live over WebSocket.
              </p>
            )}
          </div>

          {addVideoNotice && (
            <p className={`notice notice-${addVideoNotice.tone}`} aria-live="polite">
              {addVideoNotice.text}
            </p>
          )}

          {pendingIngest ? (
            <div className={pendingIngestHasDuplicateConflicts ? 'duplicate-layout' : 'title-confirmation-layout'}>
              <section className="duplicate-summary" aria-labelledby="duplicate-summary-title">
                <div className="section-heading">
                  <h3 id="duplicate-summary-title">
                    {pendingIngestHasDuplicateConflicts ? 'Duplicate warning' : 'Confirm catalog title'}
                  </h3>
                  <span className="source-pill">{SOURCE_TYPE_LABELS[pendingIngest.sourceType]}</span>
                </div>

                {pendingIngest.processing && (
                  <div className="inline-progress-panel">
                    <div className="inline-progress-top-row">
                      <strong>{PROCESSING_STAGE_LABELS[pendingIngest.processing.stage]}</strong>
                      <span>{formatPercent(pendingIngest.processing.percent)}</span>
                    </div>
                    <p>{pendingIngest.processing.message}</p>
                    <ProgressMeter
                      percent={pendingIngest.processing.percent}
                      label={`${getPendingIngestDisplayName(pendingIngest)} pending ingest progress`}
                    />
                  </div>
                )}

                {pendingIngestHasDuplicateConflicts ? (
                  <>
                    <div className="reason-badges">
                      {duplicateReasonCodes.map((code) => (
                        <span className="reason-badge" key={code}>
                          {DUPLICATE_REASON_LABELS[code]}
                        </span>
                      ))}
                    </div>
                    <div className="reason-list">
                      {duplicateReasonCodes.map((code) => (
                        <p key={code}>{DUPLICATE_REASON_DESCRIPTIONS[code]}</p>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="info-panel info-panel-compact">
                    <p>
                      No duplicate conflicts were detected. Confirm or edit the title that will appear
                      in the catalog before this item is finalized.
                    </p>
                  </div>
                )}
                <label htmlFor="duplicate-visible-name">
                  {pendingIngestHasDuplicateConflicts
                    ? 'Visible name for this incoming item'
                    : 'Catalog title for this item'}
                </label>
                <input
                  id="duplicate-visible-name"
                  type="text"
                  value={duplicateVisibleName}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDuplicateVisibleName(event.target.value)
                  }
                  disabled={isAddVideoBusy}
                  placeholder={pendingIngest.originalIngestName}
                />
                <div className="duplicate-context muted">
                  <p>
                    Incoming name: <strong>{pendingIngest.originalIngestName}</strong>
                  </p>
                  {pendingIngest.sourceUrl && (
                    <p>
                      Source URL: <code>{pendingIngest.sourceUrl}</code>
                    </p>
                  )}
                  <p>Staged size: {formatOptionalBytes(pendingIngest.sizeBytes)}</p>
                </div>
                {pendingIngest.sourceType === 'yt_dlp' && pendingIngest.downloadState === 'not_started' && (
                  <div className="info-panel info-panel-compact">
                    <p>
                      The remote media has not been downloaded yet.
                      {pendingIngestHasDuplicateConflicts ? ' Continuing' : ' Confirming this title'} will
                      create the catalog item and then start the tracked source-download stage.
                    </p>
                  </div>
                )}
                {pendingIngest.sourceType === 'yt_dlp' && pendingIngest.downloadState === 'downloaded' && (
                  <div className="info-panel info-panel-compact">
                    <p>
                      The source file is already staged for this pending import.
                      {pendingIngestHasDuplicateConflicts ? ' Continuing' : ' Confirming this title'} will
                      resume the catalog-backed processing pipeline.
                    </p>
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() => void handleDuplicateCancel()}
                    disabled={isAddVideoBusy}
                  >
                    Cancel add
                  </button>
                  <button
                    type="button"
                    className="app-button"
                    onClick={() => void handleDuplicateContinue()}
                    disabled={isAddVideoBusy}
                  >
                    {isAddVideoBusy
                      ? 'Working…'
                      : pendingIngestHasDuplicateConflicts
                        ? 'Continue'
                        : 'Confirm title'}
                  </button>
                </div>
              </section>

              {pendingIngestHasDuplicateConflicts && (
                <section className="duplicate-existing-items" aria-labelledby="duplicate-existing-title">
                  <div className="section-heading">
                    <h3 id="duplicate-existing-title">Existing catalog matches</h3>
                  </div>
                  <div className="existing-items-grid">
                  {pendingIngest.duplicateCheck.existingItems.map((item) => {
                    const itemReasonCodes = getDuplicateReasonCodesForItem(
                      pendingIngest.duplicateCheck,
                      item.id
                    );

                    return (
                      <article className="existing-item-card" key={item.id}>
                        <CatalogCardMedia item={item} compact />
                        <div className="existing-item-body">
                          <h4 title={getCatalogItemDisplayName(item)}>{getCatalogItemDisplayName(item)}</h4>
                          <div className="reason-badges reason-badges-compact">
                            {itemReasonCodes.map((code) => (
                              <span className="reason-badge" key={`${item.id}-${code}`}>
                                {DUPLICATE_REASON_LABELS[code]}
                              </span>
                            ))}
                          </div>
                          <dl>
                            <div>
                              <dt>Added</dt>
                              <dd>{formatTimestamp(item.uploadedAt)}</dd>
                            </div>
                            <div>
                              <dt>Duration</dt>
                              <dd>{formatDuration(item.probe?.durationSeconds ?? null)}</dd>
                            </div>
                            <div>
                              <dt>Status</dt>
                              <dd>{STATUS_LABELS[item.status]}</dd>
                            </div>
                            <div>
                              <dt>Source</dt>
                              <dd>{SOURCE_TYPE_LABELS[item.sourceType]}</dd>
                            </div>
                          </dl>
                        </div>
                      </article>
                    );
                  })}
                  </div>
                </section>
              )}
            </div>
          ) : addVideoMode === 'upload' ? (
            <form
              className="add-video-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                void handleUploadSubmit(event);
              }}
            >
              <label htmlFor="upload-file-input">Local video file</label>
              <input
                key={uploadInputKey}
                id="upload-file-input"
                type="file"
                accept="video/*"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setAddVideoNotice(null);
                }}
                disabled={isAddVideoBusy}
              />
              <p className="muted" aria-live="polite">
                {selectedFile
                  ? `Selected: ${selectedFile.name} (${formatBytes(selectedFile.size)})`
                  : addVideoPrimaryMessage}
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => {
                    void closeAddVideoModal();
                  }}
                  disabled={isAddVideoBusy}
                >
                  Close
                </button>
                <button type="submit" className="app-button" disabled={isAddVideoBusy}>
                  {isAddVideoBusy ? 'Staging upload…' : 'Stage upload'}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="add-video-form"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                void handleImportSubmit(event);
              }}
            >
              <label htmlFor="import-url-input">Video URL</label>
              <input
                id="import-url-input"
                type="url"
                value={importUrl}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setImportUrl(event.target.value);
                  setAddVideoNotice(null);
                }}
                placeholder="https://example.com/watch?v=..."
                disabled={isAddVideoBusy || !toolAvailability.ytDlp}
              />
              <p className="muted" aria-live="polite">
                {toolAvailability.ytDlp
                  ? addVideoPrimaryMessage
                  : 'yt-dlp is not available on this server, so URL import is disabled.'}
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => {
                    void closeAddVideoModal();
                  }}
                  disabled={isAddVideoBusy}
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="app-button"
                  disabled={isAddVideoBusy || !toolAvailability.ytDlp}
                >
                  {isAddVideoBusy ? 'Starting import…' : 'Start import'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {isSettingsModalOpen && (
        <Modal title="Settings" titleId="settings-modal-title" onClose={closeSettingsModal}>
          <div className="settings-panel">
            <div className="settings-row">
              <div className="settings-row-label">
                <label className="settings-label" htmlFor="idleMinutes">
                  Idle auto-lock minutes
                </label>
                <p className="settings-description">Lock the app after this many minutes without activity.</p>
              </div>
              <div className="settings-row-control">
                <input
                  id="idleMinutes"
                  type="number"
                  min={1}
                  value={idleLockMinutes}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setIdleLockMinutes(Number(event.target.value) || 1)
                  }
                />
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <label className="settings-label" htmlFor="attemptFullscreenOnOpen">
                  Viewer fullscreen
                </label>
                <p className="settings-description">Try to enter browser fullscreen when a video opens.</p>
              </div>
              <div className="settings-row-control">
                <label className="settings-toggle">
                  <input
                    id="attemptFullscreenOnOpen"
                    type="checkbox"
                    checked={attemptFullscreenOnOpen}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setAttemptFullscreenOnOpen(event.target.checked)
                    }
                  />
                  <span>{attemptFullscreenOnOpen ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <label className="settings-label" htmlFor="unlimitedTagList">
                  Visible tag list
                </label>
                <p className="settings-description">
                  Show all tag quick-picks by default, or cap the popular list to a fixed count. Active
                  tag filters stay visible.
                </p>
              </div>
              <div className="settings-row-control settings-tag-limit-control">
                <label className="settings-toggle">
                  <input
                    id="unlimitedTagList"
                    type="checkbox"
                    checked={visibleTagListSettings.mode === 'unlimited'}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setVisibleTagListSettings((currentValue) => ({
                        ...currentValue,
                        mode: event.target.checked ? 'unlimited' : 'limited'
                      }))
                    }
                  />
                  <span>Unlimited</span>
                </label>
                <div className="settings-inline-number">
                  <label htmlFor="tagListLimit">Cap</label>
                  <input
                    id="tagListLimit"
                    type="number"
                    min={1}
                    value={visibleTagListSettings.limit}
                    disabled={visibleTagListSettings.mode === 'unlimited'}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setVisibleTagListSettings((currentValue) => ({
                        ...currentValue,
                        limit: normalizeVisibleTagListLimit(event.target.value)
                      }))
                    }
                  />
                  <span>tags</span>
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <div className="settings-label">Server tool updates</div>
                <p className="settings-description">
                  Check for and install updates to ffmpeg and yt-dlp on this server.
                </p>
              </div>
              <div className="settings-row-control settings-tool-update-control">
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => {
                    void updateServerSideToolsFromSettings();
                  }}
                  disabled={isToolUpdateRunning}
                  aria-busy={isToolUpdateRunning}
                >
                  {isToolUpdateRunning ? 'Updating…' : 'Update tools'}
                </button>
                <div className="settings-tool-update-feedback" aria-live="polite">
                  <p
                    className={`settings-status-message ${getToolUpdateStatusClass(
                      toolUpdateState.status
                    )}`}
                    role={toolUpdateState.status === 'error' ? 'alert' : 'status'}
                  >
                    {toolUpdateState.message}
                  </p>
                  {toolUpdateState.result && (
                    <ul className="settings-tool-update-list">
                      {toolUpdateState.result.tools.map((toolResult) => (
                        <li
                          key={toolResult.tool}
                          className={`settings-tool-update-item is-${toolResult.status}`}
                        >
                          <strong>{formatServerToolName(toolResult.tool)}</strong>
                          <span>{toolResult.message}</span>
                          <span className="settings-tool-update-meta">
                            {toolResult.attempted
                              ? `Strategy: ${toolResult.strategy}`
                              : `Not attempted: ${toolResult.strategy}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <p className="settings-note muted">
              These UI settings are currently browser-local only. Server-side persistence for settings
              is still pending.
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="app-button secondary" onClick={closeSettingsModal}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {detailsItem && (
        <CatalogItemDetailsModal
          item={detailsItem}
          onClose={() => setDetailsItemId(null)}
          onRename={renameCatalogItem}
          onDelete={deleteCatalogItem}
        />
      )}

      {viewerItem && (
        <ViewerOverlay
          item={viewerItem}
          onClose={() => {
            viewerCloseRequestedRef.current = true;
            setViewerItem(null);
          }}
          onMarkUsed={markCatalogItemUsed}
          onSetThumbnail={setCatalogItemThumbnail}
          onListBookmarks={listCatalogItemBookmarks}
          onCreateBookmark={createCatalogItemBookmark}
          onUpdateBookmarkName={updateCatalogItemBookmarkName}
          onUseBookmark={useCatalogItemBookmark}
          onDeleteBookmark={deleteCatalogItemBookmark}
          onSaveViewerVisualAdjustments={saveCatalogItemViewerVisualAdjustments}
          attemptFullscreenOnOpen={attemptFullscreenOnOpen}
        />
      )}
    </div>
  );
}
