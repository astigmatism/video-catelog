import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { CatalogStore, normalizeCatalogTagLabel } from './catalog-store';
import { loadConfig } from './config';
import { createDatabasePool } from './db';
import { SessionStore } from './session-store';
import { detectToolAvailability, updateServerSideTools, type ServerToolUpdateResult } from './tooling';
import { ThumbnailMemoryCache, type CachedThumbnailFile } from './thumbnail-cache';
import type {
  AuthTerminationReason,
  CatalogBookmark,
  CatalogItem,
  CatalogItemStatus,
  CatalogItemSourceType,
  CatalogQueryInput,
  CatalogQueryResult,
  CatalogQuerySort,
  DuplicateCheck,
  DuplicateReason,
  DuplicateReasonCode,
  DuplicateResolutionAction,
  HoverPreviewSprite,
  IngestSocketResponse,
  JobEventData,
  MediaProbeInfo,
  PendingIngest,
  PendingIngestListPayload,
  ProcessingSnapshot,
  RuntimeStatePayload,
  SocketAckData,
  StorageUsageInfo,
  SocketCommandMessage,
  SocketErrorCode,
  SocketMessage,
  SocketStateSnapshot,
  SocketSubscriptions,
  ViewerVisualAdjustments
} from './types';

const config = loadConfig();
const databasePool = createDatabasePool(config);
const catalogStore = new CatalogStore({
  pool: databasePool
});
const sessionStore = new SessionStore(config.sessionTtlMinutes);
const app = Fastify({
  logger: true,
  trustProxy: config.trustProxy
});

app.addHook('onClose', async () => {
  await catalogStore.close();
});

type IngestSuccessResponse = {
  ok: true;
  requiresResolution: false;
  item: CatalogItem;
};

type IngestDuplicateResponse = {
  ok: true;
  requiresResolution: true;
  pendingIngest: PendingIngest;
  duplicateCheck: DuplicateCheck;
};

type IngestErrorResponse = {
  ok: false;
  message: string;
};

type IngestCancelResponse = {
  ok: true;
  cancelled: true;
};

type IngestHttpResponse =
  | IngestSuccessResponse
  | IngestDuplicateResponse
  | IngestErrorResponse
  | IngestCancelResponse;

type SessionSocket = {
  send(data: string): void;
  close(code?: number, data?: string): void;
  on(event: 'message', listener: (raw: Buffer | string) => void): void;
  on(event: 'close', listener: (code?: number, reason?: Buffer) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

type SessionSocketConnection = SessionSocket | { socket?: SessionSocket };

type SessionSocketState = {
  connectionId: string;
  sessionId: string;
  socket: SessionSocket;
  subscriptions: SocketSubscriptions;
  connectedAt: string;
  rateWindowStartedAt: number;
  messageCount: number;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type YtDlpMetadata = {
  title: string;
  sourceUrl: string;
  sourceSite: string | null;
  sourceRemoteId: string | null;
};

type PipelineLogLevel = 'info' | 'warn' | 'error';

type PipelineLogContext = {
  sessionId?: string | null;
  pendingIngestId?: string | null;
  itemId?: string | null;
  sourceType?: PendingIngest['sourceType'];
  visibleName?: string | null;
  sourceUrl?: string | null;
};

type RunCommandOptions = {
  commandLabel?: string;
  logContext?: PipelineLogContext;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  captureStdoutLines?: boolean;
  captureStderrLines?: boolean;
};

const DEFAULT_SOCKET_SUBSCRIPTIONS: SocketSubscriptions = {
  jobs: true
};

const WS_MAX_MESSAGE_BYTES = 64 * 1024;
const WS_RATE_WINDOW_MS = 10_000;
const WS_MAX_COMMANDS_PER_WINDOW = 120;
const SESSION_SWEEP_MS = 15_000;
const STORAGE_USAGE_CACHE_TTL_MS = 30_000;

const socketsBySessionId = new Map<string, Map<string, SessionSocketState>>();

type ProcessingQueueEntry = {
  itemId: string;
  requestedBySessionId: string | null;
  enqueuedAt: string;
};

type RetentionDecision = 'keep' | 'remux' | 'transcode';

type MediaRetentionPlan = {
  decision: RetentionDecision;
  outputExtension: string;
  description: string;
  inputIsBrowserSafe: boolean;
};

type CatalogItemFileDescriptor = {
  storedName: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
};

type CatalogItemMutablePatch = Partial<
  Omit<CatalogItem, 'id' | 'uploadedAt' | 'status' | 'processing'>
>;

type FfprobeStreamJson = {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  avg_frame_rate?: unknown;
  r_frame_rate?: unknown;
  pix_fmt?: unknown;
  duration?: unknown;
};

type FfprobeFormatJson = {
  format_name?: unknown;
  duration?: unknown;
};

type FfprobeResultJson = {
  streams?: unknown;
  format?: unknown;
};

type FfmpegProgressState = {
  frame: number | null;
  fps: number | null;
  outTimeSeconds: number | null;
  speed: string | null;
};

const processingQueue: ProcessingQueueEntry[] = [];
const queuedProcessingItemIds = new Set<string>();
const activeProcessingItemIds = new Set<string>();
const activeCommandProcessesByItemId = new Map<string, Set<ChildProcessWithoutNullStreams | ReturnType<typeof spawn>>>();
let isProcessingQueueRunning = false;
let isServerToolUpdateRunning = false;

const HOVER_SPRITE_FRAME_COUNT = 100;
const HOVER_SPRITE_COLUMNS = 10;
const HOVER_SPRITE_ROWS = 10;
const HOVER_SPRITE_FRAME_WIDTH = 160;
const HOVER_SPRITE_FRAME_HEIGHT = 90;
const POSTER_THUMBNAIL_WIDTH = 480;
const THUMBNAIL_CACHE_MAX_ENTRIES = 768;
const THUMBNAIL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const THUMBNAIL_CACHE_MAX_FILE_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_BROWSER_CACHE_CONTROL = 'private, max-age=86400, immutable';

const thumbnailCache = new ThumbnailMemoryCache({
  maxEntries: THUMBNAIL_CACHE_MAX_ENTRIES,
  maxBytes: THUMBNAIL_CACHE_MAX_BYTES,
  maxFileBytes: THUMBNAIL_CACHE_MAX_FILE_BYTES
});

const UPLOAD_DUPLICATE_REASON_CODES: DuplicateReasonCode[] = [
  'same_name',
  'exact_checksum',
  'same_source_url'
];

const YT_DLP_PRE_DOWNLOAD_DUPLICATE_REASON_CODES: DuplicateReasonCode[] = [
  'same_name',
  'same_source_url',
  'same_source_site_remote_id'
];

app.register(fastifyCookie);
app.register(fastifyMultipart, {
  limits: {
    fileSize: config.maxUploadBytes
  }
});
app.register(fastifyWebsocket);

function parseCookieHeader(
  cookieHeader: string | string[] | undefined
): Record<string, string> {
  const rawHeader = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
  if (typeof rawHeader !== 'string' || rawHeader.trim() === '') {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const fragment of rawHeader.split(';')) {
    const trimmedFragment = fragment.trim();
    if (trimmedFragment === '') {
      continue;
    }

    const equalsIndex = trimmedFragment.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmedFragment.slice(0, equalsIndex).trim();
    const rawValue = trimmedFragment.slice(equalsIndex + 1).trim();
    if (key === '') {
      continue;
    }

    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }

  return cookies;
}

function getSessionId(request: FastifyRequest): string | undefined {
  const directCookieValue = request.cookies?.[config.cookieName];
  if (typeof directCookieValue === 'string' && directCookieValue !== '') {
    return directCookieValue;
  }

  const headerCookieValue = parseCookieHeader(request.headers.cookie)[config.cookieName];
  if (typeof headerCookieValue === 'string' && headerCookieValue !== '') {
    return headerCookieValue;
  }

  return undefined;
}

function getToolCommandConfig(): {
  ffmpegCommand: string;
  ffprobeCommand: string;
  ytDlpCommand: string;
} {
  return {
    ffmpegCommand: config.ffmpegCommand,
    ffprobeCommand: config.ffprobeCommand,
    ytDlpCommand: config.ytDlpCommand
  };
}

let cachedStorageUsage: { expiresAt: number; value: StorageUsageInfo | null } | null = null;
let lastStorageUsageWarningKey: string | null = null;

function resolveExistingPathForFilesystemStats(targetPath: string): string {
  let candidatePath = path.resolve(targetPath);

  while (!fs.existsSync(candidatePath)) {
    const parentPath = path.dirname(candidatePath);
    if (parentPath === candidatePath) {
      return candidatePath;
    }

    candidatePath = parentPath;
  }

  return candidatePath;
}

function createStorageUsagePayload(): StorageUsageInfo | null {
  const now = Date.now();
  if (cachedStorageUsage && cachedStorageUsage.expiresAt > now) {
    return cachedStorageUsage.value;
  }

  const storagePath = path.resolve(config.mediaStoreRoot);
  const filesystemPath = resolveExistingPathForFilesystemStats(storagePath);

  try {
    if (typeof fs.statfsSync !== 'function') {
      throw new Error('fs.statfsSync is not available in this Node.js runtime.');
    }

    const stats = fs.statfsSync(filesystemPath);
    const blockSize = Number(stats.bsize);
    const totalBlocks = Number(stats.blocks);
    const freeBlocks = Number(stats.bfree);
    const totalBytes = totalBlocks * blockSize;
    const usedBytes = Math.max(0, (totalBlocks - freeBlocks) * blockSize);

    if (
      !Number.isFinite(blockSize) ||
      !Number.isFinite(totalBlocks) ||
      !Number.isFinite(freeBlocks) ||
      !Number.isFinite(totalBytes) ||
      !Number.isFinite(usedBytes) ||
      blockSize <= 0 ||
      totalBlocks <= 0
    ) {
      throw new Error('Filesystem statistics were incomplete or invalid.');
    }

    const value: StorageUsageInfo = {
      storagePath,
      filesystemPath,
      usedBytes,
      totalBytes,
      percentUsed: Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100))
    };

    cachedStorageUsage = {
      expiresAt: now + STORAGE_USAGE_CACHE_TTL_MS,
      value
    };
    lastStorageUsageWarningKey = null;
    return value;
  } catch (error) {
    const warningKey = error instanceof Error ? error.message : String(error);
    if (warningKey !== lastStorageUsageWarningKey) {
      app.log.warn(
        {
          event: 'storage.usage.unavailable',
          storagePath,
          filesystemPath,
          err: error
        },
        'Unable to determine media storage filesystem usage.'
      );
      lastStorageUsageWarningKey = warningKey;
    }

    cachedStorageUsage = {
      expiresAt: now + STORAGE_USAGE_CACHE_TTL_MS,
      value: null
    };
    return null;
  }
}

function createRuntimeStatePayload(includePort: boolean = true): RuntimeStatePayload {
  return {
    toolAvailability: detectToolAvailability(getToolCommandConfig()),
    config: {
      idleLockMinutes: config.idleLockMinutes,
      wsHeartbeatMs: config.wsHeartbeatMs,
      ...(includePort ? { port: config.port } : {})
    },
    storageUsage: createStorageUsagePayload()
  };
}

async function evaluateUploadDuplicateCheck(input: {
  visibleName: string;
  incomingChecksumSha256?: string | null;
  sourceUrl?: string | null;
  excludeItemId?: string | null;
}): Promise<DuplicateCheck> {
  return await catalogStore.evaluateDuplicateCheck({
    ...input,
    signals: UPLOAD_DUPLICATE_REASON_CODES
  });
}

async function evaluateYtDlpPreDownloadDuplicateCheck(input: {
  visibleName: string;
  sourceUrl?: string | null;
  sourceSite?: string | null;
  sourceRemoteId?: string | null;
  excludeItemId?: string | null;
}): Promise<DuplicateCheck> {
  return await catalogStore.evaluateDuplicateCheck({
    ...input,
    signals: YT_DLP_PRE_DOWNLOAD_DUPLICATE_REASON_CODES
  });
}

function createDefaultCatalogQueryInput(): CatalogQueryInput {
  return {
    search: null,
    sourceType: null,
    status: null,
    tagIds: [],
    sort: 'newest'
  };
}

function isCatalogQuerySort(value: string): value is CatalogQuerySort {
  return value === 'newest' || value === 'oldest' || value === 'name_asc' || value === 'name_desc';
}

function queryCatalog(input: CatalogQueryInput = createDefaultCatalogQueryInput()): CatalogQueryResult {
  const normalizedSearch = input.search ? input.search.trim().toLowerCase() : '';
  const selectedTagIds = Array.from(
    new Set(input.tagIds.map((tagId) => tagId.trim()).filter((tagId) => tagId !== ''))
  );

  const filtered = catalogStore.list().filter((item) => {
    if (input.sourceType && item.sourceType !== input.sourceType) {
      return false;
    }

    if (input.status && item.status !== input.status) {
      return false;
    }

    if (selectedTagIds.length > 0) {
      const itemTagIds = new Set(item.tags.map((tag) => tag.id));
      if (!selectedTagIds.every((tagId) => itemTagIds.has(tagId))) {
        return false;
      }
    }

    if (normalizedSearch !== '') {
      const haystack = [
        item.visibleName,
        item.originalIngestName,
        item.sourceUrl,
        item.sourceSite,
        item.sourceRemoteId,
        item.processing?.message ?? null,
        ...item.tags.map((tag) => tag.label)
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });

  switch (input.sort) {
    case 'oldest':
      filtered.sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt));
      break;
    case 'name_asc':
      filtered.sort((left, right) => left.visibleName.localeCompare(right.visibleName));
      break;
    case 'name_desc':
      filtered.sort((left, right) => right.visibleName.localeCompare(left.visibleName));
      break;
    case 'newest':
    default:
      filtered.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
      break;
  }

  return {
    items: filtered,
    totalCount: filtered.length,
    filter: {
      search: normalizedSearch === '' ? null : input.search?.trim() ?? null,
      sourceType: input.sourceType ?? null,
      status: input.status ?? null,
      tagIds: selectedTagIds,
      sort: input.sort
    }
  };
}

function createPendingIngestListPayload(): PendingIngestListPayload {
  const pendingIngests = catalogStore.listPendingIngests();
  return {
    pendingIngests,
    totalCount: pendingIngests.length
  };
}

function createSocketStateSnapshot(
  socketState: SessionSocketState,
  catalogQuery: CatalogQueryInput = createDefaultCatalogQueryInput()
): SocketStateSnapshot {
  return {
    serverTime: new Date().toISOString(),
    catalog: queryCatalog(catalogQuery),
    pendingIngests: createPendingIngestListPayload(),
    runtime: createRuntimeStatePayload(),
    subscriptions: {
      ...socketState.subscriptions
    },
    connection: {
      connectionId: socketState.connectionId,
      sessionBound: true
    }
  };
}

function isSessionSocket(value: unknown): value is SessionSocket {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.send === 'function' &&
    typeof candidate.close === 'function' &&
    typeof candidate.on === 'function'
  );
}

function resolveSessionSocket(connection: SessionSocketConnection | unknown): SessionSocket | null {
  if (isSessionSocket(connection)) {
    return connection;
  }

  if (typeof connection === 'object' && connection !== null) {
    const candidate = connection as Record<string, unknown>;
    if (isSessionSocket(candidate.socket)) {
      return candidate.socket;
    }
  }

  return null;
}

function closeSocketConnection(connection: unknown, code: number, reason: string): void {
  const socket = resolveSessionSocket(connection);
  if (socket) {
    try {
      socket.close(code, reason);
    } catch {
      // Ignore close failures during forced teardown.
    }
    return;
  }

  if (typeof connection === 'object' && connection !== null) {
    const candidate = connection as Record<string, unknown>;

    if (typeof candidate.destroy === 'function') {
      try {
        candidate.destroy.call(connection);
      } catch {
        // Ignore destroy failures during forced teardown.
      }
      return;
    }

    if (typeof candidate.end === 'function') {
      try {
        candidate.end.call(connection);
      } catch {
        // Ignore end failures during forced teardown.
      }
    }
  }
}

function shouldDeliverSocketMessage(socketState: SessionSocketState, message: SocketMessage): boolean {
  if (message.type === 'evt') {
    if (
      (message.name === 'job.progress' ||
        message.name === 'job.completed' ||
        message.name === 'job.failed') &&
      !socketState.subscriptions.jobs
    ) {
      return false;
    }
  }

  return true;
}

function sendSocketAckSuccess(socketState: SessionSocketState, id: string, data: SocketAckData): boolean {
  return sendSocketMessage(socketState.socket, {
    id,
    type: 'ack',
    ok: true,
    data
  });
}

