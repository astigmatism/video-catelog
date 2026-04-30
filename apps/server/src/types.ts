export type ToolAvailability = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ytDlp: boolean;
};

export type CatalogItemSourceType = 'upload' | 'yt_dlp';

export type CatalogItemStatus =
  | 'uploaded'
  | 'pending_duplicate_check'
  | 'pending_processing'
  | 'processing'
  | 'ready'
  | 'failed';

export type DuplicateReasonCode =
  | 'same_name'
  | 'exact_checksum'
  | 'same_source_url'
  | 'same_source_site_remote_id';

export type DuplicateReason = {
  code: DuplicateReasonCode;
  existingItemId: string;
};

export type DuplicateCheck = {
  hasConflicts: boolean;
  reasons: DuplicateReason[];
  existingItems: CatalogItem[];
};

export type PendingIngestDownloadState = 'not_started' | 'downloaded';

export type ProcessingStage =
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

export type ProcessingSnapshot = {
  stage: ProcessingStage;
  percent: number | null;
  message: string;
  updatedAt: string;
};

export type HoverPreviewSprite = {
  relativePath: string;
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
};

export type MediaProbeInfo = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  audioPresent: boolean | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioCodecs?: string[];
  pixelFormat: string | null;
  containerFormat: string | null;
  estimatedFrameCount: number | null;
  isBrowserSafeInput: boolean | null;
};

export type ViewerVisualAdjustments = {
  contrast: number;
  brightness: number;
  saturation: number;
  enabled: boolean;
};