function sendSocketAckError(
  socketState: SessionSocketState,
  id: string,
  code: SocketErrorCode,
  message: string,
  details?: Record<string, unknown>
): boolean {
  return sendSocketMessage(socketState.socket, {
    id,
    type: 'ack',
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

function bumpSocketMessageRate(socketState: SessionSocketState): boolean {
  const now = Date.now();
  if (now - socketState.rateWindowStartedAt >= WS_RATE_WINDOW_MS) {
    socketState.rateWindowStartedAt = now;
    socketState.messageCount = 0;
  }

  socketState.messageCount += 1;
  return socketState.messageCount <= WS_MAX_COMMANDS_PER_WINDOW;
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

function abbreviateIdentifier(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 8);
}

function abbreviateChecksum(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, 12);
}

function stripAnsiSequences(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function sanitizeUrlForLogs(urlValue: string): string {
  try {
    const parsed = new URL(urlValue);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return urlValue;
  }
}

function sanitizeLogText(value: string): string {
  const withoutAnsi = stripAnsiSequences(value);
  const singleLine = withoutAnsi
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
  const redactedUrls = singleLine.replace(/https?:\/\/\S+/gi, (match) => sanitizeUrlForLogs(match));
  return redactedUrls.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function summarizeDuplicateReasons(reasons: DuplicateReason[]): string {
  if (reasons.length === 0) {
    return 'No duplicate conflicts.';
  }

  const labels = reasons.map((reason) => {
    switch (reason.code) {
      case 'same_name':
        return 'same-name';
      case 'exact_checksum':
        return 'exact-checksum';
      case 'same_source_url':
        return 'same-source-url';
      case 'same_source_site_remote_id':
        return 'same-source-site-remote-id';
      default:
        return reason.code;
    }
  });

  return labels.join(', ');
}

function extractPercentFromText(value: string): number | null {
  const match = value.match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)%/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(100, parsed));
}

function createProcessingSnapshot(
  stage: ProcessingSnapshot['stage'],
  message: string,
  percent: number | null
): ProcessingSnapshot {
  return {
    stage,
    percent: percent === null ? null : Math.max(0, Math.min(100, Number(percent.toFixed(2)))),
    message,
    updatedAt: new Date().toISOString()
  };
}

type PipelinePercentRange = {
  start: number;
  end: number;
};

const CATALOG_ITEM_PIPELINE_PERCENT_RANGES: Record<
  CatalogItemSourceType,
  Partial<Record<ProcessingSnapshot['stage'], PipelinePercentRange>>
> = {
  upload: {
    queued: { start: 3, end: 8 },
    ffprobe: { start: 10, end: 22 },
    duplicate_validation_final: { start: 22, end: 28 },
    retention_decision: { start: 28, end: 36 },
    remuxing: { start: 36, end: 70 },
    transcoding: { start: 36, end: 76 },
    poster_thumbnail: { start: 78, end: 84 },
    hover_thumbnails: { start: 84, end: 96 },
    finalizing: { start: 96, end: 99 },
    cleanup: { start: 99, end: 100 },
    completed: { start: 100, end: 100 }
  },
  yt_dlp: {
    queued: { start: 2, end: 5 },
    downloading_source: { start: 5, end: 40 },
    source_download_complete: { start: 40, end: 43 },
    ffprobe: { start: 43, end: 52 },
    retention_decision: { start: 52, end: 60 },
    remuxing: { start: 60, end: 78 },
    transcoding: { start: 60, end: 82 },
    poster_thumbnail: { start: 84, end: 89 },
    hover_thumbnails: { start: 89, end: 97 },
    finalizing: { start: 97, end: 99 },
    cleanup: { start: 99, end: 100 },
    completed: { start: 100, end: 100 }
  }
};

function interpolatePipelinePercent(
  range: PipelinePercentRange,
  stagePercent: number | null
): number {
  if (stagePercent === null) {
    return range.start;
  }

  const normalizedStagePercent = Math.max(0, Math.min(100, stagePercent));
  return range.start + ((range.end - range.start) * normalizedStagePercent) / 100;
}

function getCatalogItemPipelinePercent(
  sourceType: CatalogItemSourceType,
  stage: ProcessingSnapshot['stage'],
  stagePercent: number | null
): number | null {
  if (stage === 'failed') {
    return null;
  }

  const range = CATALOG_ITEM_PIPELINE_PERCENT_RANGES[sourceType][stage];
  if (!range) {
    return stagePercent;
  }

  return interpolatePipelinePercent(range, stagePercent);
}

function createCatalogItemProcessingSnapshotForSource(
  sourceType: CatalogItemSourceType,
  stage: ProcessingSnapshot['stage'],
  message: string,
  stagePercent: number | null
): ProcessingSnapshot {
  return createProcessingSnapshot(
    stage,
    message,
    getCatalogItemPipelinePercent(sourceType, stage, stagePercent)
  );
}

function getPendingIngestLogContext(
  pendingIngest: PendingIngest,
  sessionId?: string | null
): PipelineLogContext {
  return {
    sessionId: sessionId ?? null,
    pendingIngestId: pendingIngest.id,
    sourceType: pendingIngest.sourceType,
    visibleName: pendingIngest.visibleName,
    sourceUrl: pendingIngest.sourceUrl
  };
}

function getCatalogItemLogContext(item: CatalogItem, sessionId?: string | null): PipelineLogContext {
  return {
    sessionId: sessionId ?? null,
    itemId: item.id,
    sourceType: item.sourceType,
    visibleName: item.visibleName,
    sourceUrl: item.sourceUrl
  };
}

function writePipelineLog(
  level: PipelineLogLevel,
  event: string,
  message: string,
  context: PipelineLogContext,
  details: Record<string, unknown> = {},
  error?: unknown
): void {
  const payload: Record<string, unknown> = {
    event,
    sessionId: abbreviateIdentifier(context.sessionId),
    pendingIngestId: abbreviateIdentifier(context.pendingIngestId),
    itemId: abbreviateIdentifier(context.itemId),
    sourceType: context.sourceType ?? null,
    visibleName: context.visibleName ?? null,
    sourceUrl: context.sourceUrl ? sanitizeUrlForLogs(context.sourceUrl) : null,
    ...details
  };

  if (error) {
    payload.err = error;
  }

  switch (level) {
    case 'info':
      app.log.info(payload, message);
      break;
    case 'warn':
      app.log.warn(payload, message);
      break;
    case 'error':
      app.log.error(payload, message);
      break;
  }
}

function broadcastSocketMessage(message: SocketMessage, sessionId?: string | null): void {
  if (sessionId) {
    const socketStates = socketsBySessionId.get(sessionId);
    if (!socketStates) {
      return;
    }

    for (const socketState of socketStates.values()) {
      if (!shouldDeliverSocketMessage(socketState, message)) {
        continue;
      }

      sendSocketMessage(socketState.socket, message);
    }

    return;
  }

  for (const socketStates of socketsBySessionId.values()) {
    for (const socketState of socketStates.values()) {
      if (!shouldDeliverSocketMessage(socketState, message)) {
        continue;
      }

      sendSocketMessage(socketState.socket, message);
    }
  }
}

function createPendingIngestJobEvent(pendingIngest: PendingIngest): JobEventData | null {
  if (!pendingIngest.processing) {
    return null;
  }

  return {
    targetKind: 'pending_ingest',
    itemId: null,
    pendingIngestId: pendingIngest.id,
    sourceType: pendingIngest.sourceType,
    visibleName: pendingIngest.visibleName,
    status: pendingIngest.processing.stage === 'failed' ? 'failed' : 'pending',
    processing: pendingIngest.processing
  };
}

function createCatalogItemJobEvent(item: CatalogItem): JobEventData | null {
  if (!item.processing) {
    return null;
  }

  return {
    targetKind: 'catalog_item',
    itemId: item.id,
    pendingIngestId: null,
    sourceType: item.sourceType,
    visibleName: item.visibleName,
    status: item.status,
    processing: item.processing
  };
}

function getJobEventName(jobEvent: JobEventData): 'job.progress' | 'job.completed' | 'job.failed' {
  if (jobEvent.processing.stage === 'failed' || jobEvent.status === 'failed') {
    return 'job.failed';
  }

  if (jobEvent.processing.stage === 'completed' || jobEvent.status === 'ready') {
    return 'job.completed';
  }

  return 'job.progress';
}

function broadcastPendingIngestUpdated(
  pendingIngest: PendingIngest,
  _sessionId?: string | null
): void {
  broadcastSocketMessage({
    type: 'pending-ingest-updated',
    payload: pendingIngest
  });

  broadcastSocketMessage({
    type: 'evt',
    name: 'pendingIngest.updated',
    data: pendingIngest
  });

  const jobEvent = createPendingIngestJobEvent(pendingIngest);
  if (jobEvent) {
    broadcastSocketMessage({
      type: 'evt',
      name: getJobEventName(jobEvent),
      data: jobEvent
    });
  }
}

function broadcastPendingIngestDeleted(pendingIngestId: string, _sessionId?: string | null): void {
  broadcastSocketMessage({
    type: 'pending-ingest-deleted',
    payload: {
      id: pendingIngestId
    }
  });

  broadcastSocketMessage({
    type: 'evt',
    name: 'pendingIngest.deleted',
    data: {
      id: pendingIngestId
    }
  });
}

type CatalogItemBroadcastOptions = {
  includeProcessingEvents?: boolean;
};

function broadcastCatalogItemUpdated(
  item: CatalogItem,
  _sessionId?: string | null,
  options: CatalogItemBroadcastOptions = {}
): void {
  const includeProcessingEvents = options.includeProcessingEvents ?? true;

  broadcastSocketMessage({
    type: 'catalog:item-updated',
    payload: item
  });

  broadcastSocketMessage({
    type: 'evt',
    name: 'catalog.delta',
    data: {
      op: 'upsert',
      item
    }
  });

  broadcastSocketMessage({
    type: 'evt',
    name: 'video.updated',
    data: item
  });

  if (!includeProcessingEvents) {
    return;
  }

  broadcastSocketMessage({
    type: 'evt',
    name: 'video.processingStateChanged',
    data: {
      itemId: item.id,
      status: item.status,
      processing: item.processing
    }
  });

  const jobEvent = createCatalogItemJobEvent(item);
  if (jobEvent) {
    broadcastSocketMessage({
      type: 'evt',
      name: getJobEventName(jobEvent),
      data: jobEvent
    });
  }
}

function broadcastCatalogItemDeleted(itemId: string, _sessionId?: string | null): void {
  broadcastSocketMessage({
    type: 'evt',
    name: 'catalog.delta',
    data: {
      op: 'delete',
      itemId
    }
  });
}

async function savePendingIngestAndBroadcast(
  pendingIngest: PendingIngest,
  sessionId?: string | null
): Promise<PendingIngest> {
  const savedPendingIngest = await catalogStore.savePendingIngest(pendingIngest);
  broadcastPendingIngestUpdated(savedPendingIngest, sessionId);
  return savedPendingIngest;
}

async function updatePendingIngestAndBroadcast(
  pendingIngestId: string,
  patch: Partial<Omit<PendingIngest, 'id' | 'createdAt'>>,
  sessionId?: string | null
): Promise<PendingIngest | undefined> {
  const updatedPendingIngest = await catalogStore.updatePendingIngest(pendingIngestId, patch);
  if (updatedPendingIngest) {
    broadcastPendingIngestUpdated(updatedPendingIngest, sessionId);
  }
  return updatedPendingIngest;
}

async function updateCatalogItemAndBroadcast(
  itemId: string,
  patch: Partial<Omit<CatalogItem, 'id' | 'uploadedAt'>>,
  sessionId?: string | null,
  options: CatalogItemBroadcastOptions = {}
): Promise<CatalogItem | undefined> {
  const updatedItem = await catalogStore.updateCatalogItem(itemId, patch);
  if (updatedItem) {
    broadcastCatalogItemUpdated(updatedItem, sessionId, options);
  }
  return updatedItem;
}

async function incrementCatalogItemViewCountAndBroadcast(
  itemId: string,
  sessionId?: string | null
): Promise<CatalogItem | undefined> {
  const updatedItem = await catalogStore.incrementCatalogItemViewCount(itemId);
  if (updatedItem) {
    broadcastCatalogItemUpdated(updatedItem, sessionId, {
      includeProcessingEvents: false
    });
  }
  return updatedItem;
}

async function incrementCatalogItemUsedCountAndBroadcast(
  itemId: string,
  sessionId?: string | null
): Promise<CatalogItem | undefined> {
  const updatedItem = await catalogStore.incrementCatalogItemUsedCount(itemId);
  if (updatedItem) {
    broadcastCatalogItemUpdated(updatedItem, sessionId, {
      includeProcessingEvents: false
    });
  }
  return updatedItem;
}

async function incrementCatalogItemDownloadCountAndBroadcast(
  itemId: string,
  sessionId?: string | null
): Promise<CatalogItem | undefined> {
  const updatedItem = await catalogStore.incrementCatalogItemDownloadCount(itemId);
  if (updatedItem) {
    broadcastCatalogItemUpdated(updatedItem, sessionId, {
      includeProcessingEvents: false
    });
  }
  return updatedItem;
}

async function deleteCatalogItemAndBroadcast(
  itemId: string,
  sessionId?: string | null
): Promise<{ item: CatalogItem; bookmarks: CatalogBookmark[] } | undefined> {
  const deletedItem = await catalogStore.deleteCatalogItem(itemId);
  if (deletedItem) {
    broadcastCatalogItemDeleted(itemId, sessionId);
  }
  return deletedItem;
}

async function markPendingIngestFailed(
  pendingIngest: PendingIngest,
  message: string,
  sessionId?: string | null,
  error?: unknown
): Promise<PendingIngest> {
  const updatedPendingIngest = await savePendingIngestAndBroadcast(
    {
      ...pendingIngest,
      processing: createProcessingSnapshot('failed', message, null)
    },
    sessionId
  );

  writePipelineLog(
    'error',
    'ingest.failed',
    message,
    getPendingIngestLogContext(updatedPendingIngest, sessionId),
    {},
    error
  );

  return updatedPendingIngest;
}

function requireCatalogItemUpdate(itemId: string, item: CatalogItem | undefined): CatalogItem {
  if (!item) {
    throw new Error(`Catalog item ${itemId} no longer exists.`);
  }

  return item;
}

function getCatalogItemAbsolutePath(item: CatalogItem): string {
  const itemPath = path.join(config.mediaRoot, item.relativePath);
  console.log(`Resolved absolute path for catalog item ${item.id}: ${itemPath}`);
  return itemPath;
}

function normalizeManagedSourceExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  if (trimmed === '') {
    return '.source';
  }

  const normalized = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  if (normalized.length > 16) {
    return '.source';
  }

  return normalized;
}

function createIncomingSourceDescriptor(storedName: string): Omit<CatalogItemFileDescriptor, 'sizeBytes'> {
  const absolutePath = path.join(config.incomingRoot, storedName);
  return {
    storedName,
    absolutePath,
    relativePath: path.relative(config.mediaRoot, absolutePath)
  };
}

function createYtDlpPlaceholderStoredName(): string {
  return `${Date.now()}-${randomUUID()}.source`;
}

function createCatalogItemSourceDescriptor(
  item: CatalogItem,
  extension: string
): Omit<CatalogItemFileDescriptor, 'sizeBytes'> {
  const baseName = path.parse(item.storedName).name;
  return createIncomingSourceDescriptor(`${baseName}${normalizeManagedSourceExtension(extension)}`);
}

function findExistingCatalogItemSourceVariant(item: CatalogItem): CatalogItemFileDescriptor | null {
  const directPath = getCatalogItemAbsolutePath(item);
  if (fs.existsSync(directPath)) {
    const directStat = fs.statSync(directPath);
    if (directStat.isFile()) {
      return {
        storedName: item.storedName,
        absolutePath: directPath,
        relativePath: item.relativePath,
        sizeBytes: directStat.size
      };
    }
  }

  if (!fs.existsSync(config.incomingRoot)) {
    return null;
  }

  const baseName = path.parse(item.storedName).name;
  const matchingEntries = fs
    .readdirSync(config.incomingRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.parse(entry.name).name === baseName)
    .map((entry) => {
      const absolutePath = path.join(config.incomingRoot, entry.name);
      const stat = fs.statSync(absolutePath);
      const descriptor: CatalogItemFileDescriptor = {
        storedName: entry.name,
        absolutePath,
        relativePath: path.relative(config.mediaRoot, absolutePath),
        sizeBytes: stat.size
      };
      return descriptor;
    })
    .sort((left, right) => {
      const leftIsPlaceholder = left.storedName.endsWith('.source') ? 1 : 0;
      const rightIsPlaceholder = right.storedName.endsWith('.source') ? 1 : 0;
      if (leftIsPlaceholder !== rightIsPlaceholder) {
        return leftIsPlaceholder - rightIsPlaceholder;
      }

      return left.storedName.localeCompare(right.storedName);
    });

  return matchingEntries[0] ?? null;
}

async function reconcileCatalogItemSourceVariant(
  item: CatalogItem,
  sessionId?: string | null
): Promise<CatalogItem> {
  const existingVariant = findExistingCatalogItemSourceVariant(item);
  if (!existingVariant) {
    return item;
  }

  if (
    existingVariant.storedName === item.storedName &&
    existingVariant.relativePath === item.relativePath &&
    existingVariant.sizeBytes === item.sizeBytes
  ) {
    return item;
  }

  const updatedItem = await updateCatalogItemAndBroadcast(
    item.id,
    {
      storedName: existingVariant.storedName,
      relativePath: existingVariant.relativePath,
      sizeBytes: existingVariant.sizeBytes
    },
    sessionId
  );

  return requireCatalogItemUpdate(item.id, updatedItem);
}

function catalogItemRequiresSourceDownload(item: CatalogItem): boolean {
  return item.sourceType === 'yt_dlp' && findExistingCatalogItemSourceVariant(item) === null;
}

function getYtDlpDownloadWorkRoot(itemId: string): string {
  const workRoot = path.join(config.ytDlpTempRoot, itemId);
  fs.mkdirSync(workRoot, { recursive: true });
  return workRoot;
}

function cleanupYtDlpDownloadWorkRoot(itemId: string): void {
  removePathIfExists(path.join(config.ytDlpTempRoot, itemId));
}

function getProcessingWorkRoot(itemId: string): string {
  const workRoot = path.join(config.tmpRoot, 'ffmpeg', itemId);
  fs.mkdirSync(workRoot, { recursive: true });
  return workRoot;
}

function cleanupProcessingWorkRoot(itemId: string): void {
  removePathIfExists(path.join(config.tmpRoot, 'ffmpeg', itemId));
}

function createRetainedOutputDescriptor(
  item: CatalogItem,
  outputExtension: string
): { storedName: string; absolutePath: string; relativePath: string } {
  const baseName = path.parse(item.storedName).name;
  const storedName = `${baseName}${outputExtension}`;
  const absolutePath = path.join(config.mediaStoreRoot, storedName);
  return {
    storedName,
    absolutePath,
    relativePath: path.relative(config.mediaRoot, absolutePath)
  };
}

function createPosterThumbnailDescriptor(
  item: CatalogItem
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.join(config.thumbsRoot, `${item.id}.jpg`);
  return {
    absolutePath,
    relativePath: path.relative(config.mediaRoot, absolutePath)
  };
}

function createBookmarkThumbnailDescriptor(
  item: CatalogItem,
  bookmarkId: string
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.join(config.thumbsRoot, 'bookmarks', item.id, `${bookmarkId}.jpg`);
  return {
    absolutePath,
    relativePath: path.relative(config.mediaRoot, absolutePath)
  };
}

function createHoverPreviewDescriptor(
  item: CatalogItem
): { absolutePath: string; relativePath: string } {
  const absolutePath = path.join(config.previewsRoot, `${item.id}.jpg`);
  return {
    absolutePath,
    relativePath: path.relative(config.mediaRoot, absolutePath)
  };
}

function resolveManagedMediaAbsolutePath(relativePath: string): string | null {
  const normalizedRoot = path.resolve(config.mediaRoot);
  const absolutePath = path.resolve(normalizedRoot, relativePath);

  if (absolutePath === normalizedRoot || absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return absolutePath;
  }

  return null;
}

function getManagedFileStats(filePath: string): fs.Stats | null {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function getProtectedMediaContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.m4v':
      return 'video/x-m4v';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

function parseSingleByteRange(
  rangeHeader: string,
  sizeBytes: number
): { start: number; end: number } | null {
  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith('bytes=') || trimmed.includes(',')) {
    return null;
  }

  const rangeValue = trimmed.slice('bytes='.length);
  const dashIndex = rangeValue.indexOf('-');
  if (dashIndex === -1) {
    return null;
  }

  const rawStart = rangeValue.slice(0, dashIndex).trim();
  const rawEnd = rangeValue.slice(dashIndex + 1).trim();

  if (rawStart === '' && rawEnd === '') {
    return null;
  }

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(0, sizeBytes - suffixLength);
    return {
      start,
      end: sizeBytes - 1
    };
  }

  const start = Number(rawStart);
  const parsedEnd = rawEnd === '' ? sizeBytes - 1 : Number(rawEnd);
  if (!Number.isInteger(start) || !Number.isInteger(parsedEnd) || start < 0 || parsedEnd < start) {
    return null;
  }

  if (start >= sizeBytes) {
    return null;
  }

  return {
    start,
    end: Math.min(parsedEnd, sizeBytes - 1)
  };
}

function createDownloadFileName(item: CatalogItem): string {
  const baseCandidate = item.originalName.trim() || path.parse(item.storedName).name || 'video';
  const sanitizedBase = baseCandidate
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const safeBaseName = sanitizedBase === '' ? 'video' : sanitizedBase;
  const extension = path.extname(item.storedName) || path.extname(item.relativePath);
  if (extension === '') {
    return safeBaseName;
  }

  return safeBaseName.toLowerCase().endsWith(extension.toLowerCase())
    ? safeBaseName
    : `${safeBaseName}${extension}`;
}

function sendManagedFileResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  options?: {
    allowRange?: boolean;
    downloadFileName?: string | null;
  }
): void {
  const fileStats = getManagedFileStats(filePath);
  if (!fileStats) {
    reply.code(404).send({ message: 'Media file not found.' });
    return;
  }

  const contentType = getProtectedMediaContentType(filePath);
  const allowRange = options?.allowRange === true;
  const rangeHeader = Array.isArray(request.headers.range)
    ? request.headers.range[0]
    : request.headers.range;
  const shouldLogManagedMedia = allowRange || contentType.startsWith('video/');

  if (shouldLogManagedMedia) {
    request.log.info(
      {
        event: 'managed_media.prepare',
        filePath,
        contentType,
        sizeBytes: fileStats.size,
        allowRange,
        rangeHeader: typeof rangeHeader === 'string' ? rangeHeader : null,
        downloadFileName: options?.downloadFileName ?? null
      },
      'Preparing managed media response.'
    );
  }

  const responseHeaders: Record<string, string> = {
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff'
  };

  if (options?.downloadFileName) {
    const safeFileName = options.downloadFileName.replace(/"/g, '');
    responseHeaders['Content-Disposition'] = `attachment; filename="${safeFileName}"`;
  }

  if (allowRange) {
    responseHeaders['Accept-Ranges'] = 'bytes';
  }

  const applyHijackedRawResponse = (
    statusCode: number,
    extraHeaders?: Record<string, string>
  ): void => {
    const effectiveHeaders = extraHeaders
      ? {
          ...responseHeaders,
          ...extraHeaders
        }
      : responseHeaders;

    reply.hijack();
    reply.raw.statusCode = statusCode;

    for (const [headerName, headerValue] of Object.entries(effectiveHeaders)) {
      reply.raw.setHeader(headerName, headerValue);
    }
  };

  if (allowRange && typeof rangeHeader === 'string' && rangeHeader.trim() !== '') {
    const byteRange = parseSingleByteRange(rangeHeader, fileStats.size);
    if (!byteRange) {
      if (shouldLogManagedMedia) {
        request.log.warn(
          {
            event: 'managed_media.range.invalid',
            filePath,
            sizeBytes: fileStats.size,
            rangeHeader
          },
          'Rejected invalid or unsupported range request.'
        );
      }

      reply.code(416).header('Content-Range', `bytes */${fileStats.size}`).send('');
      return;
    }

    const contentLength = byteRange.end - byteRange.start + 1;
    const contentRange = `bytes ${byteRange.start}-${byteRange.end}/${fileStats.size}`;

    if (shouldLogManagedMedia) {
      request.log.info(
        {
          event: 'managed_media.range.served',
          filePath,
          contentType,
          sizeBytes: fileStats.size,
          rangeHeader,
          start: byteRange.start,
          end: byteRange.end,
          statusCode: 206,
          contentLength,
          contentRange
        },
        'Serving ranged managed media response.'
      );
    }

    const stream = fs.createReadStream(filePath, {
      start: byteRange.start,
      end: byteRange.end
    });

    stream.on('error', (error) => {
      request.log.error({ err: error, filePath }, 'Failed to stream ranged media file.');
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.end();
      } else {
        reply.raw.destroy(error);
      }
    });

    applyHijackedRawResponse(206, {
      'Content-Length': String(contentLength),
      'Content-Range': contentRange
    });
    stream.pipe(reply.raw);
    return;
  }

  if (shouldLogManagedMedia) {
    request.log.info(
      {
        event: 'managed_media.full.served',
        filePath,
        contentType,
        sizeBytes: fileStats.size,
        statusCode: 200,
        contentLength: fileStats.size
      },
      'Serving full managed media response.'
    );
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    request.log.error({ err: error, filePath }, 'Failed to stream media file.');
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500;
      reply.raw.end();
    } else {
      reply.raw.destroy(error);
    }
  });

  applyHijackedRawResponse(200, {
    'Content-Length': String(fileStats.size)
  });
  stream.pipe(reply.raw);
}

function readFirstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === 'string' ? value : null;
}

function etagMatches(ifNoneMatchHeader: string | null, etag: string): boolean {
  if (!ifNoneMatchHeader) {
    return false;
  }

  return ifNoneMatchHeader
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag);
}

function lastModifiedMatches(ifModifiedSinceHeader: string | null, mtimeMs: number): boolean {
  if (!ifModifiedSinceHeader) {
    return false;
  }

  const parsedTime = Date.parse(ifModifiedSinceHeader);
  if (!Number.isFinite(parsedTime)) {
    return false;
  }

  return parsedTime >= Math.floor(mtimeMs / 1000) * 1000;
}

function requestHasFreshThumbnail(request: FastifyRequest, thumbnailFile: CachedThumbnailFile): boolean {
  const ifNoneMatchHeader = readFirstHeaderValue(request.headers['if-none-match']);
  if (ifNoneMatchHeader) {
    return etagMatches(ifNoneMatchHeader, thumbnailFile.etag);
  }

  const ifModifiedSinceHeader = readFirstHeaderValue(request.headers['if-modified-since']);
  return lastModifiedMatches(ifModifiedSinceHeader, thumbnailFile.mtimeMs);
}

function applyThumbnailResponseHeaders(reply: FastifyReply, thumbnailFile: CachedThumbnailFile): void {
  reply.header('Cache-Control', THUMBNAIL_BROWSER_CACHE_CONTROL);
  reply.header('Content-Type', thumbnailFile.contentType);
  reply.header('ETag', thumbnailFile.etag);
  reply.header('Last-Modified', thumbnailFile.lastModified);
  reply.header('Vary', 'Cookie');
  reply.header('X-Content-Type-Options', 'nosniff');
}

async function sendCachedThumbnailResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  notFoundMessage: string
): Promise<void> {
  try {
    const thumbnailFile = await thumbnailCache.read(filePath, getProtectedMediaContentType(filePath));
    if (!thumbnailFile) {
      reply.code(404).header('Cache-Control', 'private, no-store').send({
        message: notFoundMessage
      });
      return;
    }

    applyThumbnailResponseHeaders(reply, thumbnailFile);

    if (requestHasFreshThumbnail(request, thumbnailFile)) {
      reply.code(304).send();
      return;
    }

    reply.header('Content-Length', String(thumbnailFile.sizeBytes));
    reply.send(thumbnailFile.buffer);
  } catch (error) {
    request.log.warn(
      {
        err: error,
        filePath
      },
      'Thumbnail memory cache failed; falling back to managed file streaming.'
    );
    sendManagedFileResponse(request, reply, filePath);
  }
}

async function refreshThumbnailCacheFile(filePath: string): Promise<void> {
  thumbnailCache.invalidatePath(filePath);
  try {
    await thumbnailCache.read(filePath, getProtectedMediaContentType(filePath));
  } catch (error) {
    app.log.warn(
      {
        err: error,
        filePath
      },
      'Failed to refresh thumbnail memory cache entry.'
    );
  }
}