export type CatalogTag = {
  id: string;
  label: string;
  normalizedLabel: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CatalogHomeStripRowCount = 1 | 2 | 3;

export type CatalogHomeStripSortCategory =
  | 'uploadedAt'
  | 'name'
  | 'duration'
  | 'viewCount'
  | 'usedCount'
  | 'downloadCount'
  | 'lastViewedAt'
  | 'resolution'
  | 'random';

export type CatalogHomeStripSortDirection = 'asc' | 'desc';

export type CatalogHomeStrip = {
  id: string;
  name: string;
  displayOrder: number;
  rowCount: CatalogHomeStripRowCount;
  sortCategory: CatalogHomeStripSortCategory;
  sortDirection: CatalogHomeStripSortDirection;
  search: string | null;
  tagIds: string[];
  excludedTagIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type CatalogHomeStripListPayload = {
  strips: CatalogHomeStrip[];
};

export type CatalogItem = {
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

export type CatalogBookmark = {
  id: string;
  catalogItemId: string;
  name: string | null;
  timeSeconds: number;
  thumbnailRelativePath: string;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PendingIngest = {
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

export type DuplicateResolutionAction = 'continue' | 'cancel';

export type SessionRecord = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  lockedAt: number | null;
};

export type StorageUsageInfo = {
  storagePath: string;
  filesystemPath: string;
  usedBytes: number;
  totalBytes: number;
  percentUsed: number;
};

export type RuntimeStatePayload = {
  toolAvailability: ToolAvailability;
  config: {
    idleLockMinutes: number;
    wsHeartbeatMs: number;
    port?: number;
  };
  storageUsage: StorageUsageInfo | null;
};

export type CatalogQuerySort = 'newest' | 'oldest' | 'name_asc' | 'name_desc';

export type CatalogQueryInput = {
  search: string | null;
  sourceType: CatalogItemSourceType | null;
  status: CatalogItemStatus | null;
  tagIds: string[];
  excludedTagIds: string[];
  sort: CatalogQuerySort;
};

export type CatalogQueryResult = {
  items: CatalogItem[];
  totalCount: number;
  filter: CatalogQueryInput;
};

export type CatalogTagListPayload = {
  tags: CatalogTag[];
};

export type PendingIngestListPayload = {
  pendingIngests: PendingIngest[];
  totalCount: number;
};

export type SocketSubscriptions = {
  jobs: boolean;
};

export type SocketStateSnapshot = {
  serverTime: string;
  catalog: CatalogQueryResult;
  pendingIngests: PendingIngestListPayload;
  homeStrips: CatalogHomeStripListPayload;
  runtime: RuntimeStatePayload;
  subscriptions: SocketSubscriptions;
  connection: {
    connectionId: string;
    sessionBound: true;
  };
};

export type JobEventStatus = CatalogItemStatus | 'pending';

export type JobEventData = {
  targetKind: 'catalog_item' | 'pending_ingest';
  itemId: string | null;
  pendingIngestId: string | null;
  sourceType: CatalogItemSourceType;
  visibleName: string;
  status: JobEventStatus;
  processing: ProcessingSnapshot;
};

export type VideoProcessingStateChangedEventData = {
  itemId: string;
  status: CatalogItemStatus;
  processing: ProcessingSnapshot | null;
};

export type CatalogDeltaEventData =
  | {
      op: 'upsert';
      item: CatalogItem;
    }
  | {
      op: 'delete';
      itemId: string;
    };

export type AuthTerminationReason = 'panic' | 'logout' | 'expired' | 'unauthenticated';

export type AuthTerminationEventData = {
  locked: true;
  reason: AuthTerminationReason;
};

export type IngestSocketResponse =
  | {
      ok: true;
      requiresResolution: false;
      item: CatalogItem;
    }
  | {
      ok: true;
      requiresResolution: true;
      pendingIngest: PendingIngest;
      duplicateCheck: DuplicateCheck;
    }
  | {
      ok: true;
      cancelled: true;
    }
  | {
      ok: false;
      message: string;
    };

export type SocketCommandName =
  | 'auth.ping'
  | 'auth.lock'
  | 'state.sync'
  | 'catalog.query'
  | 'catalog.refresh'
  | 'homeStrips.list'
  | 'video.get'
  | 'pendingIngests.list'
  | 'runtime.get'
  | 'jobs.subscribe'
  | 'import.ytdlp.create'
  | 'upload.duplicate.resolve'
  | 'import.duplicate.resolve';

export type SocketErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED_COMMAND'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type SocketErrorPayload = {
  code: SocketErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export type SocketCommandMessage = {
  id: string;
  type: 'cmd';
  name: SocketCommandName;
  payload?: unknown;
};

export type SocketAckData =
  | {
      serverTime: string;
    }
  | {
      locked: true;
    }
  | {
      subscriptions: SocketSubscriptions;
    }
  | CatalogQueryResult
  | CatalogItem
  | CatalogHomeStripListPayload
  | CatalogTagListPayload
  | PendingIngestListPayload
  | RuntimeStatePayload
  | SocketStateSnapshot
  | IngestSocketResponse;

export type SocketAckMessage =
  | {
      id: string;
      type: 'ack';
      ok: true;
      data: SocketAckData;
    }
  | {
      id: string;
      type: 'ack';
      ok: false;
      error: SocketErrorPayload;
    };

export type SocketEventMessage =
  | {
      type: 'evt';
      name: 'state.snapshot';
      data: SocketStateSnapshot;
    }
  | {
      type: 'evt';
      name: 'catalog.delta';
      data: CatalogDeltaEventData;
    }
  | {
      type: 'evt';
      name: 'video.updated';
      data: CatalogItem;
    }
  | {
      type: 'evt';
      name: 'video.processingStateChanged';
      data: VideoProcessingStateChangedEventData;
    }
  | {
      type: 'evt';
      name: 'pendingIngest.updated';
      data: PendingIngest;
    }
  | {
      type: 'evt';
      name: 'pendingIngest.deleted';
      data: {
        id: string;
      };
    }
  | {
      type: 'evt';
      name: 'homeStrips.updated';
      data: CatalogHomeStripListPayload;
    }
  | {
      type: 'evt';
      name: 'runtime.updated';
      data: RuntimeStatePayload;
    }
  | {
      type: 'evt';
      name: 'job.progress';
      data: JobEventData;
    }
  | {
      type: 'evt';
      name: 'job.completed';
      data: JobEventData;
    }
  | {
      type: 'evt';
      name: 'job.failed';
      data: JobEventData;
    }
  | {
      type: 'evt';
      name: 'auth.locked';
      data: AuthTerminationEventData;
    }
  | {
      type: 'evt';
      name: 'auth.expired';
      data: AuthTerminationEventData;
    };

export type LegacySocketMessage =
  | { type: 'welcome'; payload: { serverTime: string } }
  | { type: 'pong'; payload: { serverTime: string } }
  | { type: 'catalog:list'; payload: CatalogItem[] }
  | { type: 'catalog:item-updated'; payload: CatalogItem }
  | { type: 'pending-ingests:list'; payload: PendingIngest[] }
  | { type: 'pending-ingest-updated'; payload: PendingIngest }
  | { type: 'pending-ingest-deleted'; payload: { id: string } }
  | { type: 'runtime'; payload: RuntimeStatePayload }
  | { type: 'panic'; payload: { locked: true } }
  | { type: 'error'; payload: { message: string } };

export type SocketMessage = LegacySocketMessage | SocketAckMessage | SocketEventMessage;