function invalidateThumbnailCacheFile(filePath: string | null): void {
  if (!filePath) {
    return;
  }

  thumbnailCache.invalidatePath(filePath);
}

function invalidateThumbnailCachePathPrefix(rootPath: string): void {
  thumbnailCache.invalidatePathPrefix(rootPath);
}

function getCatalogItemVideoFilePath(item: CatalogItem): string | null {
  return resolveManagedMediaAbsolutePath(item.relativePath);
}

function getCatalogItemThumbnailFilePath(item: CatalogItem): string | null {
  if (!item.thumbnailRelativePath) {
    return null;
  }

  return resolveManagedMediaAbsolutePath(item.thumbnailRelativePath);
}

function getCatalogBookmarkThumbnailFilePath(bookmark: CatalogBookmark): string | null {
  if (!bookmark.thumbnailRelativePath) {
    return null;
  }

  return resolveManagedMediaAbsolutePath(bookmark.thumbnailRelativePath);
}

function getCatalogItemHoverPreviewFilePath(item: CatalogItem): string | null {
  const hoverPreviewRelativePath = item.hoverPreviewSprite?.relativePath ?? null;
  if (!hoverPreviewRelativePath) {
    return null;
  }

  return resolveManagedMediaAbsolutePath(hoverPreviewRelativePath);
}

function getCatalogItemBookmarkThumbnailsRootPath(item: CatalogItem): string {
  return path.join(config.thumbsRoot, 'bookmarks', item.id);
}

function removeDeletedCatalogArtifactPath(
  targetPath: string,
  itemId: string,
  artifactType: string
): void {
  try {
    removePathIfExists(targetPath);
  } catch (error) {
    app.log.warn(
      {
        err: error,
        itemId,
        artifactType,
        targetPath
      },
      'Failed to remove catalog item artifact during deletion.'
    );
  }
}

function cleanupDeletedCatalogItemArtifacts(item: CatalogItem, bookmarks: CatalogBookmark[]): void {
  const artifactPaths: Array<{ absolutePath: string | null; artifactType: string }> = [
    { absolutePath: getCatalogItemVideoFilePath(item), artifactType: 'retained_video' },
    { absolutePath: getCatalogItemThumbnailFilePath(item), artifactType: 'poster_thumbnail' },
    { absolutePath: getCatalogItemHoverPreviewFilePath(item), artifactType: 'hover_preview' },
    {
      absolutePath: path.join(config.tmpRoot, 'ffmpeg', item.id),
      artifactType: 'processing_work_root'
    },
    {
      absolutePath: path.join(config.ytDlpTempRoot, item.id),
      artifactType: 'yt_dlp_work_root'
    },
    {
      absolutePath: getCatalogItemBookmarkThumbnailsRootPath(item),
      artifactType: 'bookmark_thumbnail_root'
    }
  ];

  for (const bookmark of bookmarks) {
    artifactPaths.push({
      absolutePath: getCatalogBookmarkThumbnailFilePath(bookmark),
      artifactType: 'bookmark_thumbnail'
    });
  }

  const removedPaths = new Set<string>();
  for (const artifact of artifactPaths) {
    if (!artifact.absolutePath) {
      continue;
    }

    const resolvedPath = path.resolve(artifact.absolutePath);
    if (removedPaths.has(resolvedPath)) {
      continue;
    }

    removedPaths.add(resolvedPath);
    if (artifact.artifactType === 'poster_thumbnail' || artifact.artifactType === 'bookmark_thumbnail') {
      invalidateThumbnailCacheFile(resolvedPath);
    } else if (artifact.artifactType === 'bookmark_thumbnail_root') {
      invalidateThumbnailCachePathPrefix(resolvedPath);
    }
    removeDeletedCatalogArtifactPath(resolvedPath, item.id, artifact.artifactType);
  }
}

function readCatalogItemIdParam(request: FastifyRequest): string | null {
  const params = isRecord(request.params) ? request.params : null;
  return params ? readString(params.id) : null;
}

function getRequestedCatalogItem(
  request: FastifyRequest,
  reply: FastifyReply
): CatalogItem | null {
  const itemId = readCatalogItemIdParam(request);
  if (!itemId) {
    reply.code(400).send({ message: 'A catalog item id is required.' });
    return null;
  }

  const item = getCatalogItemById(itemId);
  if (!item) {
    reply.code(404).send({ message: 'Catalog item not found.' });
    return null;
  }

  return item;
}

function readBookmarkIdParam(request: FastifyRequest): string | null {
  const params = isRecord(request.params) ? request.params : null;
  return params ? readString(params.bookmarkId) : null;
}

function getRequestedCatalogItemBookmark(
  request: FastifyRequest,
  reply: FastifyReply,
  item: CatalogItem
): CatalogBookmark | null {
  const bookmarkId = readBookmarkIdParam(request);
  if (!bookmarkId) {
    reply.code(400).send({ message: 'A bookmark id is required.' });
    return null;
  }

  const bookmark = catalogStore.findCatalogItemBookmark(item.id, bookmarkId);
  if (!bookmark) {
    reply.code(404).send({ message: 'Bookmark not found.' });
    return null;
  }

  return bookmark;
}

function readUnknownNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseNumericText(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFraction(value: string | null): number | null {
  if (!value) {
    return null;
  }

  if (!value.includes('/')) {
    return parseNumericText(value);
  }

  const [numeratorText, denominatorText] = value.split('/', 2);
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function parseTimecodeToSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    return parseNumericText(value);
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

function formatDurationForDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return 'unknown';
  }

  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function isMp4FamilyContainer(containerFormat: string | null): boolean {
  if (!containerFormat) {
    return false;
  }

  const normalized = containerFormat.toLowerCase();
  return normalized.includes('mp4') || normalized.includes('mov');
}

function isRemuxSafeVideoCodec(codec: string | null): boolean {
  return codec === 'h264';
}

function isRemuxSafeAudioCodec(codec: string | null): boolean {
  return codec === 'aac' || codec === 'mp3';
}

function hasRemuxSafeAudio(probe: MediaProbeInfo): boolean {
  if (probe.audioPresent === false) {
    return true;
  }

  if (probe.audioPresent !== true) {
    return false;
  }

  const audioCodecs = probe.audioCodecs ?? (probe.audioCodec ? [probe.audioCodec] : []);
  return audioCodecs.length > 0 && audioCodecs.every((codec) => isRemuxSafeAudioCodec(codec));
}

function isSafePixelFormat(pixelFormat: string | null): boolean {
  return pixelFormat === 'yuv420p' || pixelFormat === 'yuvj420p';
}

function createMediaRetentionPlan(item: CatalogItem, probe: MediaProbeInfo): MediaRetentionPlan {
  const remuxSafeVideo = isRemuxSafeVideoCodec(probe.videoCodec);
  const remuxSafeAudio = hasRemuxSafeAudio(probe);
  const safePixelFormat = isSafePixelFormat(probe.pixelFormat);
  const browserSafeForDirectRetention = remuxSafeVideo && remuxSafeAudio && safePixelFormat;
  const currentExtension = path.extname(item.storedName).toLowerCase();

  if (browserSafeForDirectRetention && currentExtension === '.mp4' && isMp4FamilyContainer(probe.containerFormat)) {
    return {
      decision: 'keep',
      outputExtension: currentExtension || '.mp4',
      description: 'Input already matches the retained browser-safe target; keeping file without re-encoding.',
      inputIsBrowserSafe: true
    };
  }

  if (browserSafeForDirectRetention) {
    return {
      decision: 'remux',
      outputExtension: '.mp4',
      description: 'Input codecs are compatible with the retained browser-safe target; remuxing into MP4 without re-encoding.',
      inputIsBrowserSafe: true
    };
  }

  return {
    decision: 'transcode',
    outputExtension: '.mp4',
    description: 'Input does not match the retained browser-safe target; transcoding to a quality-prioritized MP4/H.264 retained asset.',
    inputIsBrowserSafe: false
  };
}

function parseFfprobeResult(raw: string): MediaProbeInfo {
  const parsed = JSON.parse(raw) as FfprobeResultJson;
  const streams = Array.isArray(parsed.streams) ? parsed.streams.filter(isRecord) : [];
  const format = isRecord(parsed.format) ? parsed.format : null;

  const videoStream = streams.find((stream) => readString(stream.codec_type) === 'video') ?? null;
  if (!videoStream) {
    throw new Error('ffprobe did not find a video stream in the retained media file.');
  }

  const audioStreams = streams.filter((stream) => readString(stream.codec_type) === 'audio');
  const audioStream = audioStreams[0] ?? null;
  const audioCodecs = audioStreams
    .map((stream) => readString(stream.codec_name))
    .filter((codec): codec is string => codec !== null);

  const durationSeconds =
    parseNumericText(format ? readString(format.duration) : null) ??
    parseNumericText(readString(videoStream.duration));
  const width = readUnknownNumber(videoStream.width);
  const height = readUnknownNumber(videoStream.height);
  const fps =
    parseFraction(readString(videoStream.avg_frame_rate)) ??
    parseFraction(readString(videoStream.r_frame_rate));
  const estimatedFrameCount =
    durationSeconds !== null && fps !== null ? Math.max(1, Math.round(durationSeconds * fps)) : null;

  return {
    durationSeconds,
    width,
    height,
    fps,
    audioPresent: audioStream !== null,
    videoCodec: readString(videoStream.codec_name),
    audioCodec: audioStream ? readString(audioStream.codec_name) : null,
    audioCodecs,
    pixelFormat: readString(videoStream.pix_fmt),
    containerFormat: format ? readString(format.format_name) : null,
    estimatedFrameCount,
    isBrowserSafeInput: null
  };
}

function parseFfmpegProgressState(values: Record<string, string>): FfmpegProgressState {
  const outTimeSecondsFromText = parseTimecodeToSeconds(values.out_time ?? null);
  const outTimeFromMicros = parseNumericText(values.out_time_ms ?? values.out_time_us ?? null);

  return {
    frame: parseNumericText(values.frame ?? null),
    fps: parseNumericText(values.fps ?? null),
    outTimeSeconds:
      outTimeSecondsFromText ??
      (outTimeFromMicros !== null ? outTimeFromMicros / 1_000_000 : null),
    speed: values.speed ?? null
  };
}

function createFfmpegProgressMessage(
  progressLabel: string,
  snapshot: FfmpegProgressState,
  durationSeconds: number | null,
  percent: number | null
): string {
  const parts = [progressLabel];

  if (percent !== null) {
    parts.push(`${percent.toFixed(1)}%`);
  }

  if (snapshot.outTimeSeconds !== null) {
    const currentTime = formatDurationForDisplay(snapshot.outTimeSeconds);
    if (durationSeconds !== null) {
      parts.push(`${currentTime} / ${formatDurationForDisplay(durationSeconds)}`);
    } else {
      parts.push(currentTime);
    }
  }

  if (snapshot.speed) {
    parts.push(`speed ${snapshot.speed}`);
  }

  return parts.join(' · ');
}

function createFfmpegProgressLineHandler(input: {
  itemId: string;
  stage: Extract<ProcessingSnapshot['stage'], 'remuxing' | 'transcoding' | 'hover_thumbnails'>;
  progressLabel: string;
  durationSeconds: number | null;
  sessionId?: string | null;
}): (line: string) => void {
  const values: Record<string, string> = {};
  let lastProgressAt = 0;
  let lastPercent: number | null = null;

  return (line: string): void => {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key === '') {
      return;
    }

    values[key] = value;

    if (key != 'progress') {
      return;
    }

    const snapshot = parseFfmpegProgressState(values);
    const percent =
      snapshot.outTimeSeconds !== null && input.durationSeconds !== null && input.durationSeconds > 0
        ? Math.max(
            0,
            Math.min(
              99,
              Number(((snapshot.outTimeSeconds / input.durationSeconds) * 100).toFixed(2))
            )
          )
        : null;

    const now = Date.now();
    const shouldEmit =
      value == 'end' ||
      now - lastProgressAt >= 1000 ||
      (percent !== null && (lastPercent === null || Math.abs(percent - lastPercent) >= 1));

    if (!shouldEmit) {
      return;
    }

    lastProgressAt = now;
    lastPercent = percent;

    const message = createFfmpegProgressMessage(
      input.progressLabel,
      snapshot,
      input.durationSeconds,
      percent
    );

    void updateCatalogItemProcessing(
      input.itemId,
      input.stage,
      message,
      percent,
      'processing',
      input.sessionId
    )
      .then((updatedItem) => {

        writePipelineLog(
          'info',
          `processing.${input.stage}.progress`,
          message,
          getCatalogItemLogContext(updatedItem, input.sessionId),
          {
            percent,
            outTimeSeconds: snapshot.outTimeSeconds,
            frame: snapshot.frame,
            speed: snapshot.speed
          }
        );
      })
      .catch((error: unknown) => {
        app.log.error(
          {
            event: 'processing.progress.persist_failed',
            itemId: input.itemId,
            stage: input.stage,
            error
          },
          'Failed to persist ffmpeg progress update.'
        );
      });
  };
}

async function runFfprobeForFile(
  filePath: string,
  logContext: PipelineLogContext
): Promise<MediaProbeInfo> {
  const result = await runCommand(
    config.ffprobeCommand,
    ['-v', 'error', '-show_format', '-show_streams', '-output_format', 'json', filePath],
    {
      commandLabel: 'ffprobe metadata extraction',
      logContext,
      captureStderrLines: true
    }
  );

  if (result.exitCode !== 0) {
    const message = sanitizeLogText(
      result.stderr.trim() || result.stdout.trim() || 'ffprobe metadata extraction failed.'
    );
    throw new Error(message);
  }

  return parseFfprobeResult(result.stdout);
}

async function updateCatalogItemProcessing(
  itemId: string,
  stage: ProcessingSnapshot['stage'],
  message: string,
  stagePercent: number | null,
  status: CatalogItem['status'],
  sessionId?: string | null,
  patch: CatalogItemMutablePatch = {}
): Promise<CatalogItem> {
  const currentItem = catalogStore.findById(itemId);
  const sourceType = patch.sourceType ?? currentItem?.sourceType;
  if (!sourceType) {
    throw new Error(`Catalog item ${itemId} no longer exists.`);
  }

  const updatedItem = await updateCatalogItemAndBroadcast(
    itemId,
    {
      ...patch,
      status,
      processing: createCatalogItemProcessingSnapshotForSource(
        sourceType,
        stage,
        message,
        stagePercent
      )
    },
    sessionId
  );

  return requireCatalogItemUpdate(itemId, updatedItem);
}

async function markCatalogItemFailed(
  item: CatalogItem,
  message: string,
  sessionId?: string | null,
  error?: unknown
): Promise<CatalogItem> {
  const updatedItem = await updateCatalogItemAndBroadcast(
    item.id,
    {
      status: 'failed',
      processing: createCatalogItemProcessingSnapshotForSource(item.sourceType, 'failed', message, null)
    },
    sessionId
  );

  const effectiveItem = updatedItem ?? item;
  writePipelineLog(
    'error',
    'processing.failed',
    message,
    getCatalogItemLogContext(effectiveItem, sessionId),
    {},
    error
  );

  return effectiveItem;
}

function discardQueuedCatalogItemProcessing(itemId: string): void {
  let removedCount = 0;

  for (let index = processingQueue.length - 1; index >= 0; index -= 1) {
    if (processingQueue[index]?.itemId === itemId) {
      processingQueue.splice(index, 1);
      removedCount += 1;
    }
  }

  if (removedCount > 0) {
    queuedProcessingItemIds.delete(itemId);
    writePipelineLog(
      'info',
      'processing.queue.discarded',
      'Discarded queued processing work for deleted catalog item.',
      { itemId },
      { removedCount, queueDepth: processingQueue.length }
    );
  }
}

function terminateActiveCatalogItemCommands(itemId: string): void {
  const activeProcesses = activeCommandProcessesByItemId.get(itemId);
  if (!activeProcesses || activeProcesses.size === 0) {
    return;
  }

  for (const child of activeProcesses) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }

    try {
      child.kill('SIGTERM');

      const forcedKillTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }

        try {
          child.kill('SIGKILL');
        } catch (error) {
          app.log.warn(
            { err: error, itemId },
            'Failed to force-kill catalog item processing command during deletion.'
          );
        }
      }, 2000);
      forcedKillTimer.unref?.();
    } catch (error) {
      app.log.warn(
        { err: error, itemId },
        'Failed to stop catalog item processing command during deletion.'
      );
    }
  }

  writePipelineLog(
    'warn',
    'processing.commands.terminated',
    'Requested termination of active processing commands for deleted catalog item.',
    { itemId },
    { processCount: activeProcesses.size }
  );
}

async function enqueueCatalogItemProcessing(
  item: CatalogItem,
  sessionId?: string | null,
  options?: { recovered?: boolean }
): Promise<CatalogItem> {
  if (item.status === 'ready') {
    return item;
  }

  const sourceDownloadPending = catalogItemRequiresSourceDownload(item);
  const queuedMessage = options?.recovered
    ? sourceDownloadPending
      ? 'Recovered unfinished yt-dlp import after startup; queued to reacquire source media and continue processing.'
      : 'Recovered unfinished media processing job after startup; queued for retry.'
    : sourceDownloadPending
      ? 'Catalog item created; queued to download source media.'
      : 'Queued for downstream media processing.';

  const effectiveItem = await updateCatalogItemProcessing(
    item.id,
    'queued',
    queuedMessage,
    0,
    'pending_processing',
    sessionId
  );

  if (!queuedProcessingItemIds.has(item.id) && !activeProcessingItemIds.has(item.id)) {
    processingQueue.push({
      itemId: item.id,
      requestedBySessionId: sessionId ?? null,
      enqueuedAt: new Date().toISOString()
    });
    queuedProcessingItemIds.add(item.id);

    writePipelineLog(
      'info',
      'processing.queued',
      queuedMessage,
      getCatalogItemLogContext(effectiveItem, sessionId),
      {
        queueDepth: processingQueue.length,
        recovered: options?.recovered ?? false
      }
    );
  } else {
    writePipelineLog(
      'info',
      'processing.queue.already_present',
      'Catalog item was already queued or running for downstream media processing.',
      getCatalogItemLogContext(effectiveItem, sessionId),
      {
        queueDepth: processingQueue.length
      }
    );
  }

  queueMicrotask(() => {
    void drainProcessingQueue();
  });

  return effectiveItem;
}

async function drainProcessingQueue(): Promise<void> {
  if (isProcessingQueueRunning) {
    return;
  }

  isProcessingQueueRunning = true;

  try {
    while (processingQueue.length > 0) {
      const entry = processingQueue.shift();
      if (!entry) {
        continue;
      }

      queuedProcessingItemIds.delete(entry.itemId);
      if (activeProcessingItemIds.has(entry.itemId)) {
        continue;
      }

      activeProcessingItemIds.add(entry.itemId);
      try {
        await processCatalogItemQueueEntry(entry);
      } finally {
        activeProcessingItemIds.delete(entry.itemId);
      }
    }
  } finally {
    isProcessingQueueRunning = false;
    if (processingQueue.length > 0) {
      queueMicrotask(() => {
        void drainProcessingQueue();
      });
    }
  }
}

async function processCatalogItemQueueEntry(entry: ProcessingQueueEntry): Promise<void> {
  const currentItem = catalogStore.findById(entry.itemId);
  if (!currentItem) {
    writePipelineLog(
      'warn',
      'processing.queue.missing_item',
      'Skipping downstream media processing because the catalog item no longer exists.',
      {
        sessionId: entry.requestedBySessionId,
        itemId: entry.itemId
      }
    );
    return;
  }

  await processCatalogItem(currentItem, entry.requestedBySessionId);
}

async function runFfmpegStage(
  item: CatalogItem,
  stage: Extract<ProcessingSnapshot['stage'], 'remuxing' | 'transcoding' | 'hover_thumbnails'>,
  stageStartMessage: string,
  progressLabel: string,
  commandLabel: string,
  args: string[],
  durationSeconds: number | null,
  sessionId?: string | null
): Promise<CatalogItem> {
  let workingItem = await updateCatalogItemProcessing(
    item.id,
    stage,
    stageStartMessage,
    0,
    'processing',
    sessionId
  );

  writePipelineLog(
    'info',
    `processing.${stage}.started`,
    stageStartMessage,
    getCatalogItemLogContext(workingItem, sessionId)
  );

  const progressHandler = createFfmpegProgressLineHandler({
    itemId: workingItem.id,
    stage,
    progressLabel,
    durationSeconds,
    sessionId
  });

  const result = await runCommand(config.ffmpegCommand, args, {
    commandLabel,
    logContext: getCatalogItemLogContext(workingItem, sessionId),
    onStdoutLine: progressHandler,
    captureStderrLines: true
  });

  if (result.exitCode !== 0) {
    const message = sanitizeLogText(
      result.stderr.trim() || result.stdout.trim() || `${commandLabel} failed.`
    );
    throw new Error(message);
  }

  const refreshedItem = catalogStore.findById(item.id);
  return refreshedItem ?? workingItem;
}

async function applyRetentionPlan(
  item: CatalogItem,
  inputProbe: MediaProbeInfo,
  plan: MediaRetentionPlan,
  sessionId?: string | null
): Promise<CatalogItem> {
  const currentPath = getCatalogItemAbsolutePath(item);
  const retainedOutput = createRetainedOutputDescriptor(item, plan.outputExtension);
  const workRoot = getProcessingWorkRoot(item.id);
  const temporaryOutputPath = path.join(workRoot, `retained${plan.outputExtension}`);

  removePathIfExists(temporaryOutputPath);
  if (path.resolve(currentPath) != path.resolve(retainedOutput.absolutePath)) {
    removePathIfExists(retainedOutput.absolutePath);
  }

  switch (plan.decision) {
    case 'keep': {
      writePipelineLog(
        'info',
        'processing.retention.keep',
        'Keeping staged file as the retained playable asset without re-encoding.',
        getCatalogItemLogContext(item, sessionId)
      );

      if (path.resolve(currentPath) != path.resolve(retainedOutput.absolutePath)) {
        fs.mkdirSync(path.dirname(retainedOutput.absolutePath), { recursive: true });
        fs.renameSync(currentPath, retainedOutput.absolutePath);
      }
      break;
    }

    case 'remux': {
      await runFfmpegStage(
        item,
        'remuxing',
        'Remuxing retained video into MP4.',
        'Remuxing retained video',
        'ffmpeg remux',
        [
          '-y',
          '-nostdin',
          '-v',
          'error',
          '-stats_period',
          '0.5',
          '-progress',
          'pipe:1',
          '-i',
          currentPath,
          ...config.ffmpegRetentionRemuxArgs,
          temporaryOutputPath
        ],
        inputProbe.durationSeconds,
        sessionId
      );

      if (path.resolve(currentPath) == path.resolve(retainedOutput.absolutePath)) {
        removePathIfExists(currentPath);
      } else {
        removePathIfExists(currentPath);
      }
      fs.mkdirSync(path.dirname(retainedOutput.absolutePath), { recursive: true });
      fs.renameSync(temporaryOutputPath, retainedOutput.absolutePath);
      break;
    }

    case 'transcode': {
      const transcodeAudioArgs = hasRemuxSafeAudio(inputProbe)
        ? config.ffmpegRetentionTranscodeCompatibleAudioArgs
        : config.ffmpegRetentionTranscodeIncompatibleAudioArgs;
      const transcodeArgs = [
        '-y',
        '-nostdin',
        '-v',
        'error',
        '-stats_period',
        '0.5',
        '-progress',
        'pipe:1',
        '-i',
        currentPath,
        ...config.ffmpegRetentionTranscodeVideoArgs,
        ...transcodeAudioArgs,
        temporaryOutputPath
      ];

      await runFfmpegStage(
        item,
        'transcoding',
        'Transcoding retained video to quality-prioritized MP4/H.264.',
        'Transcoding retained video',
        'ffmpeg transcode',
        transcodeArgs,
        inputProbe.durationSeconds,
        sessionId
      );

      removePathIfExists(currentPath);
      fs.mkdirSync(path.dirname(retainedOutput.absolutePath), { recursive: true });
      fs.renameSync(temporaryOutputPath, retainedOutput.absolutePath);
      break;
    }
  }

  const retainedChecksum =
    plan.decision == 'keep' && item.incomingChecksumSha256
      ? item.incomingChecksumSha256
      : await computeFileChecksum(retainedOutput.absolutePath);
  const retainedProbe = await runFfprobeForFile(
    retainedOutput.absolutePath,
    getCatalogItemLogContext(item, sessionId)
  );
  const finalProbe: MediaProbeInfo = {
    ...retainedProbe,
    isBrowserSafeInput: plan.inputIsBrowserSafe
  };
  const retainedSizeBytes = fs.statSync(retainedOutput.absolutePath).size;

  const effectiveItem = await updateCatalogItemProcessing(
    item.id,
    'poster_thumbnail',
    'Retained asset prepared; generating poster thumbnail.',
    0,
    'processing',
    sessionId,
    {
      storedName: retainedOutput.storedName,
      relativePath: retainedOutput.relativePath,
      sizeBytes: retainedSizeBytes,
      retainedChecksumSha256: retainedChecksum,
      probe: finalProbe
    }
  );
  writePipelineLog(
    'info',
    'processing.retention.complete',
    'Retained playable asset prepared successfully.',
    getCatalogItemLogContext(effectiveItem, sessionId),
    {
      decision: plan.decision,
      relativePath: effectiveItem.relativePath,
      sizeBytes: effectiveItem.sizeBytes,
      retainedChecksumSha256: abbreviateChecksum(effectiveItem.retainedChecksumSha256)
    }
  );

  return effectiveItem;
}

function formatFfmpegTimestamp(seconds: number): string {
  return Math.max(0, seconds).toFixed(3);
}

function createPosterThumbnailVideoFilter(captureTimeSeconds: number | null): string {
  if (captureTimeSeconds === null) {
    return `thumbnail=100,scale=${POSTER_THUMBNAIL_WIDTH}:-2`;
  }

  return `scale=${POSTER_THUMBNAIL_WIDTH}:-2`;
}

async function runPosterThumbnailCommand(input: {
  item: CatalogItem;
  inputPath: string;
  outputPath: string;
  sessionId?: string | null;
  captureTimeSeconds: number | null;
  commandLabel: string;
}): Promise<void> {
  const args = ['-y', '-nostdin', '-v', 'error'];

  if (input.captureTimeSeconds !== null) {
    args.push('-ss', formatFfmpegTimestamp(input.captureTimeSeconds));
  }

  args.push(
    '-i',
    input.inputPath,
    '-vf',
    createPosterThumbnailVideoFilter(input.captureTimeSeconds),
    '-frames:v',
    '1',
    '-q:v',
    '2',
    input.outputPath
  );

  const result = await runCommand(config.ffmpegCommand, args, {
    commandLabel: input.commandLabel,
    logContext: getCatalogItemLogContext(input.item, input.sessionId),
    captureStderrLines: true
  });

  if (result.exitCode !== 0) {
    const fallbackMessage =
      input.captureTimeSeconds === null
        ? 'Poster thumbnail generation failed.'
        : 'Thumbnail capture failed.';
    const message = sanitizeLogText(result.stderr.trim() || result.stdout.trim() || fallbackMessage);
    throw new Error(message);
  }
}

async function generatePosterThumbnail(
  item: CatalogItem,
  sessionId?: string | null
): Promise<CatalogItem> {
  const inputPath = getCatalogItemAbsolutePath(item);
  const outputDescriptor = createPosterThumbnailDescriptor(item);
  invalidateThumbnailCacheFile(outputDescriptor.absolutePath);
  removePathIfExists(outputDescriptor.absolutePath);

  let workingItem = await updateCatalogItemProcessing(
    item.id,
    'poster_thumbnail',
    'Generating poster thumbnail.',
    0,
    'processing',
    sessionId
  );

  writePipelineLog(
    'info',
    'processing.poster_thumbnail.started',
    'Generating poster thumbnail.',
    getCatalogItemLogContext(workingItem, sessionId)
  );

  fs.mkdirSync(path.dirname(outputDescriptor.absolutePath), { recursive: true });

  await runPosterThumbnailCommand({
    item: workingItem,
    inputPath,
    outputPath: outputDescriptor.absolutePath,
    sessionId,
    captureTimeSeconds: null,
    commandLabel: 'ffmpeg poster thumbnail'
  });

  await refreshThumbnailCacheFile(outputDescriptor.absolutePath);

  workingItem = await updateCatalogItemProcessing(
    item.id,
    'hover_thumbnails',
    'Poster thumbnail generated; generating hover preview sprite.',
    0,
    'processing',
    sessionId,
    {
      thumbnailRelativePath: outputDescriptor.relativePath
    }
  );

  writePipelineLog(
    'info',
    'processing.poster_thumbnail.complete',
    'Poster thumbnail generated successfully.',
    getCatalogItemLogContext(workingItem, sessionId),
    {
      thumbnailRelativePath: outputDescriptor.relativePath
    }
  );

  return workingItem;
}

function normalizeThumbnailCaptureTimeSeconds(
  requestedTimeSeconds: number,
  durationSeconds: number | null | undefined
): number {
  const safeRequestedTimeSeconds = Math.max(0, requestedTimeSeconds);

  if (durationSeconds === null || durationSeconds === undefined || durationSeconds <= 0) {
    return safeRequestedTimeSeconds;
  }

  return Math.min(safeRequestedTimeSeconds, Math.max(0, durationSeconds - 0.001));
}

function createThumbnailCacheBustProcessingSnapshot(item: CatalogItem): ProcessingSnapshot {
  if (!item.processing) {
    return createProcessingSnapshot('completed', 'Media processing complete.', 100);
  }

  return {
    ...item.processing,
    updatedAt: new Date().toISOString()
  };
}

async function setCatalogItemThumbnailFromTime(
  item: CatalogItem,
  requestedTimeSeconds: number,
  sessionId?: string | null
): Promise<CatalogItem> {
  const inputPath = getCatalogItemAbsolutePath(item);
  const outputDescriptor = createPosterThumbnailDescriptor(item);
  const captureTimeSeconds = normalizeThumbnailCaptureTimeSeconds(
    requestedTimeSeconds,
    item.probe?.durationSeconds
  );
  const temporaryOutputPath = path.join(
    path.dirname(outputDescriptor.absolutePath),
    `${item.id}-${randomUUID()}.tmp.jpg`
  );

  fs.mkdirSync(path.dirname(outputDescriptor.absolutePath), { recursive: true });

  writePipelineLog(
    'info',
    'thumbnail.current_frame.started',
    'Generating thumbnail from current video frame.',
    getCatalogItemLogContext(item, sessionId),
    {
      requestedTimeSeconds,
      captureTimeSeconds
    }
  );

  try {
    await runPosterThumbnailCommand({
      item,
      inputPath,
      outputPath: temporaryOutputPath,
      sessionId,
      captureTimeSeconds,
      commandLabel: 'ffmpeg current-frame thumbnail'
    });

    invalidateThumbnailCacheFile(outputDescriptor.absolutePath);
    fs.renameSync(temporaryOutputPath, outputDescriptor.absolutePath);
    await refreshThumbnailCacheFile(outputDescriptor.absolutePath);

    const updatedItem = await updateCatalogItemAndBroadcast(
      item.id,
      {
        thumbnailRelativePath: outputDescriptor.relativePath,
        processing: createThumbnailCacheBustProcessingSnapshot(item)
      },
      sessionId,
      {
        includeProcessingEvents: false
      }
    );
    const effectiveItem = requireCatalogItemUpdate(item.id, updatedItem);

    writePipelineLog(
      'info',
      'thumbnail.current_frame.complete',
      'Thumbnail updated from current video frame.',
      getCatalogItemLogContext(effectiveItem, sessionId),
      {
        thumbnailRelativePath: outputDescriptor.relativePath,
        requestedTimeSeconds,
        captureTimeSeconds
      }
    );

    return effectiveItem;
  } finally {
    removePathIfExists(temporaryOutputPath);
  }
}

async function createCatalogItemBookmarkFromTime(
  item: CatalogItem,
  requestedTimeSeconds: number,
  name?: string | null,
  sessionId?: string | null
): Promise<CatalogBookmark> {
  const bookmarkId = randomUUID();
  const inputPath = getCatalogItemAbsolutePath(item);
  const outputDescriptor = createBookmarkThumbnailDescriptor(item, bookmarkId);
  const captureTimeSeconds = normalizeThumbnailCaptureTimeSeconds(
    requestedTimeSeconds,
    item.probe?.durationSeconds
  );
  const temporaryOutputPath = path.join(
    path.dirname(outputDescriptor.absolutePath),
    `${bookmarkId}-${randomUUID()}.tmp.jpg`
  );
  let shouldRemoveFinalOutput = true;

  fs.mkdirSync(path.dirname(outputDescriptor.absolutePath), { recursive: true });

  writePipelineLog(
    'info',
    'bookmark.thumbnail.started',
    'Generating bookmark thumbnail from current video frame.',
    getCatalogItemLogContext(item, sessionId),
    {
      bookmarkId,
      requestedTimeSeconds,
      captureTimeSeconds
    }
  );

  try {
    await runPosterThumbnailCommand({
      item,
      inputPath,
      outputPath: temporaryOutputPath,
      sessionId,
      captureTimeSeconds,
      commandLabel: 'ffmpeg bookmark thumbnail'
    });

    invalidateThumbnailCacheFile(outputDescriptor.absolutePath);
    fs.renameSync(temporaryOutputPath, outputDescriptor.absolutePath);

    const bookmark = await catalogStore.createCatalogItemBookmark({
      id: bookmarkId,
      catalogItemId: item.id,
      name: name ?? null,
      timeSeconds: captureTimeSeconds,
      thumbnailRelativePath: outputDescriptor.relativePath
    });

    if (!bookmark) {
      throw new Error('Catalog item not found.');
    }

    shouldRemoveFinalOutput = false;
    await refreshThumbnailCacheFile(outputDescriptor.absolutePath);

    writePipelineLog(
      'info',
      'bookmark.thumbnail.complete',
      'Bookmark thumbnail generated successfully.',
      getCatalogItemLogContext(item, sessionId),
      {
        bookmarkId: bookmark.id,
        thumbnailRelativePath: bookmark.thumbnailRelativePath,
        requestedTimeSeconds,
        captureTimeSeconds
      }
    );

    return bookmark;
  } finally {
    removePathIfExists(temporaryOutputPath);
    if (shouldRemoveFinalOutput) {
      invalidateThumbnailCacheFile(outputDescriptor.absolutePath);
      removePathIfExists(outputDescriptor.absolutePath);
    }
  }
}

function createHoverPreviewSprite(relativePath: string): HoverPreviewSprite {
  return {
    relativePath,
    frameCount: HOVER_SPRITE_FRAME_COUNT,
    columns: HOVER_SPRITE_COLUMNS,
    rows: HOVER_SPRITE_ROWS,
    frameWidth: HOVER_SPRITE_FRAME_WIDTH,
    frameHeight: HOVER_SPRITE_FRAME_HEIGHT
  };
}

async function generateHoverPreviewSprite(
  item: CatalogItem,
  sessionId?: string | null
): Promise<CatalogItem> {
  const inputPath = getCatalogItemAbsolutePath(item);
  const outputDescriptor = createHoverPreviewDescriptor(item);
  removePathIfExists(outputDescriptor.absolutePath);

  const durationSeconds = item.probe?.durationSeconds ?? null;
  if (durationSeconds === null || durationSeconds <= 0) {
    writePipelineLog(
      'warn',
      'processing.hover_thumbnails.skipped',
      'Skipping hover preview generation because the retained asset duration is unknown.',
      getCatalogItemLogContext(item, sessionId)
    );

    return await updateCatalogItemProcessing(
      item.id,
      'finalizing',
      'Skipping hover preview generation because duration is unknown; finalizing item.',
      null,
      'processing',
      sessionId,
      {
        hoverPreviewSprite: null
      }
    );
  }

  const samplingFps = (HOVER_SPRITE_FRAME_COUNT / Math.max(durationSeconds, 0.001)).toFixed(6);

  fs.mkdirSync(path.dirname(outputDescriptor.absolutePath), { recursive: true });

  try {
    const workingItem = await runFfmpegStage(
      item,
      'hover_thumbnails',
      'Generating hover preview sprite.',
      'Generating hover preview sprite',
      'ffmpeg hover preview sprite',
      [
        '-y',
        '-nostdin',
        '-v',
        'error',
        '-stats_period',
        '0.5',
        '-progress',
        'pipe:1',
        '-i',
        inputPath,
        '-an',
        '-vf',
        `fps=${samplingFps},scale=${HOVER_SPRITE_FRAME_WIDTH}:${HOVER_SPRITE_FRAME_HEIGHT}:force_original_aspect_ratio=decrease,pad=${HOVER_SPRITE_FRAME_WIDTH}:${HOVER_SPRITE_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,tile=${HOVER_SPRITE_COLUMNS}x${HOVER_SPRITE_ROWS}:nb_frames=${HOVER_SPRITE_FRAME_COUNT}`,
        '-frames:v',
        '1',
        '-vsync',
        '0',
        '-q:v',
        '3',
        outputDescriptor.absolutePath
      ],
      durationSeconds,
      sessionId
    );

    const finalItem = await updateCatalogItemProcessing(
      item.id,
      'finalizing',
      'Hover preview sprite generated; finalizing item metadata.',
      null,
      'processing',
      sessionId,
      {
        hoverPreviewSprite: createHoverPreviewSprite(outputDescriptor.relativePath)
      }
    );

    writePipelineLog(
      'info',
      'processing.hover_thumbnails.complete',
      'Hover preview sprite generated successfully.',
      getCatalogItemLogContext(finalItem, sessionId),
      {
        hoverPreviewRelativePath: outputDescriptor.relativePath,
        frameCount: HOVER_SPRITE_FRAME_COUNT,
        sourceDurationSeconds: durationSeconds
      }
    );

    return finalItem;
  } catch (error) {
    const message = sanitizeLogText(
      error instanceof Error ? error.message : 'Hover preview generation failed.'
    );

    const continuedItem = await updateCatalogItemProcessing(
      item.id,
      'finalizing',
      'Hover preview generation failed; continuing without hover preview.',
      null,
      'processing',
      sessionId,
      {
        hoverPreviewSprite: null
      }
    );

    writePipelineLog(
      'warn',
      'processing.hover_thumbnails.failed',
      message,
      getCatalogItemLogContext(continuedItem, sessionId),
      {},
      error
    );

    return continuedItem;
  }
}

async function processCatalogItem(
  item: CatalogItem,
  sessionId?: string | null
): Promise<void> {
  let workingItem = item;

  try {
    const toolAvailability = detectToolAvailability(getToolCommandConfig());
    const missingTools: string[] = [];
    if (catalogItemRequiresSourceDownload(workingItem) && !toolAvailability.ytDlp) {
      missingTools.push('yt-dlp');
    }
    if (!toolAvailability.ffprobe) {
      missingTools.push('ffprobe');
    }
    if (!toolAvailability.ffmpeg) {
      missingTools.push('ffmpeg');
    }

    if (missingTools.length > 0) {
      throw new Error(
        `Media processing cannot start because ${missingTools.join(' and ')} ${
          missingTools.length === 1 ? 'is' : 'are'
        } not available on this server.`
      );
    }

    workingItem = await ensureCatalogItemSourceAcquired(workingItem, sessionId);

    const currentPath = getCatalogItemAbsolutePath(workingItem);
    if (!fs.existsSync(currentPath)) {
      throw new Error('Catalog item source file is missing from storage.');
    }

    writePipelineLog(
      'info',
      'processing.started',
      'Starting downstream media processing.',
      getCatalogItemLogContext(workingItem, sessionId),
      {
        relativePath: workingItem.relativePath,
        sizeBytes: workingItem.sizeBytes
      }
    );

    workingItem = await updateCatalogItemProcessing(
      workingItem.id,
      'ffprobe',
      'Running ffprobe metadata extraction.',
      0,
      'processing',
      sessionId
    );

    const inputProbe = await runFfprobeForFile(currentPath, getCatalogItemLogContext(workingItem, sessionId));
    const describedProbeMessage = `Probe complete: ${inputProbe.width ?? '?'}x${inputProbe.height ?? '?'} · ${formatDurationForDisplay(
      inputProbe.durationSeconds
    )} · ${inputProbe.videoCodec ?? 'unknown-video'}${
      inputProbe.audioPresent ? ` / ${inputProbe.audioCodec ?? 'unknown-audio'}` : ' / no-audio'
    }.`;

    workingItem = await updateCatalogItemProcessing(
      workingItem.id,
      'ffprobe',
      describedProbeMessage,
      100,
      'processing',
      sessionId,
      {
        probe: inputProbe
      }
    );

    writePipelineLog(
      'info',
      'processing.ffprobe.complete',
      describedProbeMessage,
      getCatalogItemLogContext(workingItem, sessionId),
      {
        durationSeconds: inputProbe.durationSeconds,
        width: inputProbe.width,
        height: inputProbe.height,
        fps: inputProbe.fps,
        videoCodec: inputProbe.videoCodec,
        audioCodec: inputProbe.audioCodec,
        containerFormat: inputProbe.containerFormat,
        pixelFormat: inputProbe.pixelFormat
      }
    );

    if (workingItem.sourceType === 'upload') {
      const finalDuplicateCheck = await evaluateUploadDuplicateCheck({
        visibleName: workingItem.visibleName,
        incomingChecksumSha256: workingItem.incomingChecksumSha256,
        sourceUrl: workingItem.sourceUrl,
        excludeItemId: workingItem.id
      });

      const duplicateAuditMessage = finalDuplicateCheck.hasConflicts
        ? 'Final upload duplicate audit still sees matching catalog entries; continuing because ingest was already finalized by the user.'
        : 'Final upload duplicate audit found no new conflicts.';

      workingItem = await updateCatalogItemProcessing(
        workingItem.id,
        'duplicate_validation_final',
        duplicateAuditMessage,
        100,
        'processing',
        sessionId
      );

      writePipelineLog(
        finalDuplicateCheck.hasConflicts ? 'warn' : 'info',
        finalDuplicateCheck.hasConflicts
          ? 'processing.duplicate_validation_final.conflicts'
          : 'processing.duplicate_validation_final.complete',
        duplicateAuditMessage,
        getCatalogItemLogContext(workingItem, sessionId),
        finalDuplicateCheck.hasConflicts
          ? {
              duplicateReasons: finalDuplicateCheck.reasons.map((reason) => reason.code),
              duplicateCount: finalDuplicateCheck.reasons.length
            }
          : {}
      );
    }

    const retentionPlan = createMediaRetentionPlan(workingItem, inputProbe);
    const inputProbeWithSafety: MediaProbeInfo = {
      ...inputProbe,
      isBrowserSafeInput: retentionPlan.inputIsBrowserSafe
    };

    workingItem = await updateCatalogItemProcessing(
      workingItem.id,
      'retention_decision',
      retentionPlan.description,
      100,
      'processing',
      sessionId,
      {
        probe: inputProbeWithSafety
      }
    );

    writePipelineLog(
      'info',
      'processing.retention.decision',
      retentionPlan.description,
      getCatalogItemLogContext(workingItem, sessionId),
      {
        decision: retentionPlan.decision,
        inputIsBrowserSafe: retentionPlan.inputIsBrowserSafe
      }
    );

    workingItem = await applyRetentionPlan(workingItem, inputProbeWithSafety, retentionPlan, sessionId);
    workingItem = await generatePosterThumbnail(workingItem, sessionId);
    workingItem = await generateHoverPreviewSprite(workingItem, sessionId);

    workingItem = await updateCatalogItemProcessing(
      workingItem.id,
      'completed',
      'Media processing complete.',
      100,
      'ready',
      sessionId
    );

    writePipelineLog(
      'info',
      'processing.completed',
      'Downstream media processing completed successfully.',
      getCatalogItemLogContext(workingItem, sessionId),
      {
        relativePath: workingItem.relativePath,
        thumbnailRelativePath: workingItem.thumbnailRelativePath,
        hoverPreviewRelativePath: workingItem.hoverPreviewSprite?.relativePath ?? null,
        retainedChecksumSha256: abbreviateChecksum(workingItem.retainedChecksumSha256)
      }
    );
  } catch (error) {
    const failureMessage = sanitizeLogText(
      error instanceof Error ? error.message : 'Downstream media processing failed.'
    );

    if (!catalogStore.findById(workingItem.id)) {
      writePipelineLog(
        'warn',
        'processing.aborted.deleted',
        'Stopped processing because the catalog item was deleted.',
        getCatalogItemLogContext(workingItem, sessionId),
        {},
        error
      );
      return;
    }

    try {
      await markCatalogItemFailed(workingItem, failureMessage, sessionId, error);
    } catch (failureUpdateError) {
      if (!catalogStore.findById(workingItem.id)) {
        writePipelineLog(
          'warn',
          'processing.failure_update.skipped_deleted',
          'Skipped failure-state update because the catalog item was deleted.',
          getCatalogItemLogContext(workingItem, sessionId),
          {},
          failureUpdateError
        );
        return;
      }

      app.log.error(
        { err: failureUpdateError, itemId: workingItem.id },
        'Failed to persist catalog item processing failure.'
      );
    }
  } finally {
    cleanupProcessingWorkRoot(item.id);
  }
}

function collectProcessOutput(
  stream: NodeJS.ReadableStream,
  onChunk: (text: string) => void,
  onLine?: (line: string) => void
): void {
  let buffer = '';

  stream.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString();
    onChunk(text);

    if (!onLine) {
      return;
    }

    buffer += text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  });

  stream.on('end', () => {
    if (onLine && buffer.trim() !== '') {
      onLine(buffer);
    }
  });
}

function createPendingIngestResponseMessage(pendingIngest: PendingIngest): string {
  return `Awaiting duplicate resolution: ${summarizeDuplicateReasons(pendingIngest.duplicateCheck.reasons)}.`;
}

function isAuthenticated(request: FastifyRequest): boolean {
  return Boolean(sessionStore.peek(getSessionId(request)));
}

function getAuthenticatedSessionId(
  request: FastifyRequest,
  reply: FastifyReply
): string | null {
  const sessionId = getSessionId(request);
  if (!sessionStore.get(sessionId)) {
    reply.code(401).send({ authenticated: false });
    return null;
  }

  return sessionId ?? null;
}

function getHeaderFirstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeWebSocketOriginForCheck(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    } else if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return null;
  }
}

function getHostnameFromOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getHostnameFromHostHeader(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const firstHost = value.split(',')[0]?.trim();
  if (!firstHost) {
    return null;
  }

  try {
    return new URL(`http://${firstHost}`).hostname.toLowerCase();
  } catch {
    return firstHost.replace(/^\[/, '').replace(/\]$/, '').split(':')[0]?.toLowerCase() ?? null;
  }
}

function isLoopbackHostname(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '127.0.0.1' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function getRequestHostnames(request: FastifyRequest): string[] {
  const hostnames = [
    getHostnameFromHostHeader(getHeaderFirstValue(request.headers.host)),
    config.trustProxy ? getHostnameFromHostHeader(getHeaderFirstValue(request.headers['x-forwarded-host'])) : null,
    typeof request.hostname === 'string' ? request.hostname.toLowerCase() : null
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(hostnames));
}

function isOriginHostCompatibleWithRequest(request: FastifyRequest, normalizedOrigin: string): boolean {
  const originHostname = getHostnameFromOrigin(normalizedOrigin);
  const requestHostnames = getRequestHostnames(request);

  if (!originHostname) {
    return false;
  }

  if (requestHostnames.includes(originHostname)) {
    return true;
  }

  return (
    process.env.NODE_ENV !== 'production' &&
    isLoopbackHostname(originHostname) &&
    requestHostnames.some((hostname) => isLoopbackHostname(hostname))
  );
}

function isAllowedWebSocketOrigin(request: FastifyRequest): boolean {
  const rawOrigin = getHeaderFirstValue(request.headers.origin);
  const normalizedOrigin = rawOrigin ? normalizeWebSocketOriginForCheck(rawOrigin) : null;

  if (config.wsAllowedOrigins.length === 0) {
    return !normalizedOrigin || isOriginHostCompatibleWithRequest(request, normalizedOrigin);
  }

  if (!normalizedOrigin) {
    return false;
  }

  const normalizedAllowedOrigins = config.wsAllowedOrigins
    .map((allowedOrigin) => normalizeWebSocketOriginForCheck(allowedOrigin))
    .filter((allowedOrigin): allowedOrigin is string => Boolean(allowedOrigin));

  if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production') {
    const originHostname = getHostnameFromOrigin(normalizedOrigin);
    const requestHostnames = getRequestHostnames(request);
    if (isLoopbackHostname(originHostname) && requestHostnames.some((hostname) => isLoopbackHostname(hostname))) {
      return true;
    }
  }

  return false;
}

function sendSocketMessage(socket: SessionSocket, message: SocketMessage): boolean {
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    app.log.warn(
      {
        event: 'socket.send.failed',
        socketMessageType: message.type,
        err: error
      },
      'Failed to send WebSocket message.'
    );
    return false;
  }
}

function registerSocket(socketState: SessionSocketState): void {
  const existing = socketsBySessionId.get(socketState.sessionId);
  if (existing) {
    existing.set(socketState.connectionId, socketState);
    return;
  }

  socketsBySessionId.set(
    socketState.sessionId,
    new Map<string, SessionSocketState>([[socketState.connectionId, socketState]])
  );
}

function unregisterSocket(sessionId: string, connectionId: string): void {
  const existing = socketsBySessionId.get(sessionId);
  if (!existing) {
    return;
  }

  existing.delete(connectionId);
  if (existing.size === 0) {
    socketsBySessionId.delete(sessionId);
  }
}

function closeSessionSockets(
  sessionId: string | undefined,
  closeCode: number,
  reason: string,
  notifyLocked: boolean,
  authReason: AuthTerminationReason = 'panic'
): void {
  if (!sessionId) {
    return;
  }

  const existing = socketsBySessionId.get(sessionId);
  if (!existing) {
    return;
  }

  const authEventName = authReason === 'expired' ? 'auth.expired' : 'auth.locked';

  for (const socketState of existing.values()) {
    if (notifyLocked) {
      try {
        sendSocketMessage(socketState.socket, {
          type: 'evt',
          name: authEventName,
          data: {
            locked: true,
            reason: authReason
          }
        });
        sendSocketMessage(socketState.socket, {
          type: 'panic',
          payload: {
            locked: true
          }
        });
      } catch {
        // Ignore socket send failures during forced close.
      }
    }

    try {
      socketState.socket.close(closeCode, reason);
    } catch {
      // Ignore socket close failures during forced close.
    }
  }

  socketsBySessionId.delete(sessionId);
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

function readQueryString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((candidate): candidate is string => typeof candidate === 'string');
    return first ?? null;
  }

  return null;
}

function parseSocketCommandId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

type ParsedIncomingSocketMessage =
  | {
      kind: 'cmd';
      message: SocketCommandMessage;
    }
  | {
      kind: 'legacy';
      message: {
        type?: string;
      };
    }
  | {
      kind: 'invalid';
    };

function parseIncomingSocketMessage(eventData: Buffer | string): ParsedIncomingSocketMessage {
  const raw = typeof eventData === 'string' ? eventData : eventData.toString();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {
        kind: 'invalid'
      };
    }

    const parsedType = readString(parsed.type);
    if (parsedType === 'cmd') {
      const id = parseSocketCommandId(parsed.id);
      const name = readString(parsed.name);
      if (!id || !name) {
        return {
          kind: 'invalid'
        };
      }

      return {
        kind: 'cmd',
        message: {
          id,
          type: 'cmd',
          name: name as SocketCommandMessage['name'],
          payload: parsed.payload
        }
      };
    }

    return {
      kind: 'legacy',
      message: {
        type: parsedType ?? undefined
      }
    };
  } catch {
    return {
      kind: 'invalid'
    };
  }
}

function parseCatalogQueryPayload(payload: unknown): CatalogQueryInput | null {
  if (payload === undefined) {
    return createDefaultCatalogQueryInput();
  }

  if (!isRecord(payload)) {
    return null;
  }

  const searchValue = payload.search === undefined || payload.search === null ? null : readString(payload.search);
  const sourceTypeValue = payload.sourceType === undefined || payload.sourceType === null ? null : readString(payload.sourceType);
  const statusValue = payload.status === undefined || payload.status === null ? null : readString(payload.status);
  const sortValue = payload.sort === undefined || payload.sort === null ? 'newest' : readString(payload.sort);
  const tagIdsValue = payload.tagIds === undefined || payload.tagIds === null ? [] : payload.tagIds;

  if (payload.search !== undefined && payload.search !== null && searchValue === null) {
    return null;
  }

  if (sourceTypeValue !== null && sourceTypeValue !== 'upload' && sourceTypeValue !== 'yt_dlp') {
    return null;
  }

  if (
    statusValue !== null &&
    statusValue !== 'uploaded' &&
    statusValue !== 'pending_duplicate_check' &&
    statusValue !== 'pending_processing' &&
    statusValue !== 'processing' &&
    statusValue !== 'ready' &&
    statusValue !== 'failed'
  ) {
    return null;
  }

  if (!sortValue || !isCatalogQuerySort(sortValue)) {
    return null;
  }

  if (!Array.isArray(tagIdsValue)) {
    return null;
  }

  const tagIds: string[] = [];
  for (const tagIdValue of tagIdsValue) {
    const tagId = readString(tagIdValue);
    if (tagId === null) {
      return null;
    }

    const trimmedTagId = tagId.trim();
    if (trimmedTagId !== '' && !tagIds.includes(trimmedTagId)) {
      tagIds.push(trimmedTagId);
    }
  }

  return {
    search: searchValue ? searchValue.trim() || null : null,
    sourceType: sourceTypeValue as CatalogItemSourceType | null,
    status: statusValue as CatalogItemStatus | null,
    tagIds,
    sort: sortValue
  };
}

function parseCatalogTagRequestBody(body: unknown): { label: string } | null {
  if (!isRecord(body)) {
    return null;
  }

  const label = readString(body.label);
  if (label === null) {
    return null;
  }

  const normalizedLabel = normalizeCatalogTagLabel(label);
  return normalizedLabel === '' ? null : { label: normalizedLabel };
}

function parseCatalogTagListQuery(query: unknown, fallbackLimit = 10): { search: string | null; limit: number } {
  const record: Record<string, unknown> = isRecord(query) ? query : {};
  const rawSearch = readQueryString(record.search);
  const rawLimit = readQueryString(record.limit);
  const parsedLimit = rawLimit === null ? null : readNumber(rawLimit);

  const limit =
    parsedLimit === null || parsedLimit < 1
      ? fallbackLimit
      : Math.max(1, Math.min(50, Math.floor(parsedLimit)));

  return {
    search: rawSearch ? normalizeCatalogTagLabel(rawSearch) || null : null,
    limit
  };
}

function parseCatalogTagIdParam(request: FastifyRequest): string | null {
  const params: Record<string, unknown> = isRecord(request.params) ? request.params : {};
  const tagId = readString(params.tagId);
  return tagId ? tagId.trim() || null : null;
}

function parseVideoGetPayload(payload: unknown): { itemId: string } | null {
  if (!isRecord(payload)) {
    return null;
  }

  const itemId = readString(payload.itemId);
  if (!itemId) {
    return null;
  }

  return {
    itemId
  };
}

function parseJobsSubscribePayload(payload: unknown): { enabled: boolean } | null {
  if (payload === undefined) {
    return {
      enabled: true
    };
  }

  if (!isRecord(payload)) {
    return null;
  }

  const enabled = payload.enabled;
  if (enabled === undefined) {
    return {
      enabled: true
    };
  }

  if (typeof enabled !== 'boolean') {
    return null;
  }

  return {
    enabled
  };
}

function parseSocketDuplicateResolutionPayload(
  payload: unknown
): { pendingIngestId: string; action: DuplicateResolutionAction; visibleName: string | null } | null {
  if (!isRecord(payload)) {
    return null;
  }

  const pendingIngestId = readString(payload.pendingIngestId);
  const action = readString(payload.action);
  const visibleName = payload.visibleName === undefined || payload.visibleName === null ? null : readString(payload.visibleName);

  if (!pendingIngestId || (action !== 'continue' && action !== 'cancel')) {
    return null;
  }

  if (payload.visibleName !== undefined && payload.visibleName !== null && visibleName === null) {
    return null;
  }

  return {
    pendingIngestId,
    action,
    visibleName
  };
}

function normalizeVisibleNameInput(value: string, fallbackValue: string): string {
  const trimmed = value.trim();
  return trimmed === '' ? fallbackValue : trimmed;
}

function createTransientPendingIngest(input: {
  sourceType: PendingIngest['sourceType'];
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
}): PendingIngest {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    sourceType: input.sourceType,
    originalIngestName: input.originalIngestName,
    visibleName: input.visibleName,
    normalizedVisibleName: input.visibleName
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase(),
    sourceUrl: input.sourceUrl ?? null,
    sourceSite: input.sourceSite ?? null,
    sourceRemoteId: input.sourceRemoteId ?? null,
    tempRelativePath: input.tempRelativePath ?? null,
    sizeBytes: input.sizeBytes ?? null,
    incomingChecksumSha256: input.incomingChecksumSha256 ?? null,
    duplicateCheck: input.duplicateCheck ?? {
      hasConflicts: false,
      reasons: [],
      existingItems: []
    },
    acknowledgedReasons: input.acknowledgedReasons ?? [],
    downloadState: input.downloadState ?? 'not_started',
    processing: null
  };
}

function duplicateReasonKey(reason: DuplicateReason): string {
  return `${reason.code}:${reason.existingItemId}`;
}

function mergeDuplicateReasons(
  left: DuplicateReason[],
  right: DuplicateReason[]
): DuplicateReason[] {
  const merged: DuplicateReason[] = [];
  const seen = new Set<string>();

  for (const candidate of [...left, ...right]) {
    const key = duplicateReasonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(candidate);
  }

  return merged;
}

function getUnacknowledgedDuplicateReasons(
  duplicateCheck: DuplicateCheck,
  acknowledgedReasons: DuplicateReason[]
): DuplicateReason[] {
  const acknowledged = new Set<string>(acknowledgedReasons.map(duplicateReasonKey));
  return duplicateCheck.reasons.filter((reason) => !acknowledged.has(duplicateReasonKey(reason)));
}

function createPendingIngestResponse(pendingIngest: PendingIngest): IngestDuplicateResponse {
  return {
    ok: true,
    requiresResolution: true,
    pendingIngest,
    duplicateCheck: pendingIngest.duplicateCheck
  };
}

function createManagedStoredName(pendingIngest: PendingIngest): string {
  const extensionSource = pendingIngest.tempRelativePath ?? pendingIngest.originalIngestName;
  const extension = path.extname(extensionSource).toLowerCase();
  const safeExtension = extension.length <= 16 ? extension : '';
  return `${Date.now()}-${randomUUID()}${safeExtension}`;
}

function removePathIfExists(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, {
      recursive: true,
      force: true
    });
    return;
  }

  fs.rmSync(targetPath, {
    force: true
  });
}

function cleanupPendingArtifacts(pendingIngest: PendingIngest): void {
  if (pendingIngest.tempRelativePath) {
    removePathIfExists(path.join(config.mediaRoot, pendingIngest.tempRelativePath));
  }

  if (pendingIngest.sourceType === 'yt_dlp') {
    removePathIfExists(path.join(config.ytDlpTempRoot, pendingIngest.id));
  }
}

async function computeFileChecksum(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
    });

    stream.on('error', (error: Error) => {
      reject(error);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

async function writeStreamToFileAndHash(
  source: NodeJS.ReadableStream,
  targetPath: string,
  options?: {
    onProgress?: (sizeBytes: number) => void;
  }
): Promise<{ sizeBytes: number; checksum: string }> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const hash = createHash('sha256');
  let sizeBytes = 0;

  const hashingTransform = new Transform({
    transform(
      chunk: Buffer | string,
      _encoding: string,
      callback: (error?: Error | null, data?: Buffer | Uint8Array | string) => void
    ) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.length;
      hash.update(buffer);
      options?.onProgress?.(sizeBytes);
      callback(null, buffer);
    }
  });

  await pipeline(source, hashingTransform, fs.createWriteStream(targetPath));

  return {
    sizeBytes,
    checksum: hash.digest('hex')
  };
}

async function finalizePendingIngest(pendingIngest: PendingIngest): Promise<CatalogItem> {
  if (!pendingIngest.tempRelativePath) {
    throw new Error('Pending ingest has no staged file to finalize.');
  }

  const temporaryAbsolutePath = path.join(config.mediaRoot, pendingIngest.tempRelativePath);
  if (!fs.existsSync(temporaryAbsolutePath)) {
    throw new Error('Pending ingest file is missing from temporary storage.');
  }

  const storedName = createManagedStoredName(pendingIngest);
  const targetPath = path.join(config.incomingRoot, storedName);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(temporaryAbsolutePath, targetPath);

  try {
    const sizeBytes = pendingIngest.sizeBytes ?? fs.statSync(targetPath).size;
    const item = await catalogStore.promotePendingIngestToCatalogItem({
      pendingIngestId: pendingIngest.id,
      originalName: pendingIngest.visibleName,
      originalIngestName: pendingIngest.originalIngestName,
      storedName,
      sizeBytes,
      relativePath: path.relative(config.mediaRoot, targetPath),
      status: 'pending_processing',
      incomingChecksumSha256: pendingIngest.incomingChecksumSha256,
      sourceType: pendingIngest.sourceType,
      sourceUrl: pendingIngest.sourceUrl,
      sourceSite: pendingIngest.sourceSite,
      sourceRemoteId: pendingIngest.sourceRemoteId,
      thumbnailRelativePath: null,
      hoverPreviewSprite: null,
      probe: null,
      processing: createCatalogItemProcessingSnapshotForSource(
        pendingIngest.sourceType,
        'queued',
        'Catalog item accepted; queued for downstream media processing.',
        0
      )
    });

    if (pendingIngest.sourceType === 'yt_dlp') {
      removePathIfExists(path.join(config.ytDlpTempRoot, pendingIngest.id));
    }

    return item;
  } catch (error) {
    if (!fs.existsSync(temporaryAbsolutePath) && fs.existsSync(targetPath)) {
      fs.mkdirSync(path.dirname(temporaryAbsolutePath), { recursive: true });
      fs.renameSync(targetPath, temporaryAbsolutePath);
    }

    throw error;
  }
}

async function createCatalogItemFromPendingYtDlpImport(
  pendingIngest: PendingIngest,
  sessionId?: string | null
): Promise<CatalogItem> {
  const placeholderDescriptor = createIncomingSourceDescriptor(createYtDlpPlaceholderStoredName());

  const item = await catalogStore.promotePendingIngestToCatalogItem({
    pendingIngestId: pendingIngest.id,
    originalName: pendingIngest.visibleName,
    originalIngestName: pendingIngest.originalIngestName,
    storedName: placeholderDescriptor.storedName,
    sizeBytes: 0,
    relativePath: placeholderDescriptor.relativePath,
    status: 'pending_processing',
    incomingChecksumSha256: null,
    retainedChecksumSha256: null,
    sourceType: 'yt_dlp',
    sourceUrl: pendingIngest.sourceUrl,
    sourceSite: pendingIngest.sourceSite,
    sourceRemoteId: pendingIngest.sourceRemoteId,
    thumbnailRelativePath: null,
    hoverPreviewSprite: null,
    probe: null,
    processing: createCatalogItemProcessingSnapshotForSource(
      'yt_dlp',
      'queued',
      'Catalog item created; queued to download source media.',
      0
    )
  });

  broadcastPendingIngestDeleted(pendingIngest.id, sessionId);
  broadcastCatalogItemUpdated(item, sessionId);

  writePipelineLog(
    'info',
    'yt_dlp.catalog_item.created',
    'Created catalog item before starting yt-dlp source download.',
    getCatalogItemLogContext(item, sessionId),
    {
      relativePath: item.relativePath,
      sourceSite: item.sourceSite,
      sourceRemoteId: item.sourceRemoteId
    }
  );

  return item;
}

function findSingleDownloadedFile(directoryPath: string): string {
  const fileNames = fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry: { isFile(): boolean }) => entry.isFile())
    .map((entry: { name: string }) => entry.name)
    .filter((fileName: string) => !fileName.endsWith('.part'));

  if (fileNames.length !== 1) {
    throw new Error(
      `Expected exactly one downloaded file in ${directoryPath}, found ${fileNames.length}.`
    );
  }

  return path.join(directoryPath, fileNames[0]);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function deriveNameFromUrl(urlValue: string): string {
  try {
    const parsed = new URL(urlValue);
    const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
    const lastSegment = segments.at(-1);
    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }

    return parsed.hostname;
  } catch {
    return urlValue;
  }
}

function parseYtDlpMetadataResult(raw: string, fallbackUrl: string): YtDlpMetadata {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('yt-dlp metadata response was not a JSON object.');
  }

  if (Array.isArray(parsed.entries)) {
    throw new Error('Playlist imports are not supported by this scaffold yet.');
  }

  const title = readString(parsed.title) ?? deriveNameFromUrl(fallbackUrl);
  const sourceUrl =
    readString(parsed.webpage_url) ?? readString(parsed.original_url) ?? fallbackUrl;

  return {
    title,
    sourceUrl,
    sourceSite: readString(parsed.extractor),
    sourceRemoteId: readString(parsed.id)
  };
}

function parseResolutionAction(value: unknown): DuplicateResolutionAction | null {
  return value === 'continue' || value === 'cancel' ? value : null;
}

function parseDuplicateResolutionBody(body: unknown): {
  action: DuplicateResolutionAction;
  visibleName: string | null;
} | null {
  if (!isRecord(body)) {
    return null;
  }

  const action = parseResolutionAction(body.action);
  if (!action) {
    return null;
  }

  return {
    action,
    visibleName: readString(body.visibleName)
  };
}

function parseCatalogItemRenameBody(body: unknown): { visibleName: string } | null {
  if (!isRecord(body)) {
    return null;
  }

  const visibleName = readString(body.visibleName);
  if (visibleName === null) {
    return null;
  }

  const trimmedVisibleName = visibleName.trim();
  if (trimmedVisibleName === '') {
    return null;
  }

  return {
    visibleName: trimmedVisibleName
  };
}

function parseYtDlpCreateBody(body: unknown): { url: string } | null {
  if (!isRecord(body)) {
    return null;
  }

  const urlValue = readString(body.url);
  if (!urlValue) {
    return null;
  }

  return {
    url: urlValue.trim()
  };
}

function parseThumbnailCaptureBody(body: unknown): { timeSeconds: number } | null {
  if (!isRecord(body)) {
    return null;
  }

  const timeSeconds = readUnknownNumber(body.timeSeconds);
  if (timeSeconds === null || timeSeconds < 0) {
    return null;
  }

  return {
    timeSeconds
  };
}

const VIEWER_VISUAL_ADJUSTMENT_MIN = 0;
const VIEWER_VISUAL_ADJUSTMENT_MAX = 2;

function normalizeViewerVisualAdjustmentValue(value: unknown): number | null {
  const parsedValue = readUnknownNumber(value);
  if (parsedValue === null) {
    return null;
  }

  return Math.min(VIEWER_VISUAL_ADJUSTMENT_MAX, Math.max(VIEWER_VISUAL_ADJUSTMENT_MIN, parsedValue));
}

function parseViewerVisualAdjustmentsBody(body: unknown): ViewerVisualAdjustments | null {
  if (!isRecord(body)) {
    return null;
  }

  const contrast = normalizeViewerVisualAdjustmentValue(body.contrast);
  const brightness = normalizeViewerVisualAdjustmentValue(body.brightness);
  const saturation = normalizeViewerVisualAdjustmentValue(body.saturation);
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : null;

  if (contrast === null || brightness === null || saturation === null || enabled === null) {
    return null;
  }

  return {
    contrast,
    brightness,
    saturation,
    enabled
  };
}

function normalizeBookmarkNameInput(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseBookmarkNameValue(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }

  const name = readString(value);
  if (name === null) {
    return undefined;
  }

  return normalizeBookmarkNameInput(name);
}

function parseBookmarkCreateBody(body: unknown): { timeSeconds: number; name: string | null } | null {
  const parsedTime = parseThumbnailCaptureBody(body);
  if (!parsedTime || !isRecord(body)) {
    return null;
  }

  const parsedName = parseBookmarkNameValue(body.name);
  if (parsedName === undefined) {
    return null;
  }

  return {
    timeSeconds: parsedTime.timeSeconds,
    name: parsedName
  };
}

function parseBookmarkUpdateBody(body: unknown): { name: string | null } | null {
  if (!isRecord(body) || !Object.prototype.hasOwnProperty.call(body, 'name')) {
    return null;
  }

  const parsedName = parseBookmarkNameValue(body.name);
  if (parsedName === undefined) {
    return null;
  }

  return {
    name: parsedName
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  const commandLabel = options.commandLabel ?? command;
  writePipelineLog(
    'info',
    'command.start',
    `Starting ${commandLabel}.`,
    options.logContext ?? {},
    {
      command,
      argCount: args.length
    }
  );

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const trackedItemId = options.logContext?.itemId ?? null;
    let isCommandProcessUnregistered = false;

    if (trackedItemId) {
      const activeProcesses = activeCommandProcessesByItemId.get(trackedItemId) ?? new Set();
      activeProcesses.add(child);
      activeCommandProcessesByItemId.set(trackedItemId, activeProcesses);
    }

    const unregisterCommandProcess = (): void => {
      if (!trackedItemId || isCommandProcessUnregistered) {
        return;
      }

      isCommandProcessUnregistered = true;
      const activeProcesses = activeCommandProcessesByItemId.get(trackedItemId);
      if (!activeProcesses) {
        return;
      }

      activeProcesses.delete(child);
      if (activeProcesses.size === 0) {
        activeCommandProcessesByItemId.delete(trackedItemId);
      }
    };

    let stdout = '';
    let stderr = '';

    collectProcessOutput(
      child.stdout,
      (text) => {
        stdout += text;
      },
      (line) => {
        const cleanedLine = sanitizeLogText(line);
        if (cleanedLine === '') {
          return;
        }

        if (options.onStdoutLine) {
          options.onStdoutLine(cleanedLine);
        }

        if (options.captureStdoutLines) {
          writePipelineLog(
            'info',
            'command.stdout.line',
            cleanedLine,
            options.logContext ?? {},
            {
              commandLabel,
              stream: 'stdout'
            }
          );
        }
      }
    );

    collectProcessOutput(
      child.stderr,
      (text) => {
        stderr += text;
      },
      (line) => {
        const cleanedLine = sanitizeLogText(line);
        if (cleanedLine === '') {
          return;
        }

        if (options.onStderrLine) {
          options.onStderrLine(cleanedLine);
        }

        if (options.captureStderrLines) {
          writePipelineLog(
            'info',
            'command.stderr.line',
            cleanedLine,
            options.logContext ?? {},
            {
              commandLabel,
              stream: 'stderr'
            }
          );
        }
      }
    );

    child.on('error', (error) => {
      unregisterCommandProcess();
      writePipelineLog(
        'error',
        'command.spawn.failed',
        `Failed to start ${commandLabel}.`,
        options.logContext ?? {},
        {
          command,
          argCount: args.length
        },
        error
      );
      reject(error);
    });

    child.on('close', (exitCode) => {
      unregisterCommandProcess();
      const result: CommandResult = {
        exitCode: exitCode ?? -1,
        stdout,
        stderr
      };

      const details: Record<string, unknown> = {
        commandLabel,
        exitCode: result.exitCode,
        stdoutBytes: Buffer.byteLength(stdout),
        stderrBytes: Buffer.byteLength(stderr)
      };

      if (result.exitCode === 0) {
        writePipelineLog(
          'info',
          'command.complete',
          `${commandLabel} completed.`,
          options.logContext ?? {},
          details
        );
      } else {
        writePipelineLog(
          'warn',
          'command.complete.non_zero',
          `${commandLabel} exited with a non-zero status.`,
          options.logContext ?? {},
          details
        );
      }

      resolve(result);
    });
  });
}

async function fetchYtDlpMetadata(
  urlValue: string,
  logContext: PipelineLogContext
): Promise<YtDlpMetadata> {
  const result = await runCommand(
    config.ytDlpCommand,
    ['--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', urlValue],
    {
      commandLabel: 'yt-dlp metadata lookup',
      logContext,
      captureStderrLines: true
    }
  );

  if (result.exitCode !== 0) {
    const message = sanitizeLogText(
      result.stderr.trim() || result.stdout.trim() || 'yt-dlp metadata lookup failed.'
    );
    writePipelineLog('error', 'yt_dlp.metadata.failed', message, logContext, {
      exitCode: result.exitCode
    });
    throw new Error(message);
  }

  const metadata = parseYtDlpMetadataResult(result.stdout, urlValue);
  writePipelineLog(
    'info',
    'yt_dlp.metadata.complete',
    'yt-dlp metadata lookup succeeded.',
    {
      ...logContext,
      visibleName: metadata.title,
      sourceUrl: metadata.sourceUrl
    },
    {
      sourceSite: metadata.sourceSite,
      sourceRemoteId: metadata.sourceRemoteId,
      stdoutBytes: Buffer.byteLength(result.stdout)
    }
  );

  return metadata;
}

async function downloadCatalogItemSource(
  item: CatalogItem,
  sessionId?: string | null
): Promise<CatalogItem> {
  if (!item.sourceUrl) {
    throw new Error('Catalog item is missing its source URL.');
  }

  const sourceUrl = item.sourceUrl;

  let workingItem = await updateCatalogItemProcessing(
    item.id,
    'downloading_source',
    'Starting yt-dlp source download.',
    0,
    'processing',
    sessionId
  );

  const workingDirectory = getYtDlpDownloadWorkRoot(workingItem.id);
  const downloadHome = path.join(workingDirectory, 'home');
  const downloadTemp = path.join(workingDirectory, 'temp');

  removePathIfExists(downloadHome);
  removePathIfExists(downloadTemp);
  fs.mkdirSync(downloadHome, { recursive: true });
  fs.mkdirSync(downloadTemp, { recursive: true });

  const progressState = {
    lastPercent: -1,
    lastLoggedAt: 0,
    lastMessage: ''
  };

  const handleProgressLine = (line: string): void => {
    const cleanedLine = sanitizeLogText(line);
    if (cleanedLine === '') {
      return;
    }

    const percent = extractPercentFromText(cleanedLine);
    const normalizedPercent = percent === null ? null : Math.floor(percent);
    const now = Date.now();
    const percentChanged = normalizedPercent !== null && normalizedPercent !== progressState.lastPercent;
    const messageChanged = cleanedLine !== progressState.lastMessage;
    const timeElapsed = now - progressState.lastLoggedAt >= 1500;

    if (!percentChanged && !(messageChanged && timeElapsed)) {
      return;
    }

    progressState.lastPercent = normalizedPercent ?? progressState.lastPercent;
    progressState.lastLoggedAt = now;
    progressState.lastMessage = cleanedLine;

    void updateCatalogItemProcessing(
      workingItem.id,
      'downloading_source',
      cleanedLine,
      percent,
      'processing',
      sessionId
    )
      .then((updatedItem) => {
        workingItem = updatedItem;
      })
      .catch((error: unknown) => {
        app.log.error(
          {
            event: 'yt_dlp.download.progress.persist_failed',
            itemId: workingItem.id,
            stage: 'downloading_source',
            error
          },
          'Failed to persist catalog-item yt-dlp download progress update.'
        );
      });

    writePipelineLog(
      'info',
      'yt_dlp.download.progress',
      cleanedLine,
      getCatalogItemLogContext(workingItem, sessionId),
      {
        percent
      }
    );
  };

  try {
    const result = await runCommand(
      config.ytDlpCommand,
      [
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--no-part',
        '--paths',
        `home:${downloadHome}`,
        '--paths',
        `temp:${downloadTemp}`,
        '--output',
        'download.%(ext)s',
        sourceUrl
      ],
      {
        commandLabel: 'yt-dlp source download',
        logContext: getCatalogItemLogContext(workingItem, sessionId),
        onStdoutLine: handleProgressLine,
        onStderrLine: handleProgressLine
      }
    );

    if (result.exitCode !== 0) {
      const message = sanitizeLogText(
        result.stderr.trim() || result.stdout.trim() || 'yt-dlp source download failed.'
      );
      writePipelineLog(
        'error',
        'yt_dlp.download.failed',
        message,
        getCatalogItemLogContext(workingItem, sessionId),
        {
          exitCode: result.exitCode
        }
      );
      throw new Error(message);
    }

    const downloadedFilePath = findSingleDownloadedFile(downloadHome);
    const stat = fs.statSync(downloadedFilePath);
    const sourceDescriptor = createCatalogItemSourceDescriptor(
      workingItem,
      path.extname(downloadedFilePath).toLowerCase()
    );

    removePathIfExists(sourceDescriptor.absolutePath);
    fs.mkdirSync(path.dirname(sourceDescriptor.absolutePath), { recursive: true });
    fs.renameSync(downloadedFilePath, sourceDescriptor.absolutePath);

    workingItem = await updateCatalogItemProcessing(
      workingItem.id,
      'source_download_complete',
      'Source download complete; starting ffprobe.',
      100,
      'processing',
      sessionId,
      {
        storedName: sourceDescriptor.storedName,
        relativePath: sourceDescriptor.relativePath,
        sizeBytes: stat.size,
        incomingChecksumSha256: null
      }
    );

    writePipelineLog(
      'info',
      'yt_dlp.download.complete',
      'yt-dlp source download finished and was attached to the catalog item.',
      getCatalogItemLogContext(workingItem, sessionId),
      {
        sizeBytes: stat.size,
        relativePath: workingItem.relativePath
      }
    );

    return workingItem;
  } finally {
    cleanupYtDlpDownloadWorkRoot(item.id);
  }
}

async function ensureCatalogItemSourceAcquired(
  item: CatalogItem,
  sessionId?: string | null
): Promise<CatalogItem> {
  if (item.sourceType !== 'yt_dlp') {
    return item;
  }

  const reconciledItem = await reconcileCatalogItemSourceVariant(item, sessionId);
  if (!catalogItemRequiresSourceDownload(reconciledItem)) {
    return reconciledItem;
  }

  return await downloadCatalogItemSource(reconciledItem, sessionId);
}

async function stageValidatedUpload(
  request: FastifyRequest,
  sessionId: string
): Promise<IngestHttpResponse> {
  const file = await request.file();
  if (!file) {
    return {
      ok: false,
      message: 'No file was provided.'
    };
  }

  const originalIngestName = file.filename || 'unnamed-upload';
  const temporaryFilePath = path.join(
    config.uploadTempRoot,
    `${randomUUID()}${path.extname(originalIngestName).toLowerCase()}`
  );

  let pendingIngest = await catalogStore.createPendingIngest({
    sourceType: 'upload',
    originalIngestName,
    visibleName: originalIngestName,
    tempRelativePath: path.relative(config.mediaRoot, temporaryFilePath),
    downloadState: 'not_started',
    processing: createProcessingSnapshot('downloading', 'Upload stream opened; receiving file data.', null)
  });

  broadcastPendingIngestUpdated(pendingIngest, sessionId);
  writePipelineLog(
    'info',
    'upload.started',
    'Upload staging record created.',
    getPendingIngestLogContext(pendingIngest, sessionId),
    {
      tempRelativePath: pendingIngest.tempRelativePath
    }
  );

  let createdItem: CatalogItem | null = null;

  try {
    let lastProgressBytes = 0;
    let lastProgressAt = 0;

    const stagedFile = await writeStreamToFileAndHash(file.file, temporaryFilePath, {
      onProgress: (sizeBytes) => {
        const now = Date.now();
        if (sizeBytes - lastProgressBytes < 16 * 1024 * 1024 && now - lastProgressAt < 1500) {
          return;
        }

        lastProgressBytes = sizeBytes;
        lastProgressAt = now;

        const message = `Receiving upload: ${formatBytes(sizeBytes)} written.`;
        void updatePendingIngestAndBroadcast(
          pendingIngest.id,
          {
            sizeBytes,
            processing: createProcessingSnapshot('downloading', message, null)
          },
          sessionId
        )
          .then((updatedPendingIngest) => {
            if (updatedPendingIngest) {
              pendingIngest = updatedPendingIngest;
            }
          })
          .catch((error: unknown) => {
            app.log.error(
              {
                event: 'upload.progress.persist_failed',
                pendingIngestId: pendingIngest.id,
                stage: 'downloading',
                error
              },
              'Failed to persist upload progress update.'
            );
          });

        writePipelineLog(
          'info',
          'upload.progress',
          message,
          getPendingIngestLogContext(pendingIngest, sessionId),
          {
            sizeBytes
          }
        );
      }
    });

    pendingIngest = await savePendingIngestAndBroadcast(
      {
        ...pendingIngest,
        sizeBytes: stagedFile.sizeBytes,
        incomingChecksumSha256: stagedFile.checksum,
        downloadState: 'downloaded',
        duplicateCheck: await evaluateUploadDuplicateCheck({
          visibleName: pendingIngest.visibleName,
          incomingChecksumSha256: stagedFile.checksum
        }),
        processing: createProcessingSnapshot(
          'duplicate_validation_final',
          'Upload received; running duplicate checks.',
          null
        )
      },
      sessionId
    );

    writePipelineLog(
      'info',
      'upload.staged',
      'Upload written to temporary storage.',
      getPendingIngestLogContext(pendingIngest, sessionId),
      {
        sizeBytes: stagedFile.sizeBytes,
        incomingChecksumSha256: abbreviateChecksum(stagedFile.checksum),
        tempRelativePath: pendingIngest.tempRelativePath
      }
    );

    if (pendingIngest.duplicateCheck.hasConflicts) {
      pendingIngest = await savePendingIngestAndBroadcast(
        {
          ...pendingIngest,
          processing: createProcessingSnapshot(
            'awaiting_duplicate_resolution',
            createPendingIngestResponseMessage(pendingIngest),
            null
          )
        },
        sessionId
      );

      writePipelineLog(
        'warn',
        'upload.awaiting_duplicate_resolution',
        pendingIngest.processing?.message ?? 'Awaiting duplicate resolution.',
        getPendingIngestLogContext(pendingIngest, sessionId),
        {
          duplicateReasons: pendingIngest.duplicateCheck.reasons.map((reason) => reason.code),
          duplicateCount: pendingIngest.duplicateCheck.reasons.length
        }
      );

      return createPendingIngestResponse(pendingIngest);
    }

    pendingIngest = await savePendingIngestAndBroadcast(
      {
        ...pendingIngest,
        processing: createProcessingSnapshot(
          'awaiting_title_confirmation',
          'Upload staged; confirm or edit the catalog title before finalizing.',
          null
        )
      },
      sessionId
    );

    writePipelineLog(
      'info',
      'upload.awaiting_title_confirmation',
      pendingIngest.processing?.message ?? 'Awaiting catalog title confirmation.',
      getPendingIngestLogContext(pendingIngest, sessionId),
      {
        suggestedVisibleName: pendingIngest.visibleName,
        sizeBytes: pendingIngest.sizeBytes,
        incomingChecksumSha256: abbreviateChecksum(pendingIngest.incomingChecksumSha256)
      }
    );

    return createPendingIngestResponse(pendingIngest);
  } catch (error) {
    const failureMessage = sanitizeLogText(
      error instanceof Error ? error.message : 'Upload failed.'
    );

    if (createdItem) {
      await markCatalogItemFailed(createdItem, failureMessage, sessionId, error);
    } else {
      await markPendingIngestFailed(pendingIngest, failureMessage, sessionId, error);
    }

    throw error;
  }
}

async function continuePendingUploadIngest(
  pendingIngest: PendingIngest,
  visibleNameOverride: string | null,
  sessionId?: string | null
): Promise<IngestHttpResponse> {
  const visibleName = normalizeVisibleNameInput(
    visibleNameOverride ?? pendingIngest.visibleName,
    pendingIngest.originalIngestName
  );

  let workingPendingIngest = await savePendingIngestAndBroadcast(
    {
      ...pendingIngest,
      visibleName,
      processing: createProcessingSnapshot(
        'duplicate_validation_final',
        'Re-running duplicate validation after user action.',
        null
      )
    },
    sessionId
  );

  writePipelineLog(
    'info',
    'upload.resolution.continue',
    'Continuing pending upload after duplicate dialog.',
    getPendingIngestLogContext(workingPendingIngest, sessionId),
    {
      requestedVisibleName: visibleName
    }
  );

  let createdItem: CatalogItem | null = null;

  try {
    const acknowledgedReasons = mergeDuplicateReasons(
      workingPendingIngest.acknowledgedReasons,
      workingPendingIngest.duplicateCheck.reasons
    );

    const duplicateCheck = await evaluateUploadDuplicateCheck({
      visibleName: workingPendingIngest.visibleName,
      incomingChecksumSha256:
        workingPendingIngest.downloadState === 'downloaded'
          ? workingPendingIngest.incomingChecksumSha256
          : null,
      sourceUrl: workingPendingIngest.sourceUrl
    });

    const unresolvedReasons = getUnacknowledgedDuplicateReasons(duplicateCheck, acknowledgedReasons);
    if (unresolvedReasons.length > 0) {
      workingPendingIngest = await savePendingIngestAndBroadcast(
        {
          ...workingPendingIngest,
          duplicateCheck,
          acknowledgedReasons,
          processing: createProcessingSnapshot(
            'awaiting_duplicate_resolution',
            `Awaiting duplicate resolution: ${summarizeDuplicateReasons(unresolvedReasons)}.`,
            null
          )
        },
        sessionId
      );

      writePipelineLog(
        'warn',
        'upload.awaiting_duplicate_resolution',
        workingPendingIngest.processing?.message ?? 'Awaiting duplicate resolution.',
        getPendingIngestLogContext(workingPendingIngest, sessionId),
        {
          duplicateReasons: unresolvedReasons.map((reason) => reason.code),
          duplicateCount: unresolvedReasons.length
        }
      );

      return createPendingIngestResponse(workingPendingIngest);
    }

    workingPendingIngest = await savePendingIngestAndBroadcast(
      {
        ...workingPendingIngest,
        duplicateCheck,
        acknowledgedReasons,
        processing: createProcessingSnapshot(
          'finalizing',
          'Duplicate checks complete; finalizing ingest record.',
          null
        )
      },
      sessionId
    );

    createdItem = await finalizePendingIngest(workingPendingIngest);
    broadcastPendingIngestDeleted(workingPendingIngest.id, sessionId);
    broadcastCatalogItemUpdated(createdItem, sessionId);

    writePipelineLog(
      'info',
      'upload.finalized',
      'Pending upload finalized into the catalog.',
      getCatalogItemLogContext(createdItem, sessionId),
      {
        sizeBytes: createdItem.sizeBytes,
        relativePath: createdItem.relativePath
      }
    );

    const queuedItem = await enqueueCatalogItemProcessing(createdItem, sessionId);

    return {
      ok: true,
      requiresResolution: false,
      item: queuedItem
    };
  } catch (error) {
    const failureMessage = sanitizeLogText(
      error instanceof Error ? error.message : 'Duplicate resolution failed.'
    );

    if (createdItem) {
      await markCatalogItemFailed(createdItem, failureMessage, sessionId, error);
    } else {
      await markPendingIngestFailed(workingPendingIngest, failureMessage, sessionId, error);
    }

    throw error;
  }
}

async function continuePendingYtDlpIngest(
  pendingIngest: PendingIngest,
  visibleNameOverride: string | null,
  sessionId?: string | null
): Promise<IngestHttpResponse> {
  const visibleName = normalizeVisibleNameInput(
    visibleNameOverride ?? pendingIngest.visibleName,
    pendingIngest.originalIngestName
  );

  let workingPendingIngest = await savePendingIngestAndBroadcast(
    {
      ...pendingIngest,
      visibleName,
      processing: createProcessingSnapshot(
        'metadata_preflight',
        'Re-running yt-dlp duplicate preflight after user action.',
        null
      )
    },
    sessionId
  );

  writePipelineLog(
    'info',
    'yt_dlp.resolution.continue',
    'Continuing pending yt-dlp import after duplicate dialog.',
    getPendingIngestLogContext(workingPendingIngest, sessionId),
    {
      requestedVisibleName: visibleName
    }
  );

  let createdItem: CatalogItem | null = null;

  try {
    const acknowledgedReasons = mergeDuplicateReasons(
      workingPendingIngest.acknowledgedReasons,
      workingPendingIngest.duplicateCheck.reasons
    );

    const duplicateCheck = await evaluateYtDlpPreDownloadDuplicateCheck({
      visibleName: workingPendingIngest.visibleName,
      sourceUrl: workingPendingIngest.sourceUrl,
      sourceSite: workingPendingIngest.sourceSite,
      sourceRemoteId: workingPendingIngest.sourceRemoteId
    });

    const unresolvedReasons = getUnacknowledgedDuplicateReasons(duplicateCheck, acknowledgedReasons);
    if (unresolvedReasons.length > 0) {
      workingPendingIngest = await savePendingIngestAndBroadcast(
        {
          ...workingPendingIngest,
          duplicateCheck,
          acknowledgedReasons,
          processing: createProcessingSnapshot(
            'awaiting_duplicate_resolution',
            `Awaiting duplicate resolution: ${summarizeDuplicateReasons(unresolvedReasons)}.`,
            null
          )
        },
        sessionId
      );

      writePipelineLog(
        'warn',
        'yt_dlp.awaiting_duplicate_resolution',
        workingPendingIngest.processing?.message ?? 'Awaiting duplicate resolution.',
        getPendingIngestLogContext(workingPendingIngest, sessionId),
        {
          duplicateReasons: unresolvedReasons.map((reason) => reason.code),
          duplicateCount: unresolvedReasons.length
        }
      );

      return createPendingIngestResponse(workingPendingIngest);
    }

    workingPendingIngest = await savePendingIngestAndBroadcast(
      {
        ...workingPendingIngest,
        duplicateCheck,
        acknowledgedReasons,
        processing: createProcessingSnapshot(
          'metadata_preflight',
          'Duplicate preflight cleared; creating catalog item before source download.',
          null
        )
      },
      sessionId
    );

    createdItem = await createCatalogItemFromPendingYtDlpImport(workingPendingIngest, sessionId);
    createdItem = await enqueueCatalogItemProcessing(createdItem, sessionId);

    return {
      ok: true,
      requiresResolution: false,
      item: createdItem
    };
  } catch (error) {
    const failureMessage = sanitizeLogText(
      error instanceof Error ? error.message : 'Duplicate resolution failed.'
    );

    if (createdItem) {
      await markCatalogItemFailed(createdItem, failureMessage, sessionId, error);
    } else {
      await markPendingIngestFailed(workingPendingIngest, failureMessage, sessionId, error);
    }

    throw error;
  }
}

async function continuePendingIngest(
  pendingIngest: PendingIngest,
  visibleNameOverride: string | null,
  sessionId?: string | null
): Promise<IngestHttpResponse> {
  return pendingIngest.sourceType === 'yt_dlp'
    ? await continuePendingYtDlpIngest(pendingIngest, visibleNameOverride, sessionId)
    : await continuePendingUploadIngest(pendingIngest, visibleNameOverride, sessionId);
}

async function stageYtDlpImport(
  body: { url: string },
  sessionId: string
): Promise<IngestHttpResponse> {
  const toolAvailability = detectToolAvailability(getToolCommandConfig());
  if (!toolAvailability.ytDlp) {
    return {
      ok: false,
      message: 'yt-dlp is not available on this server.'
    };
  }

  if (!isHttpUrl(body.url)) {
    return {
      ok: false,
      message: 'Provide a valid http or https URL.'
    };
  }

  const fallbackName = deriveNameFromUrl(body.url);
  let pendingIngest = await catalogStore.createPendingIngest({
    sourceType: 'yt_dlp',
    originalIngestName: fallbackName,
    visibleName: fallbackName,
    sourceUrl: body.url,
    downloadState: 'not_started',
    processing: createProcessingSnapshot(
      'metadata_preflight',
      'Fetching yt-dlp metadata preflight.',
      null
    )
  });

  broadcastPendingIngestUpdated(pendingIngest, sessionId);
  writePipelineLog(
    'info',
    'yt_dlp.import.started',
    'Created pending yt-dlp import preflight.',
    getPendingIngestLogContext(pendingIngest, sessionId)
  );

  let createdItem: CatalogItem | null = null;

  try {
    const metadata = await fetchYtDlpMetadata(body.url, getPendingIngestLogContext(pendingIngest, sessionId));

    pendingIngest = await savePendingIngestAndBroadcast(
      {
        ...pendingIngest,
        originalIngestName: metadata.title,
        visibleName: metadata.title,
        sourceUrl: metadata.sourceUrl,
        sourceSite: metadata.sourceSite,
        sourceRemoteId: metadata.sourceRemoteId,
        duplicateCheck: await evaluateYtDlpPreDownloadDuplicateCheck({
          visibleName: metadata.title,
          sourceUrl: metadata.sourceUrl,
          sourceSite: metadata.sourceSite,
          sourceRemoteId: metadata.sourceRemoteId
        }),
        processing: createProcessingSnapshot(
          'metadata_preflight',
          'Metadata fetched; running pre-download duplicate validation.',
          null
        )
      },
      sessionId
    );

    if (pendingIngest.duplicateCheck.hasConflicts) {
      pendingIngest = await savePendingIngestAndBroadcast(
        {
          ...pendingIngest,
          processing: createProcessingSnapshot(
            'awaiting_duplicate_resolution',
            createPendingIngestResponseMessage(pendingIngest),
            null
          )
        },
        sessionId
      );

      writePipelineLog(
        'warn',
        'yt_dlp.awaiting_duplicate_resolution',
        pendingIngest.processing?.message ?? 'Awaiting duplicate resolution.',
        getPendingIngestLogContext(pendingIngest, sessionId),
        {
          duplicateReasons: pendingIngest.duplicateCheck.reasons.map((reason) => reason.code),
          duplicateCount: pendingIngest.duplicateCheck.reasons.length
        }
      );

      return createPendingIngestResponse(pendingIngest);
    }

    pendingIngest = await savePendingIngestAndBroadcast(
      {
        ...pendingIngest,
        processing: createProcessingSnapshot(
          'awaiting_title_confirmation',
          'Metadata fetched; confirm or edit the catalog title before finalizing.',
          null
        )
      },
      sessionId
    );

    writePipelineLog(
      'info',
      'yt_dlp.awaiting_title_confirmation',
      pendingIngest.processing?.message ?? 'Awaiting catalog title confirmation.',
      getPendingIngestLogContext(pendingIngest, sessionId),
      {
        suggestedVisibleName: pendingIngest.visibleName,
        sourceSite: pendingIngest.sourceSite,
        sourceRemoteId: pendingIngest.sourceRemoteId
      }
    );

    return createPendingIngestResponse(pendingIngest);
  } catch (error) {
    const failureMessage = sanitizeLogText(
      error instanceof Error ? error.message : 'yt-dlp import failed.'
    );

    if (createdItem) {
      await markCatalogItemFailed(createdItem, failureMessage, sessionId, error);
    } else {
      await markPendingIngestFailed(pendingIngest, failureMessage, sessionId, error);
    }

    throw error;
  }
}

type PendingIngestResolutionOutcome =
  | {
      kind: 'success';
      response: IngestHttpResponse;
    }
  | {
      kind: 'error';
      code: SocketErrorCode;
      httpStatusCode: number;
      message: string;
    };

async function resolvePendingIngestRequest(input: {
  pendingIngestId: string;
  expectedSourceType: PendingIngest['sourceType'];
  action: DuplicateResolutionAction;
  visibleName: string | null;
  sessionId: string;
}): Promise<PendingIngestResolutionOutcome> {
  const pendingIngest = catalogStore.getPendingIngest(input.pendingIngestId);
  if (!pendingIngest || pendingIngest.sourceType !== input.expectedSourceType) {
    return {
      kind: 'error',
      code: 'NOT_FOUND',
      httpStatusCode: 404,
      message: 'Pending ingest not found.'
    };
  }

  writePipelineLog(
    'info',
    'ingest.resolution.request',
    'Received duplicate resolution request.',
    getPendingIngestLogContext(pendingIngest, input.sessionId),
    {
      action: input.action,
      requestedVisibleName: input.visibleName
    }
  );

  if (input.action === 'cancel') {
    cleanupPendingArtifacts(pendingIngest);
    await catalogStore.deletePendingIngest(pendingIngest.id);
    broadcastPendingIngestDeleted(pendingIngest.id, input.sessionId);

    writePipelineLog(
      'warn',
      'ingest.resolution.cancel',
      'Pending ingest cancelled by user.',
      getPendingIngestLogContext(pendingIngest, input.sessionId),
      {
        duplicateReasons: pendingIngest.duplicateCheck.reasons.map((reason) => reason.code)
      }
    );

    return {
      kind: 'success',
      response: {
        ok: true,
        cancelled: true
      }
    };
  }

  try {
    const result = await continuePendingIngest(pendingIngest, input.visibleName, input.sessionId);
    return {
      kind: 'success',
      response: result
    };
  } catch (error) {
    return {
      kind: 'error',
      code: 'INTERNAL_ERROR',
      httpStatusCode: 500,
      message: error instanceof Error ? error.message : 'Duplicate resolution failed.'
    };
  }
}

async function handlePendingIngestResolution(
  request: FastifyRequest,
  reply: FastifyReply,
  expectedSourceType: PendingIngest['sourceType']
): Promise<void> {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const params = isRecord(request.params) ? request.params : null;
  const pendingIngestId = params ? readString(params.id) : null;
  if (!pendingIngestId) {
    reply.code(400).send({
      ok: false,
      message: 'A pending ingest id is required.'
    } satisfies IngestErrorResponse);
    return;
  }

  const body = parseDuplicateResolutionBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide a valid duplicate resolution action.'
    } satisfies IngestErrorResponse);
    return;
  }

  const outcome = await resolvePendingIngestRequest({
    pendingIngestId,
    expectedSourceType,
    action: body.action,
    visibleName: body.visibleName,
    sessionId
  });

  if (outcome.kind === 'error') {
    reply.code(outcome.httpStatusCode).send({
      ok: false,
      message: outcome.message
    } satisfies IngestErrorResponse);
    return;
  }

  reply.send(outcome.response);
}

app.get('/api/health', async () => {
  return {
    ok: true,
    now: new Date().toISOString()
  };
});

async function handleSessionStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authenticated = isAuthenticated(request);
  if (!authenticated) {
    reply.code(200).send({ authenticated: false });
    return;
  }

  reply.send({ authenticated: true });
}

async function handleLoginRoute(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = isRecord(request.body) ? request.body : {};
  const password = readString(body.password) ?? '';
  if (password !== config.appPassword) {
    reply.code(401).send({ ok: false, message: 'Invalid password.' });
    return;
  }

  const session = sessionStore.create();
  reply.setCookie(config.cookieName, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });

  reply.send({ ok: true, authenticated: true });
}

function destroySessionAndClearSockets(
  sessionId: string | undefined,
  authReason: AuthTerminationReason,
  closeReason: string
): void {
  sessionStore.destroy(sessionId);
  closeSessionSockets(sessionId, 4000, closeReason, true, authReason);
}

async function handleLogoutRoute(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionId = getSessionId(request);
  destroySessionAndClearSockets(sessionId, 'logout', 'Logged out');
  reply.clearCookie(config.cookieName, {
    path: '/'
  });
  reply.send({ ok: true, authenticated: false });
}

async function handleLockRoute(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sessionId = getSessionId(request);
  destroySessionAndClearSockets(sessionId, 'panic', 'Locked');
  reply.clearCookie(config.cookieName, {
    path: '/'
  });
  reply.send({ ok: true, authenticated: false, panic: true });
}

app.get('/api/me', handleSessionStatus);
app.get('/api/auth/session', handleSessionStatus);

app.post('/api/login', handleLoginRoute);
app.post('/api/auth/login', handleLoginRoute);

app.post('/api/logout', handleLogoutRoute);
app.post('/api/auth/logout', handleLogoutRoute);

app.post('/api/panic', handleLockRoute);
app.post('/api/auth/lock', handleLockRoute);

app.get('/media/videos/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      message: 'The retained video is not ready yet.'
    });
    return;
  }

  const filePath = getCatalogItemVideoFilePath(item);
  if (!filePath) {
    reply.code(404).send({
      message: 'The retained video file is not available.'
    });
    return;
  }

  request.log.info(
    {
      event: 'video.inline.request',
      itemId: item.id,
      storedName: item.storedName,
      relativePath: item.relativePath,
      filePath,
      rangeHeader: typeof request.headers.range === 'string' ? request.headers.range : null,
      durationSeconds: item.probe?.durationSeconds ?? null,
      videoCodec: item.probe?.videoCodec ?? null,
      audioCodec: item.probe?.audioCodec ?? null,
      containerFormat: item.probe?.containerFormat ?? null,
      pixelFormat: item.probe?.pixelFormat ?? null
    },
    'Inline video request received.'
  );

  sendManagedFileResponse(request, reply, filePath, {
    allowRange: true
  });
});

app.get('/media/thumbnails/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const filePath = getCatalogItemThumbnailFilePath(item);
  if (!filePath) {
    reply.code(404).send({
      message: 'Poster thumbnail is not available for this item.'
    });
    return;
  }

  await sendCachedThumbnailResponse(
    request,
    reply,
    filePath,
    'Poster thumbnail is not available for this item.'
  );
});

app.get('/media/hover-previews/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const filePath = getCatalogItemHoverPreviewFilePath(item);
  if (!filePath) {
    reply.code(404).send({
      message: 'Hover preview sprite is not available for this item.'
    });
    return;
  }

  console.log('Serving hover preview from path:', filePath);

  sendManagedFileResponse(request, reply, filePath);
});

app.get('/media/bookmark-thumbnails/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const bookmarkId = readCatalogItemIdParam(request);
  if (!bookmarkId) {
    reply.code(400).send({
      message: 'A bookmark id is required.'
    });
    return;
  }

  const bookmark = catalogStore.findBookmarkById(bookmarkId);
  if (!bookmark) {
    reply.code(404).send({
      message: 'Bookmark thumbnail is not available.'
    });
    return;
  }

  const filePath = getCatalogBookmarkThumbnailFilePath(bookmark);
  if (!filePath) {
    reply.code(404).send({
      message: 'Bookmark thumbnail is not available.'
    });
    return;
  }

  await sendCachedThumbnailResponse(
    request,
    reply,
    filePath,
    'Bookmark thumbnail is not available.'
  );
});

app.get('/download/videos/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      message: 'The retained video is not ready yet.'
    });
    return;
  }

  const filePath = getCatalogItemVideoFilePath(item);
  if (!filePath || !getManagedFileStats(filePath)) {
    reply.code(404).send({
      message: 'The retained video file is not available.'
    });
    return;
  }

  const updatedItem = await incrementCatalogItemDownloadCountAndBroadcast(item.id, sessionId);
  if (!updatedItem) {
    reply.code(404).send({
      message: 'Catalog item not found.'
    });
    return;
  }

  sendManagedFileResponse(request, reply, filePath, {
    allowRange: true,
    downloadFileName: createDownloadFileName(updatedItem)
  });
});

type ServerToolUpdateHttpResponse = {
  ok: boolean;
  message: string;
  result: ServerToolUpdateResult;
  runtime: RuntimeStatePayload;
};

function createServerToolUpdateResponse(
  result: ServerToolUpdateResult
): ServerToolUpdateHttpResponse {
  return {
    ok: result.ok,
    message: result.summary,
    result,
    runtime: createRuntimeStatePayload()
  };
}

function broadcastRuntimeUpdated(runtime: RuntimeStatePayload): void {
  broadcastSocketMessage({
    type: 'runtime',
    payload: runtime
  });

  broadcastSocketMessage({
    type: 'evt',
    name: 'runtime.updated',
    data: runtime
  });
}

async function handleServerToolUpdateRoute(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  if (isServerToolUpdateRunning) {
    reply.code(409).send({
      ok: false,
      message: 'A server-side tool update is already running.'
    });
    return;
  }

  isServerToolUpdateRunning = true;

  try {
    request.log.info(
      {
        event: 'tools.update.requested',
        sessionId: abbreviateIdentifier(sessionId),
        platform: process.platform
      },
      'Server-side tool update requested.'
    );

    const result = await updateServerSideTools(getToolCommandConfig());
    const response = createServerToolUpdateResponse(result);
    broadcastRuntimeUpdated(response.runtime);

    request.log.info(
      {
        event: 'tools.update.completed',
        sessionId: abbreviateIdentifier(sessionId),
        status: result.status,
        platform: result.platform,
        tools: result.tools.map((toolResult) => ({
          tool: toolResult.tool,
          status: toolResult.status,
          attempted: toolResult.attempted,
          strategy: toolResult.strategy,
          exitCode: toolResult.exitCode
        }))
      },
      result.summary
    );

    reply.send(response);
  } catch (error) {
    request.log.error(
      {
        event: 'tools.update.unhandled_error',
        sessionId: abbreviateIdentifier(sessionId),
        err: error
      },
      'Server-side tool update failed unexpectedly.'
    );

    reply.code(500).send({
      ok: false,
      message: error instanceof Error ? error.message : 'Server-side tool update failed.'
    });
  } finally {
    isServerToolUpdateRunning = false;
  }
}

app.post('/api/tools/update', handleServerToolUpdateRoute);

app.get('/api/runtime', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  reply.send({
    authenticated: true,
    ...createRuntimeStatePayload()
  });
});

app.get('/api/catalog', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  reply.send({
    items: catalogStore.list()
  });
});

app.patch('/api/catalog/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const body = parseCatalogItemRenameBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide a non-empty catalog title.'
    });
    return;
  }

  const updatedItem = await updateCatalogItemAndBroadcast(
    item.id,
    { visibleName: body.visibleName },
    sessionId,
    { includeProcessingEvents: false }
  );
  if (!updatedItem) {
    reply.code(404).send({
      ok: false,
      message: 'Catalog item not found.'
    });
    return;
  }

  writePipelineLog(
    'info',
    'catalog.item.renamed',
    'Catalog item title renamed.',
    getCatalogItemLogContext(updatedItem, sessionId),
    {
      previousVisibleName: item.visibleName,
      nextVisibleName: updatedItem.visibleName
    }
  );

  reply.send({
    ok: true,
    item: updatedItem
  });
});

app.get('/api/tags', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  const { search, limit } = parseCatalogTagListQuery(request.query, 10);
  const tags = await catalogStore.searchTags({ search, limit });

  reply.send({
    ok: true,
    tags
  });
});

app.get('/api/tags/top', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  const { limit } = parseCatalogTagListQuery(request.query, 10);
  const tags = await catalogStore.listMostUsedTags(limit);

  reply.send({
    ok: true,
    tags
  });
});

app.get('/api/catalog/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  reply.send({
    ok: true,
    tags: item.tags
  });
});

app.post('/api/catalog/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const body = parseCatalogTagRequestBody(request.body);
  if (!body) {
    reply.code(400).send({
      message: 'A non-empty tag label is required.'
    });
    return;
  }

  const updatedItem = await catalogStore.addCatalogItemTag(item.id, body.label);
  if (!updatedItem) {
    reply.code(404).send({
      message: 'Catalog item not found.'
    });
    return;
  }

  broadcastCatalogItemUpdated(updatedItem, sessionId, {
    includeProcessingEvents: false
  });

  reply.send({
    ok: true,
    item: updatedItem,
    tags: updatedItem.tags
  });
});

app.delete('/api/catalog/:id/tags/:tagId', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const tagId = parseCatalogTagIdParam(request);
  if (!tagId) {
    reply.code(400).send({
      message: 'A tag id is required.'
    });
    return;
  }

  const updatedItem = await catalogStore.removeCatalogItemTag(item.id, tagId);
  if (!updatedItem) {
    reply.code(404).send({
      message: 'Catalog item not found.'
    });
    return;
  }

  broadcastCatalogItemUpdated(updatedItem, sessionId, {
    includeProcessingEvents: false
  });

  reply.send({
    ok: true,
    item: updatedItem,
    tags: updatedItem.tags
  });
});

app.delete('/api/catalog/:id', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  discardQueuedCatalogItemProcessing(item.id);
  terminateActiveCatalogItemCommands(item.id);

  const deletedItem = await deleteCatalogItemAndBroadcast(item.id, sessionId);
  if (!deletedItem) {
    reply.code(404).send({
      message: 'Catalog item not found.'
    });
    return;
  }

  cleanupDeletedCatalogItemArtifacts(deletedItem.item, deletedItem.bookmarks);
  writePipelineLog(
    'info',
    'catalog.item.deleted',
    'Deleted catalog item and removed retained artifacts.',
    getCatalogItemLogContext(deletedItem.item, sessionId),
    { bookmarkCount: deletedItem.bookmarks.length }
  );

  reply.send({
    ok: true,
    itemId: deletedItem.item.id
  });
});

app.post('/api/catalog/:id/views', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      message: 'Only ready catalog items can record views.'
    });
    return;
  }

  const updatedItem = await incrementCatalogItemViewCountAndBroadcast(item.id, sessionId);
  if (!updatedItem) {
    reply.code(404).send({
      message: 'Catalog item not found.'
    });
    return;
  }

  reply.send({
    ok: true,
    item: updatedItem
  });
});

app.post('/api/catalog/:id/used', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      message: 'Only ready catalog items can be marked used.'
    });
    return;
  }

  const updatedItem = await incrementCatalogItemUsedCountAndBroadcast(item.id, sessionId);
  if (!updatedItem) {
    reply.code(404).send({
      message: 'Catalog item not found.'
    });
    return;
  }

  reply.send({
    ok: true,
    item: updatedItem
  });
});

app.patch('/api/catalog/:id/viewer-adjustments', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      ok: false,
      message: 'Only ready catalog items can update viewer adjustments.'
    });
    return;
  }

  const body = parseViewerVisualAdjustmentsBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide valid viewer adjustment settings.'
    });
    return;
  }

  const updatedItem = await updateCatalogItemAndBroadcast(
    item.id,
    { viewerVisualAdjustments: body },
    sessionId,
    { includeProcessingEvents: false }
  );
  if (!updatedItem) {
    reply.code(404).send({
      ok: false,
      message: 'Catalog item not found.'
    });
    return;
  }

  reply.send({
    ok: true,
    item: updatedItem
  });
});

app.post('/api/catalog/:id/thumbnail', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      ok: false,
      message: 'Only ready catalog items can update their thumbnail.'
    });
    return;
  }

  const body = parseThumbnailCaptureBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide a valid thumbnail capture time.'
    });
    return;
  }

  const filePath = getCatalogItemVideoFilePath(item);
  if (!filePath || !getManagedFileStats(filePath)) {
    reply.code(404).send({
      ok: false,
      message: 'The retained video file is not available.'
    });
    return;
  }

  const toolAvailability = detectToolAvailability(getToolCommandConfig());
  if (!toolAvailability.ffmpeg) {
    reply.code(503).send({
      ok: false,
      message: 'ffmpeg is not available on this server.'
    });
    return;
  }

  try {
    const updatedItem = await setCatalogItemThumbnailFromTime(item, body.timeSeconds, sessionId);
    reply.send({
      ok: true,
      item: updatedItem
    });
  } catch (error) {
    request.log.error(
      {
        err: error,
        itemId: item.id,
        requestedTimeSeconds: body.timeSeconds
      },
      'Failed to update catalog item thumbnail from current frame.'
    );

    reply.code(500).send({
      ok: false,
      message: error instanceof Error ? error.message : 'Thumbnail update failed.'
    });
  }
});

app.get('/api/catalog/:id/bookmarks', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  reply.send({
    ok: true,
    bookmarks: catalogStore.listCatalogItemBookmarks(item.id)
  });
});

app.post('/api/catalog/:id/bookmarks', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      ok: false,
      message: 'Only ready catalog items can create bookmarks.'
    });
    return;
  }

  const body = parseBookmarkCreateBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide a valid bookmark time.'
    });
    return;
  }

  const filePath = getCatalogItemVideoFilePath(item);
  if (!filePath || !getManagedFileStats(filePath)) {
    reply.code(404).send({
      ok: false,
      message: 'The retained video file is not available.'
    });
    return;
  }

  const toolAvailability = detectToolAvailability(getToolCommandConfig());
  if (!toolAvailability.ffmpeg) {
    reply.code(503).send({
      ok: false,
      message: 'ffmpeg is not available on this server.'
    });
    return;
  }

  try {
    const bookmark = await createCatalogItemBookmarkFromTime(item, body.timeSeconds, body.name, sessionId);
    reply.send({
      ok: true,
      bookmark
    });
  } catch (error) {
    request.log.error(
      {
        err: error,
        itemId: item.id,
        requestedTimeSeconds: body.timeSeconds
      },
      'Failed to create catalog item bookmark.'
    );

    reply.code(500).send({
      ok: false,
      message: error instanceof Error ? error.message : 'Bookmark creation failed.'
    });
  }
});

app.patch('/api/catalog/:id/bookmarks/:bookmarkId', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const bookmark = getRequestedCatalogItemBookmark(request, reply, item);
  if (!bookmark) {
    return;
  }

  const body = parseBookmarkUpdateBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide a valid bookmark name.'
    });
    return;
  }

  const updatedBookmark = await catalogStore.updateCatalogItemBookmark(item.id, bookmark.id, {
    name: body.name
  });
  if (!updatedBookmark) {
    reply.code(404).send({
      ok: false,
      message: 'Bookmark not found.'
    });
    return;
  }

  reply.send({
    ok: true,
    bookmark: updatedBookmark
  });
});

app.post('/api/catalog/:id/bookmarks/:bookmarkId/use', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  if (item.status !== 'ready') {
    reply.code(409).send({
      ok: false,
      message: 'Only ready catalog items can use bookmarks.'
    });
    return;
  }

  const bookmark = getRequestedCatalogItemBookmark(request, reply, item);
  if (!bookmark) {
    return;
  }

  const updatedBookmark = await catalogStore.incrementCatalogItemBookmarkUseCount(item.id, bookmark.id);
  if (!updatedBookmark) {
    reply.code(404).send({
      ok: false,
      message: 'Bookmark not found.'
    });
    return;
  }

  reply.send({
    ok: true,
    bookmark: updatedBookmark
  });
});

app.delete('/api/catalog/:id/bookmarks/:bookmarkId', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const item = getRequestedCatalogItem(request, reply);
  if (!item) {
    return;
  }

  const bookmark = getRequestedCatalogItemBookmark(request, reply, item);
  if (!bookmark) {
    return;
  }

  const deletedBookmark = await catalogStore.deleteCatalogItemBookmark(item.id, bookmark.id);
  if (!deletedBookmark) {
    reply.code(404).send({
      ok: false,
      message: 'Bookmark not found.'
    });
    return;
  }

  const thumbnailPath = getCatalogBookmarkThumbnailFilePath(deletedBookmark);
  if (thumbnailPath) {
    invalidateThumbnailCacheFile(thumbnailPath);
    removePathIfExists(thumbnailPath);
  }

  reply.send({
    ok: true,
    bookmark: deletedBookmark
  });
});

app.post('/api/upload', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const file = await request.file();
  if (!file) {
    reply.code(400).send({ ok: false, message: 'No file was provided.' });
    return;
  }

  const originalName = file.filename || 'unnamed-upload';
  writePipelineLog(
    'warn',
    'upload.legacy.started',
    'Legacy /api/upload route invoked; this path bypasses pending-ingest observability.',
    {
      sessionId,
      sourceType: 'upload',
      visibleName: originalName
    }
  );

  const duplicateCheckBeforeWrite = await evaluateUploadDuplicateCheck({
    visibleName: originalName
  });

  const storedName = `${Date.now()}-${randomUUID()}${path.extname(originalName).toLowerCase()}`;
  const targetPath = path.join(config.incomingRoot, storedName);
  const stagedFile = await writeStreamToFileAndHash(file.file, targetPath);

  const duplicateCheckAfterWrite = await evaluateUploadDuplicateCheck({
    visibleName: originalName,
    incomingChecksumSha256: stagedFile.checksum
  });

  const legacyDuplicate =
    duplicateCheckBeforeWrite.existingItems[0] ?? duplicateCheckAfterWrite.existingItems[0] ?? null;

  let item = await catalogStore.addUploadedItem({
    originalName,
    originalIngestName: originalName,
    storedName,
    sizeBytes: stagedFile.sizeBytes,
    relativePath: path.relative(config.mediaRoot, targetPath),
    incomingChecksumSha256: stagedFile.checksum
  });

  writePipelineLog(
    'info',
    'upload.legacy.finalized',
    'Legacy upload finalized directly into the catalog.',
    getCatalogItemLogContext(item, sessionId),
    {
      sizeBytes: item.sizeBytes,
      incomingChecksumSha256: abbreviateChecksum(item.incomingChecksumSha256),
      duplicateReasons: duplicateCheckAfterWrite.reasons.map((reason) => reason.code)
    }
  );

  item = await enqueueCatalogItemProcessing(item, sessionId);

  reply.send({
    ok: true,
    duplicate: legacyDuplicate
      ? {
          type: duplicateCheckBeforeWrite.hasConflicts ? 'same-name' : 'exact-checksum',
          existing: legacyDuplicate
        }
      : null,
    duplicateCheck: duplicateCheckAfterWrite,
    item
  });
});

app.post('/api/uploads/file', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  try {
    const result = await stageValidatedUpload(request, sessionId);
    reply.send(result);
  } catch (error) {
    reply.code(500).send({
      ok: false,
      message: error instanceof Error ? error.message : 'Upload failed.'
    } satisfies IngestErrorResponse);
  }
});

app.post('/api/uploads/:id/resolve-duplicate', async (request: FastifyRequest, reply: FastifyReply) => {
  await handlePendingIngestResolution(request, reply, 'upload');
});

app.post('/api/imports/yt-dlp', async (request: FastifyRequest, reply: FastifyReply) => {
  const sessionId = getAuthenticatedSessionId(request, reply);
  if (!sessionId) {
    return;
  }

  const body = parseYtDlpCreateBody(request.body);
  if (!body) {
    reply.code(400).send({
      ok: false,
      message: 'Provide a valid URL.'
    } satisfies IngestErrorResponse);
    return;
  }

  try {
    const result = await stageYtDlpImport(body, sessionId);
    reply.send(result);
  } catch (error) {
    reply.code(500).send({
      ok: false,
      message: error instanceof Error ? error.message : 'yt-dlp import failed.'
    } satisfies IngestErrorResponse);
  }
});

app.post('/api/imports/:id/resolve-duplicate', async (request: FastifyRequest, reply: FastifyReply) => {
  await handlePendingIngestResolution(request, reply, 'yt_dlp');
});

function getCatalogItemById(itemId: string): CatalogItem | undefined {
  return catalogStore.findById(itemId);
}

function sendInitialSocketState(socketState: SessionSocketState): void {
  const runtime = createRuntimeStatePayload();

  sendSocketMessage(socketState.socket, {
    type: 'welcome',
    payload: {
      serverTime: new Date().toISOString()
    }
  });

  sendSocketMessage(socketState.socket, {
    type: 'runtime',
    payload: runtime
  });

  sendSocketMessage(socketState.socket, {
    type: 'evt',
    name: 'runtime.updated',
    data: runtime
  });

  sendSocketMessage(socketState.socket, {
    type: 'evt',
    name: 'state.snapshot',
    data: createSocketStateSnapshot(socketState)
  });
}

function handleLegacySocketMessage(socketState: SessionSocketState, messageType: string | undefined): void {
  switch (messageType) {
    case 'ping':
      sendSocketMessage(socketState.socket, {
        type: 'pong',
        payload: {
          serverTime: new Date().toISOString()
        }
      });
      break;
    case 'catalog:list':
      sendSocketMessage(socketState.socket, {
        type: 'catalog:list',
        payload: queryCatalog().items
      });
      break;
    case 'pending-ingests:list':
      sendSocketMessage(socketState.socket, {
        type: 'pending-ingests:list',
        payload: createPendingIngestListPayload().pendingIngests
      });
      break;
    case 'runtime:get':
      sendSocketMessage(socketState.socket, {
        type: 'runtime',
        payload: createRuntimeStatePayload(false)
      });
      break;
    case 'panic':
      destroySessionAndClearSockets(socketState.sessionId, 'panic', 'Locked');
      break;
    default:
      sendSocketMessage(socketState.socket, {
        type: 'error',
        payload: {
          message: 'Unknown command.'
        }
      });
      break;
  }
}

async function handleStructuredSocketCommand(
  socketState: SessionSocketState,
  command: SocketCommandMessage
): Promise<void> {
  switch (command.name) {
    case 'auth.ping':
      sendSocketAckSuccess(socketState, command.id, {
        serverTime: new Date().toISOString()
      });
      return;
    case 'auth.lock':
      sendSocketAckSuccess(socketState, command.id, {
        locked: true
      });
      setTimeout(() => {
        destroySessionAndClearSockets(socketState.sessionId, 'panic', 'Locked');
      }, 10);
      return;
    case 'state.sync':
      sendSocketAckSuccess(socketState, command.id, createSocketStateSnapshot(socketState));
      return;
    case 'catalog.query': {
      const payload = parseCatalogQueryPayload(command.payload);
      if (!payload) {
        sendSocketAckError(socketState, command.id, 'VALIDATION_ERROR', 'Provide a valid catalog query payload.');
        return;
      }

      sendSocketAckSuccess(socketState, command.id, queryCatalog(payload));
      return;
    }
    case 'catalog.refresh':
      sendSocketAckSuccess(socketState, command.id, queryCatalog(createDefaultCatalogQueryInput()));
      return;
    case 'video.get': {
      const payload = parseVideoGetPayload(command.payload);
      if (!payload) {
        sendSocketAckError(socketState, command.id, 'VALIDATION_ERROR', 'Provide a valid catalog item id.');
        return;
      }

      const item = getCatalogItemById(payload.itemId);
      if (!item) {
        sendSocketAckError(socketState, command.id, 'NOT_FOUND', 'Catalog item not found.');
        return;
      }

      sendSocketAckSuccess(socketState, command.id, item);
      return;
    }
    case 'pendingIngests.list':
      sendSocketAckSuccess(socketState, command.id, createPendingIngestListPayload());
      return;
    case 'runtime.get':
      sendSocketAckSuccess(socketState, command.id, createRuntimeStatePayload(false));
      return;
    case 'jobs.subscribe': {
      const payload = parseJobsSubscribePayload(command.payload);
      if (!payload) {
        sendSocketAckError(socketState, command.id, 'VALIDATION_ERROR', 'Provide a valid jobs subscription payload.');
        return;
      }

      socketState.subscriptions.jobs = payload.enabled;
      sendSocketAckSuccess(socketState, command.id, {
        subscriptions: {
          ...socketState.subscriptions
        }
      });
      return;
    }
    case 'import.ytdlp.create': {
      const payload = parseYtDlpCreateBody(command.payload);
      if (!payload) {
        sendSocketAckError(socketState, command.id, 'VALIDATION_ERROR', 'Provide a valid URL.');
        return;
      }

      try {
        const result = await stageYtDlpImport(payload, socketState.sessionId);
        if (!result.ok) {
          const message = 'message' in result ? result.message : 'yt-dlp import failed.';
          sendSocketAckError(socketState, command.id, 'CONFLICT', message);
          return;
        }

        sendSocketAckSuccess(socketState, command.id, result as IngestSocketResponse);
      } catch (error) {
        sendSocketAckError(
          socketState,
          command.id,
          'INTERNAL_ERROR',
          error instanceof Error ? error.message : 'yt-dlp import failed.'
        );
      }
      return;
    }
    case 'upload.duplicate.resolve':
    case 'import.duplicate.resolve': {
      const payload = parseSocketDuplicateResolutionPayload(command.payload);
      if (!payload) {
        sendSocketAckError(
          socketState,
          command.id,
          'VALIDATION_ERROR',
          'Provide a valid duplicate resolution payload.'
        );
        return;
      }

      const outcome = await resolvePendingIngestRequest({
        pendingIngestId: payload.pendingIngestId,
        expectedSourceType: command.name === 'upload.duplicate.resolve' ? 'upload' : 'yt_dlp',
        action: payload.action,
        visibleName: payload.visibleName,
        sessionId: socketState.sessionId
      });

      if (outcome.kind === 'error') {
        sendSocketAckError(socketState, command.id, outcome.code, outcome.message);
        return;
      }

      sendSocketAckSuccess(socketState, command.id, outcome.response as IngestSocketResponse);
      return;
    }
    default:
      sendSocketAckError(socketState, command.id, 'UNSUPPORTED_COMMAND', 'Unknown command.');
      return;
  }
}

function handleApplicationWebSocketConnection(
  connection: SessionSocketConnection,
  request: FastifyRequest
): void {
  const socket = resolveSessionSocket(connection);
  if (!socket) {
    app.log.error(
      {
        event: 'socket.connection.invalid_shape',
        routeUrl: request.url
      },
      'WebSocket route did not receive a compatible socket object.'
    );
    closeSocketConnection(connection, 1011, 'WebSocket unavailable');
    return;
  }

  if (!isAllowedWebSocketOrigin(request)) {
    app.log.warn(
      {
        event: 'socket.connection.origin_rejected',
        routeUrl: request.url,
        origin: getHeaderFirstValue(request.headers.origin),
        host: getHeaderFirstValue(request.headers.host),
        forwardedHost: getHeaderFirstValue(request.headers['x-forwarded-host']),
        allowedOrigins: config.wsAllowedOrigins
      },
      'Rejected WebSocket connection from an unapproved origin.'
    );
    closeSocketConnection(socket, 4003, 'Origin not allowed');
    return;
  }

  const sessionId = getSessionId(request);
  if (!sessionStore.get(sessionId) || !sessionId) {
    app.log.warn(
      {
        event: 'socket.connection.unauthenticated',
        routeUrl: request.url,
        origin: getHeaderFirstValue(request.headers.origin),
        host: getHeaderFirstValue(request.headers.host),
        cookieHeaderPresent: typeof request.headers.cookie === 'string' && request.headers.cookie.trim() !== '',
        expectedCookieName: config.cookieName
      },
      'Rejected WebSocket connection without a valid authenticated session.'
    );
    closeSocketConnection(socket, 4001, 'Unauthenticated');
    return;
  }

  const socketState: SessionSocketState = {
    connectionId: randomUUID(),
    sessionId,
    socket,
    subscriptions: {
      ...DEFAULT_SOCKET_SUBSCRIPTIONS
    },
    connectedAt: new Date().toISOString(),
    rateWindowStartedAt: Date.now(),
    messageCount: 0
  };

  registerSocket(socketState);
  app.log.info(
    {
      event: 'socket.connection.registered',
      routeUrl: request.url,
      sessionId: abbreviateIdentifier(sessionId),
      connectionId: abbreviateIdentifier(socketState.connectionId),
      origin: getHeaderFirstValue(request.headers.origin),
      host: getHeaderFirstValue(request.headers.host)
    },
    'Registered authenticated WebSocket connection.'
  );

  const heartbeat = setInterval(() => {
    if (!sessionStore.peek(sessionId)) {
      closeSessionSockets(sessionId, 4000, 'Session expired', true, 'expired');
      return;
    }

    sendSocketMessage(socketState.socket, {
      type: 'pong',
      payload: {
        serverTime: new Date().toISOString()
      }
    });
  }, config.wsHeartbeatMs);

  socket.on('message', (raw: Buffer | string) => {
    const rawLength = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.length;
    if (rawLength > WS_MAX_MESSAGE_BYTES) {
      sendSocketMessage(socketState.socket, {
        type: 'error',
        payload: {
          message: 'WebSocket message too large.'
        }
      });
      closeSocketConnection(socketState.socket, 4008, 'Message too large');
      return;
    }

    if (!sessionStore.get(sessionId)) {
      closeSessionSockets(sessionId, 4000, 'Session expired', true, 'expired');
      return;
    }

    const parsed = parseIncomingSocketMessage(raw);
    if (parsed.kind === 'invalid') {
      sendSocketMessage(socketState.socket, {
        type: 'error',
        payload: {
          message: 'Invalid message payload.'
        }
      });
      return;
    }

    if (!bumpSocketMessageRate(socketState)) {
      if (parsed.kind === 'cmd') {
        sendSocketAckError(socketState, parsed.message.id, 'RATE_LIMITED', 'Too many WebSocket commands; slow down.');
      } else {
        sendSocketMessage(socketState.socket, {
          type: 'error',
          payload: {
            message: 'Too many WebSocket commands; slow down.'
          }
        });
      }

      closeSocketConnection(socketState.socket, 4008, 'Rate limited');
      return;
    }

    if (parsed.kind === 'legacy') {
      handleLegacySocketMessage(socketState, parsed.message.type);
      return;
    }

    void handleStructuredSocketCommand(socketState, parsed.message).catch((error) => {
      app.log.error(
        {
          event: 'socket.command.failed',
          commandName: parsed.message.name,
          sessionId: abbreviateIdentifier(socketState.sessionId),
          connectionId: abbreviateIdentifier(socketState.connectionId),
          err: error
        },
        'Structured WebSocket command failed unexpectedly.'
      );

      sendSocketAckError(
        socketState,
        parsed.message.id,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'WebSocket command failed.'
      );
    });
  });

  socket.on('error', (error: Error) => {
    app.log.warn(
      {
        event: 'socket.error',
        sessionId: abbreviateIdentifier(sessionId),
        connectionId: abbreviateIdentifier(socketState.connectionId),
        err: error
      },
      'WebSocket connection emitted an error.'
    );
  });

  socket.on('close', () => {
    clearInterval(heartbeat);
    unregisterSocket(sessionId, socketState.connectionId);
  });

  sendInitialSocketState(socketState);
  app.log.info(
    {
      event: 'socket.initial_state.sent',
      routeUrl: request.url,
      sessionId: abbreviateIdentifier(sessionId),
      connectionId: abbreviateIdentifier(socketState.connectionId)
    },
    'Sent initial WebSocket application state.'
  );
}

app.register(async function websocketRoutes(fastify) {
  fastify.get('/api/ws', { websocket: true }, handleApplicationWebSocketConnection);
  fastify.get('/ws', { websocket: true }, handleApplicationWebSocketConnection);
});

if (fs.existsSync(config.webDistRoot)) {
  const assetsRoot = path.join(config.webDistRoot, 'assets');

  app.register(fastifyStatic, {
    root: config.webDistRoot,
    serve: false
  });

  if (fs.existsSync(assetsRoot)) {
    app.register(fastifyStatic, {
      root: assetsRoot,
      prefix: '/assets/',
      decorateReply: false,
      maxAge: '1d'
    });
  }

  app.get('/', async (_: FastifyRequest, reply: FastifyReply) => {
    return reply.sendFile('index.html', {
      maxAge: 0,
      immutable: false
    });
  });

  app.get('/*', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/api/') || request.url === '/ws') {
      reply.code(404).send({ message: 'Not found.' });
      return;
    }

    return reply.sendFile('index.html', {
      maxAge: 0,
      immutable: false
    });
  });
} else {
  app.get('/', async (_: FastifyRequest, reply: FastifyReply) => {
    reply.type('text/html').send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem;">
          <p>The frontend build was not found yet.</p>
          <p>Run <code>npm run build</code> from the repository root.</p>
        </body>
      </html>
    `);
  });
}

let isShutdownInProgress = false;

function terminateAllActiveCommandsForShutdown(): void {
  for (const itemId of Array.from(activeCommandProcessesByItemId.keys())) {
    terminateActiveCatalogItemCommands(itemId);
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShutdownInProgress) {
    app.log.warn({ event: 'shutdown.signal.ignored', signal }, 'Shutdown is already in progress.');
    return;
  }

  isShutdownInProgress = true;
  app.log.info({ event: 'shutdown.started', signal }, 'Received shutdown signal. Closing server.');

  const forceExitTimer = setTimeout(() => {
    app.log.error(
      { event: 'shutdown.force_exit', signal },
      'Graceful shutdown did not finish before the timeout; forcing process exit.'
    );
    process.exit(1);
  }, 28_000);
  forceExitTimer.unref?.();

  try {
    terminateAllActiveCommandsForShutdown();
    await app.close();
    clearTimeout(forceExitTimer);
    app.log.info({ event: 'shutdown.completed', signal }, 'Server closed cleanly.');
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    app.log.error({ event: 'shutdown.failed', signal, err: error }, 'Graceful shutdown failed.');
    process.exit(1);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

async function start(): Promise<void> {
  try {
    await catalogStore.initialize();

    await app.listen({
      port: config.port,
      host: config.host
    });
    app.log.info(`Video Catalog listening on http://${config.host}:${config.port}`);

    const allItems = catalogStore.list();
    const pendingProcessingCount = allItems.filter((item) => item.status === 'pending_processing').length;
    const processingCount = allItems.filter((item) => item.status === 'processing').length;
    const failedCount = allItems.filter((item) => item.status === 'failed').length;
    const pendingIngestCount = catalogStore.listPendingIngests().length;

    app.log.info(
      {
        event: 'startup.observability.summary',
        catalogItemCount: allItems.length,
        pendingIngestCount,
        pendingProcessingCount,
        processingCount,
        failedCount
      },
      'Loaded ingest and processing state from Postgres-backed storage.'
    );

    const processingRecoveryCandidates = allItems.filter(
      (item) => item.status === 'pending_processing' || item.status === 'processing'
    );

    const toolAvailability = detectToolAvailability(getToolCommandConfig());
    const missingProcessingTools = [
      toolAvailability.ffprobe ? null : 'ffprobe',
      toolAvailability.ffmpeg ? null : 'ffmpeg'
    ].filter((value): value is string => value !== null);

    if (missingProcessingTools.length > 0) {
      app.log.warn(
        {
          event: 'startup.processing.tools_unavailable',
          missingTools: missingProcessingTools,
          pendingProcessingCount,
          processingCount
        },
        'Downstream media processing is enabled, but required tools are unavailable.'
      );
    }

    for (const item of processingRecoveryCandidates) {
      await enqueueCatalogItemProcessing(item, null, {
        recovered: true
      });
    }

    if (processingRecoveryCandidates.length > 0) {
      app.log.info(
        {
          event: 'startup.processing.recovered',
          recoveredCount: processingRecoveryCandidates.length,
          pendingProcessingCount,
          processingCount
        },
        'Recovered unfinished catalog items into the in-process media queue.'
      );
    }

    const sessionSweepTimer = setInterval(() => {
      sessionStore.cleanup();
      for (const activeSessionId of socketsBySessionId.keys()) {
        if (!sessionStore.peek(activeSessionId)) {
          closeSessionSockets(activeSessionId, 4000, 'Session expired', true, 'expired');
        }
      }
    }, SESSION_SWEEP_MS);

    if (
      typeof sessionSweepTimer === 'object' &&
      sessionSweepTimer !== null &&
      'unref' in sessionSweepTimer &&
      typeof sessionSweepTimer.unref === 'function'
    ) {
      sessionSweepTimer.unref();
    }

    app.log.info(
      {
        event: 'startup.websocket.protocol.ready',
        wsMaxMessageBytes: WS_MAX_MESSAGE_BYTES,
        wsRateWindowMs: WS_RATE_WINDOW_MS,
        wsMaxCommandsPerWindow: WS_MAX_COMMANDS_PER_WINDOW
      },
      'Structured WebSocket command/event protocol is enabled.'
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
