import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CatalogStore } from './catalog-store';
import type { AppConfig } from './config';
import type { CatalogBookmark, CatalogItem, HoverPreviewSprite, ProcessingSnapshot } from './types';

const PREVIEW_NO_BOOKMARK_START_THRESHOLD_SECONDS = 20;
const PREVIEW_FRAME_WIDTH = 160;
const PREVIEW_FRAME_HEIGHT = 90;
const COMMAND_ABORT_GRACE_MS = 2000;
const MIN_CAPTURE_SECONDS = 0.001;
const MAX_EXACT_LAYOUT_COLUMN_ROW_RATIO = 3;

type Logger = {
  info: (payload: Record<string, unknown>, message: string) => void;
  warn: (payload: Record<string, unknown>, message: string) => void;
  error: (payload: Record<string, unknown>, message: string) => void;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type HoverPreviewDescriptor = {
  absolutePath: string;
  relativePath: string;
};

type HoverPreviewSegment = {
  startSeconds: number;
  durationSeconds: number;
  source: 'video_start' | 'video_middle' | 'bookmark';
  bookmarkId?: string;
  bookmarkTimeSeconds?: number;
};

type HoverPreviewPlan = {
  segments: HoverPreviewSegment[];
  effectiveDurationSeconds: number;
};

type HoverPreviewRebuildReason =
  | 'missing_preview_file'
  | 'preview_layout_mismatch'
  | 'preview_playback_duration_mismatch'
  | 'bookmark_count_revision_mismatch'
  | 'bookmark_added';

type HoverPreviewRebuildScope = 'idle_audit' | 'bookmark_regeneration';

type HoverPreviewRebuildContext = {
  scope: HoverPreviewRebuildScope;
  runId: number;
  reason: HoverPreviewRebuildReason;
  triggerBookmarkId?: string | null;
};

type ImmediateHoverPreviewRebuildRequest = {
  itemId: string;
  reason: Extract<HoverPreviewRebuildReason, 'bookmark_added'>;
  bookmarkId: string | null;
};

type HoverPreviewLayout = {
  frameCount: number;
  columns: number;
  rows: number;
};

type PreviewAuditDecision =
  | {
      action: 'skip';
      bookmarkCount: number;
      storedRevision: number;
      previewAbsolutePath: string;
      previewFileExists: true;
    }
  | {
      action: 'rebuild';
      reason: Exclude<HoverPreviewRebuildReason, 'bookmark_added'>;
      bookmarkCount: number;
      storedRevision: number;
      previewAbsolutePath: string | null;
      previewFileExists: boolean;
    };

type IdleHoverPreviewRebuilderOptions = {
  catalogStore: CatalogStore;
  config: AppConfig;
  logger: Logger;
  isFfmpegAvailable: () => boolean;
  onCatalogItemUpdated?: (item: CatalogItem) => void;
};

class IdleHoverPreviewRebuildCancelledError extends Error {
  constructor(message: string = 'Idle hover preview rebuild was cancelled.') {
    super(message);
    this.name = 'IdleHoverPreviewRebuildCancelledError';
  }
}

export class IdleHoverPreviewRebuilder {
  private abortController: AbortController | null = null;
  private runPromise: Promise<void> | null = null;
  private restartAfterCurrentRunReason: string | null = null;
  private startIdleAuditAfterImmediateRebuildReason: string | null = null;
  private immediateRebuildQueue = new Map<string, ImmediateHoverPreviewRebuildRequest>();
  private immediateRebuildPromise: Promise<void> | null = null;
  private immediateAbortController: AbortController | null = null;
  private isClosing = false;
  private runSequence = 0;

  constructor(private readonly options: IdleHoverPreviewRebuilderOptions) {}

  start(reason: string): void {
    if (this.runPromise) {
      if (this.abortController?.signal.aborted) {
        this.restartAfterCurrentRunReason = reason;
      }
      return;
    }

    this.restartAfterCurrentRunReason = null;

    if (this.immediateRebuildPromise) {
      this.startIdleAuditAfterImmediateRebuildReason = reason;
      this.options.logger.info(
        {
          event: 'hover_preview.idle_audit.deferred_for_bookmark_regeneration',
          reason
        },
        'Deferring idle hover preview audit until bookmark-triggered regeneration finishes.'
      );
      return;
    }

    if (!this.options.isFfmpegAvailable()) {
      this.options.logger.warn(
        {
          event: 'hover_preview.idle_audit.skipped',
          reason,
          missingTool: 'ffmpeg',
          hoverPreviewDurationSeconds: this.options.config.hoverPreviewDurationSeconds,
          hoverPreviewFrameCount: this.options.config.hoverPreviewFrameCount
        },
        'Skipping idle hover preview audit because ffmpeg is unavailable.'
      );
      return;
    }

    const abortController = new AbortController();
    const runId = ++this.runSequence;
    this.abortController = abortController;
    this.runPromise = this.run(reason, runId, abortController.signal).finally(() => {
      if (this.abortController === abortController) {
        this.abortController = null;
      }

      if (this.runPromise) {
        this.runPromise = null;
      }

      const restartReason = this.restartAfterCurrentRunReason;
      if (restartReason) {
        this.restartAfterCurrentRunReason = null;
        this.start(restartReason);
      }
    });
  }

  requestCatalogItemHoverPreviewRebuild(request: {
    itemId: string;
    reason: Extract<HoverPreviewRebuildReason, 'bookmark_added'>;
    bookmarkId?: string | null;
  }): void {
    if (this.isClosing) {
      return;
    }

    const itemId = request.itemId.trim();
    if (itemId === '') {
      return;
    }

    const queuedRequest: ImmediateHoverPreviewRebuildRequest = {
      itemId,
      reason: request.reason,
      bookmarkId: request.bookmarkId ?? null
    };
    const replacedPendingRequest = this.immediateRebuildQueue.has(itemId);
    this.immediateRebuildQueue.set(itemId, queuedRequest);

    this.options.logger.info(
      {
        event: 'hover_preview.bookmark_regeneration.queued',
        itemId,
        bookmarkId: queuedRequest.bookmarkId,
        reason: queuedRequest.reason,
        replacedPendingRequest,
        queueDepth: this.immediateRebuildQueue.size
      },
      'Queued catalog item hover preview regeneration after bookmark creation.'
    );

    this.scheduleImmediateRebuildDrain();
  }

  cancel(reason: string): void {
    this.restartAfterCurrentRunReason = null;
    this.startIdleAuditAfterImmediateRebuildReason = null;
    const abortController = this.abortController;
    if (!abortController || abortController.signal.aborted) {
      return;
    }

    this.options.logger.info(
      {
        event: 'hover_preview.idle_audit.cancel_requested',
        reason,
        resumeStrategy: 'rescan_and_skip_completed_items'
      },
      'Cancelling idle hover preview audit because the server is active.'
    );
    abortController.abort(new IdleHoverPreviewRebuildCancelledError(reason));
  }

  async close(): Promise<void> {
    this.isClosing = true;
    this.immediateRebuildQueue.clear();
    this.cancel('server.closing');
    this.cancelImmediateRebuild('server.closing');
    await Promise.all([this.runPromise, this.immediateRebuildPromise]);
  }

  private async run(reason: string, runId: number, signal: AbortSignal): Promise<void> {
    const auditStartedAt = Date.now();
    const stats = {
      totalCatalogItemCount: 0,
      readyCatalogItemCount: 0,
      examinedCount: 0,
      rebuiltCount: 0,
      skippedCount: 0,
      missingPreviewCount: 0,
      revisionMismatchCount: 0,
      layoutMismatchCount: 0,
      playbackDurationMismatchCount: 0,
      unavailableCount: 0,
      failedCount: 0
    };

    this.options.logger.info(
      {
        event: 'hover_preview.idle_audit.started',
        reason,
        runId,
        hoverPreviewDurationSeconds: this.options.config.hoverPreviewDurationSeconds,
        hoverPreviewFrameCount: this.options.config.hoverPreviewFrameCount,
        resumeStrategy: 'rescan_and_skip_completed_items'
      },
      'Started idle hover preview audit.'
    );

    try {
      const allItems = this.options.catalogStore.list();
      const readyItems = allItems
        .filter((item) => item.status === 'ready')
        .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt));

      stats.totalCatalogItemCount = allItems.length;
      stats.readyCatalogItemCount = readyItems.length;

      for (const itemSnapshot of readyItems) {
        throwIfCancelled(signal);

        const item = this.options.catalogStore.findById(itemSnapshot.id);
        if (!item || item.status !== 'ready') {
          continue;
        }

        const bookmarks = this.options.catalogStore.listCatalogItemBookmarks(item.id);
        const bookmarkCount = bookmarks.length;
        const decision = this.createAuditDecision(item, bookmarks);
        stats.examinedCount += 1;

        this.options.logger.info(
          {
            event: 'hover_preview.idle_audit.item_examined',
            runId,
            itemId: item.id,
            visibleName: item.visibleName,
            bookmarkCount,
            storedRevision: item.hoverPreviewRevision,
            hasHoverPreviewSprite: item.hoverPreviewSprite !== null,
            previewFileExists: decision.previewFileExists,
            decision: decision.action,
            rebuildReason: decision.action === 'rebuild' ? decision.reason : null
          },
          'Examined catalog item during idle hover preview audit.'
        );

        if (decision.action === 'skip') {
          stats.skippedCount += 1;
          this.options.logger.info(
            {
              event: 'hover_preview.idle_audit.item_skipped',
              runId,
              itemId: item.id,
              visibleName: item.visibleName,
              bookmarkCount,
              storedRevision: item.hoverPreviewRevision,
              hoverPreviewAbsolutePath: decision.previewAbsolutePath
            },
            'Skipping hover preview rebuild because the preview file exists and revision matches bookmark count.'
          );
          await yieldToEventLoop(signal);
          continue;
        }

        if (decision.reason === 'missing_preview_file') {
          stats.missingPreviewCount += 1;
        } else if (decision.reason === 'preview_layout_mismatch') {
          stats.layoutMismatchCount += 1;
        } else if (decision.reason === 'preview_playback_duration_mismatch') {
          stats.playbackDurationMismatchCount += 1;
        } else {
          stats.revisionMismatchCount += 1;
        }

        this.options.logger.info(
          {
            event: 'hover_preview.idle_audit.item_rebuild_needed',
            runId,
            itemId: item.id,
            visibleName: item.visibleName,
            reason: decision.reason,
            bookmarkCount,
            storedRevision: item.hoverPreviewRevision,
            hoverPreviewAbsolutePath: decision.previewAbsolutePath
          },
          getHoverPreviewRebuildReasonMessage(decision.reason)
        );

        try {
          const result = await this.rebuildCatalogItemHoverPreview(
            item,
            bookmarks,
            {
              scope: 'idle_audit',
              runId,
              reason: decision.reason
            },
            signal
          );
          if (result === 'rebuilt') {
            stats.rebuiltCount += 1;
          } else {
            stats.unavailableCount += 1;
          }
        } catch (error) {
          if (isCancellationError(error) || signal.aborted) {
            throw error;
          }

          stats.failedCount += 1;
          this.options.logger.warn(
            {
              event: 'hover_preview.idle_audit.item_failed',
              runId,
              itemId: item.id,
              visibleName: item.visibleName,
              bookmarkCount,
              storedRevision: item.hoverPreviewRevision,
              err: error
            },
            'Idle hover preview rebuild failed for one catalog item; continuing with the audit.'
          );
        }

        await yieldToEventLoop(signal);
      }

      throwIfCancelled(signal);

      this.options.logger.info(
        {
          event: 'hover_preview.idle_audit.completed',
          runId,
          status: 'completed',
          elapsedMs: Date.now() - auditStartedAt,
          remainingRebuildCandidateCount: this.countCurrentRebuildCandidates(),
          ...stats
        },
        'Completed idle hover preview audit.'
      );
    } catch (error) {
      if (isCancellationError(error) || signal.aborted) {
        this.options.logger.info(
          {
            event: 'hover_preview.idle_audit.cancelled',
            runId,
            status: 'cancelled',
            elapsedMs: Date.now() - auditStartedAt,
            remainingRebuildCandidateCount: this.countCurrentRebuildCandidates(),
            resumeStrategy: 'rescan_and_skip_completed_items',
            ...stats
          },
          'Idle hover preview audit stopped before completion; it will resume by rescanning when the server is idle again.'
        );
        return;
      }

      this.options.logger.error(
        {
          event: 'hover_preview.idle_audit.failed',
          runId,
          status: 'failed',
          elapsedMs: Date.now() - auditStartedAt,
          remainingRebuildCandidateCount: this.countCurrentRebuildCandidates(),
          ...stats,
          err: error
        },
        'Idle hover preview audit failed unexpectedly.'
      );
    }
  }

  private scheduleImmediateRebuildDrain(): void {
    if (this.immediateRebuildPromise) {
      return;
    }

    this.immediateRebuildPromise = this.drainImmediateRebuildQueue()
      .catch((error: unknown) => {
        this.options.logger.error(
          {
            event: 'hover_preview.bookmark_regeneration.drain_failed',
            err: error
          },
          'Bookmark-triggered hover preview regeneration queue failed unexpectedly.'
        );
      })
      .finally(() => {
        this.immediateRebuildPromise = null;
        if (this.isClosing) {
          return;
        }

        if (this.immediateRebuildQueue.size > 0) {
          this.scheduleImmediateRebuildDrain();
          return;
        }

        const idleAuditReason = this.startIdleAuditAfterImmediateRebuildReason;
        if (idleAuditReason) {
          this.startIdleAuditAfterImmediateRebuildReason = null;
          this.start(idleAuditReason);
        }
      });
  }

  private async drainImmediateRebuildQueue(): Promise<void> {
    while (!this.isClosing && this.immediateRebuildQueue.size > 0) {
      const nextEntry = this.immediateRebuildQueue.entries().next();
      if (nextEntry.done) {
        return;
      }

      const [itemId, request] = nextEntry.value;
      this.immediateRebuildQueue.delete(itemId);

      if (!this.options.isFfmpegAvailable()) {
        this.options.logger.warn(
          {
            event: 'hover_preview.bookmark_regeneration.skipped',
            itemId: request.itemId,
            bookmarkId: request.bookmarkId,
            reason: request.reason,
            missingTool: 'ffmpeg',
            hoverPreviewDurationSeconds: this.options.config.hoverPreviewDurationSeconds,
            hoverPreviewFrameCount: this.options.config.hoverPreviewFrameCount
          },
          'Skipping bookmark-triggered hover preview regeneration because ffmpeg is unavailable.'
        );
        continue;
      }

      const currentIdleAuditRun = this.runPromise;
      if (currentIdleAuditRun) {
        this.cancel(request.reason);
        await currentIdleAuditRun;
      }

      if (this.isClosing) {
        return;
      }

      const runId = ++this.runSequence;
      await this.runImmediateRebuildRequest(request, runId);
    }
  }

  private async runImmediateRebuildRequest(
    request: ImmediateHoverPreviewRebuildRequest,
    runId: number
  ): Promise<void> {
    const item = this.options.catalogStore.findById(request.itemId);
    if (!item) {
      this.options.logger.info(
        {
          event: 'hover_preview.bookmark_regeneration.skipped',
          runId,
          itemId: request.itemId,
          bookmarkId: request.bookmarkId,
          reason: request.reason,
          skipReason: 'catalog_item_missing'
        },
        'Skipping bookmark-triggered hover preview regeneration because the catalog item no longer exists.'
      );
      return;
    }

    if (item.status !== 'ready') {
      this.options.logger.info(
        {
          event: 'hover_preview.bookmark_regeneration.skipped',
          runId,
          itemId: item.id,
          visibleName: item.visibleName,
          bookmarkId: request.bookmarkId,
          reason: request.reason,
          skipReason: 'catalog_item_not_ready',
          status: item.status
        },
        'Skipping bookmark-triggered hover preview regeneration because the catalog item is not ready.'
      );
      return;
    }

    const bookmarks = this.options.catalogStore.listCatalogItemBookmarks(item.id);
    const bookmarkCount = bookmarks.length;
    const decision = this.createAuditDecision(item, bookmarks);

    this.options.logger.info(
      {
        event: 'hover_preview.bookmark_regeneration.item_examined',
        runId,
        itemId: item.id,
        visibleName: item.visibleName,
        bookmarkId: request.bookmarkId,
        reason: request.reason,
        bookmarkCount,
        storedRevision: item.hoverPreviewRevision,
        hasHoverPreviewSprite: item.hoverPreviewSprite !== null,
        previewFileExists: decision.previewFileExists,
        decision: decision.action,
        rebuildReason: decision.action === 'rebuild' ? decision.reason : null
      },
      'Examined catalog item for bookmark-triggered hover preview regeneration.'
    );

    if (decision.action === 'skip') {
      this.options.logger.info(
        {
          event: 'hover_preview.bookmark_regeneration.item_skipped',
          runId,
          itemId: item.id,
          visibleName: item.visibleName,
          bookmarkId: request.bookmarkId,
          reason: request.reason,
          bookmarkCount,
          storedRevision: item.hoverPreviewRevision,
          hoverPreviewAbsolutePath: decision.previewAbsolutePath
        },
        'Skipping bookmark-triggered hover preview regeneration because the preview is already current.'
      );
      return;
    }

    const abortController = new AbortController();
    this.immediateAbortController = abortController;

    try {
      await this.rebuildCatalogItemHoverPreview(
        item,
        bookmarks,
        {
          scope: 'bookmark_regeneration',
          runId,
          reason: request.reason,
          triggerBookmarkId: request.bookmarkId
        },
        abortController.signal
      );
    } catch (error) {
      if (isCancellationError(error) || abortController.signal.aborted) {
        this.options.logger.info(
          {
            event: 'hover_preview.bookmark_regeneration.cancelled',
            runId,
            itemId: item.id,
            visibleName: item.visibleName,
            bookmarkId: request.bookmarkId,
            reason: request.reason,
            err: error
          },
          'Bookmark-triggered hover preview regeneration was cancelled.'
        );
        return;
      }

      this.options.logger.warn(
        {
          event: 'hover_preview.bookmark_regeneration.item_failed',
          runId,
          itemId: item.id,
          visibleName: item.visibleName,
          bookmarkId: request.bookmarkId,
          reason: request.reason,
          bookmarkCount,
          storedRevision: item.hoverPreviewRevision,
          err: error
        },
        'Bookmark-triggered hover preview regeneration failed for one catalog item.'
      );
    } finally {
      if (this.immediateAbortController === abortController) {
        this.immediateAbortController = null;
      }
    }
  }

  private cancelImmediateRebuild(reason: string): void {
    const abortController = this.immediateAbortController;
    if (!abortController || abortController.signal.aborted) {
      return;
    }

    this.options.logger.info(
      {
        event: 'hover_preview.bookmark_regeneration.cancel_requested',
        reason
      },
      'Cancelling bookmark-triggered hover preview regeneration.'
    );
    abortController.abort(new IdleHoverPreviewRebuildCancelledError(reason));
  }

  private createAuditDecision(item: CatalogItem, bookmarks: CatalogBookmark[]): PreviewAuditDecision {
    const bookmarkCount = bookmarks.length;
    const previewAbsolutePath = resolveHoverPreviewSpriteAbsolutePath(this.options.config, item);
    const previewFileExists = previewAbsolutePath !== null && fileExists(previewAbsolutePath);

    if (!previewFileExists) {
      return {
        action: 'rebuild',
        reason: 'missing_preview_file',
        bookmarkCount,
        storedRevision: item.hoverPreviewRevision,
        previewAbsolutePath,
        previewFileExists
      };
    }

    if (!doesHoverPreviewSpriteMatchConfiguredLayout(item.hoverPreviewSprite, this.options.config.hoverPreviewFrameCount)) {
      return {
        action: 'rebuild',
        reason: 'preview_layout_mismatch',
        bookmarkCount,
        storedRevision: item.hoverPreviewRevision,
        previewAbsolutePath,
        previewFileExists
      };
    }

    const expectedDurationSeconds = createExpectedHoverPreviewDurationSeconds(
      item,
      bookmarks,
      this.options.config.hoverPreviewDurationSeconds
    );
    if (
      expectedDurationSeconds !== null &&
      !doesHoverPreviewSpriteMatchExpectedPlaybackDuration(item.hoverPreviewSprite, expectedDurationSeconds)
    ) {
      return {
        action: 'rebuild',
        reason: 'preview_playback_duration_mismatch',
        bookmarkCount,
        storedRevision: item.hoverPreviewRevision,
        previewAbsolutePath,
        previewFileExists
      };
    }

    if (item.hoverPreviewRevision !== bookmarkCount) {
      return {
        action: 'rebuild',
        reason: 'bookmark_count_revision_mismatch',
        bookmarkCount,
        storedRevision: item.hoverPreviewRevision,
        previewAbsolutePath,
        previewFileExists
      };
    }

    return {
      action: 'skip',
      bookmarkCount,
      storedRevision: item.hoverPreviewRevision,
      previewAbsolutePath,
      previewFileExists: true
    };
  }

  private countCurrentRebuildCandidates(): number {
    return this.options.catalogStore
      .list()
      .filter((item) => item.status === 'ready')
      .filter((item) => {
        const bookmarks = this.options.catalogStore.listCatalogItemBookmarks(item.id);
        return this.createAuditDecision(item, bookmarks).action === 'rebuild';
      }).length;
  }

  private async rebuildCatalogItemHoverPreview(
    item: CatalogItem,
    bookmarks: CatalogBookmark[],
    context: HoverPreviewRebuildContext,
    signal: AbortSignal
  ): Promise<'rebuilt' | 'unavailable'> {
    throwIfCancelled(signal);

    const bookmarkCount = bookmarks.length;
    const durationSeconds = item.probe?.durationSeconds ?? null;
    if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      this.options.logger.warn(
        {
          event: createScopedHoverPreviewEvent(context.scope, 'item_unavailable'),
          runId: context.runId,
          itemId: item.id,
          visibleName: item.visibleName,
          triggerBookmarkId: context.triggerBookmarkId ?? null,
          reason: 'duration_unavailable',
          rebuildReason: context.reason,
          bookmarkCount,
          storedRevision: item.hoverPreviewRevision
        },
        'Cannot rebuild hover preview because the retained asset duration is unavailable.'
      );
      return 'unavailable';
    }

    const inputPath = resolveManagedMediaAbsolutePath(this.options.config.mediaRoot, item.relativePath);
    if (!inputPath || !fileExists(inputPath)) {
      this.options.logger.warn(
        {
          event: createScopedHoverPreviewEvent(context.scope, 'source_missing'),
          runId: context.runId,
          itemId: item.id,
          visibleName: item.visibleName,
          triggerBookmarkId: context.triggerBookmarkId ?? null,
          relativePath: item.relativePath,
          rebuildReason: context.reason,
          bookmarkCount,
          storedRevision: item.hoverPreviewRevision
        },
        'Cannot rebuild hover preview because the catalog item media file is missing.'
      );
      return 'unavailable';
    }

    const plan = createHoverPreviewPlan(bookmarks, durationSeconds, this.options.config.hoverPreviewDurationSeconds);
    const layout = createHoverPreviewLayout(this.options.config.hoverPreviewFrameCount);
    const samplingFps = (layout.frameCount / plan.effectiveDurationSeconds).toFixed(6);
    const outputDescriptor = createHoverPreviewDescriptor(this.options.config, item, bookmarkCount);
    const temporaryOutputPath = path.join(
      path.dirname(outputDescriptor.absolutePath),
      `${item.id}-r${bookmarkCount}-${randomUUID()}.tmp.jpg`
    );

    fs.mkdirSync(path.dirname(outputDescriptor.absolutePath), { recursive: true });
    removePathIfExists(temporaryOutputPath);

    this.options.logger.info(
      {
        event: createScopedHoverPreviewEvent(context.scope, 'item_started'),
        runId: context.runId,
        itemId: item.id,
        visibleName: item.visibleName,
        triggerBookmarkId: context.triggerBookmarkId ?? null,
        reason: context.reason,
        bookmarkCount,
        storedRevision: item.hoverPreviewRevision,
        targetRevision: bookmarkCount,
        hoverPreviewRelativePath: outputDescriptor.relativePath,
        hoverPreviewDurationSeconds: this.options.config.hoverPreviewDurationSeconds,
        hoverPreviewFrameCount: layout.frameCount,
        effectiveCaptureDurationSeconds: plan.effectiveDurationSeconds,
        hoverPreviewPlaybackDurationSeconds: normalizeHoverPreviewSpriteDurationSeconds(plan.effectiveDurationSeconds),
        samplingFps,
        columns: layout.columns,
        rows: layout.rows,
        segments: serializeHoverPreviewSegments(plan.segments)
      },
      context.scope === 'idle_audit'
        ? 'Rebuilding catalog item hover preview during server idle time.'
        : 'Rebuilding catalog item hover preview after bookmark creation.'
    );

    try {
      const commandResult = await runFfmpegCommand(
        this.options.config.ffmpegCommand,
        createHoverPreviewFfmpegArgs({
          inputPath,
          outputPath: temporaryOutputPath,
          segments: plan.segments,
          samplingFps,
          frameCount: layout.frameCount,
          columns: layout.columns,
          rows: layout.rows
        }),
        signal,
        this.options.logger,
        {
          commandLabel: context.scope === 'idle_audit'
            ? 'ffmpeg idle hover preview sprite'
            : 'ffmpeg bookmark-triggered hover preview sprite',
          eventScope: context.scope,
          itemId: item.id
        }
      );

      if (commandResult.exitCode !== 0) {
        const message = sanitizeCommandFailure(commandResult.stderr || commandResult.stdout);
        throw new Error(
          message ||
            (context.scope === 'idle_audit'
              ? 'ffmpeg idle hover preview sprite failed.'
              : 'ffmpeg bookmark-triggered hover preview sprite failed.')
        );
      }

      throwIfCancelled(signal);

      const temporaryStats = fs.statSync(temporaryOutputPath);
      if (!temporaryStats.isFile() || temporaryStats.size <= 0) {
        throw new Error('ffmpeg did not produce a non-empty hover preview sprite.');
      }

      renameReplacingDestination(temporaryOutputPath, outputDescriptor.absolutePath);

      const latestItem = this.options.catalogStore.findById(item.id);
      if (!latestItem) {
        return 'unavailable';
      }

      const updatedItem = await this.options.catalogStore.updateCatalogItem(item.id, {
        hoverPreviewSprite: createHoverPreviewSprite(
          outputDescriptor.relativePath,
          plan.effectiveDurationSeconds,
          layout.frameCount,
          layout.columns,
          layout.rows
        ),
        hoverPreviewRevision: bookmarkCount,
        processing: createCacheBustProcessingSnapshot(latestItem)
      });

      if (!updatedItem) {
        return 'unavailable';
      }

      this.options.onCatalogItemUpdated?.(updatedItem);

      removeObsoleteHoverPreviewFile(this.options.config, latestItem, outputDescriptor.absolutePath);

      this.options.logger.info(
        {
          event: createScopedHoverPreviewEvent(context.scope, 'item_completed'),
          runId: context.runId,
          itemId: updatedItem.id,
          visibleName: updatedItem.visibleName,
          triggerBookmarkId: context.triggerBookmarkId ?? null,
          reason: context.reason,
          targetRevision: bookmarkCount,
          hoverPreviewRelativePath: outputDescriptor.relativePath,
          bookmarkCount,
          hoverPreviewDurationSeconds: this.options.config.hoverPreviewDurationSeconds,
          hoverPreviewFrameCount: layout.frameCount,
          effectiveCaptureDurationSeconds: plan.effectiveDurationSeconds,
          hoverPreviewPlaybackDurationSeconds: normalizeHoverPreviewSpriteDurationSeconds(plan.effectiveDurationSeconds),
          samplingFps,
          columns: layout.columns,
          rows: layout.rows,
          segments: serializeHoverPreviewSegments(plan.segments)
        },
        'Rebuilt catalog item hover preview and updated preview revision to the current bookmark count.'
      );

      return 'rebuilt';
    } finally {
      removePathIfExists(temporaryOutputPath);
    }
  }
}

function createHoverPreviewSprite(
  relativePath: string,
  durationSeconds: number,
  frameCount: number,
  columns: number,
  rows: number
): HoverPreviewSprite {
  return {
    relativePath,
    frameCount,
    columns,
    rows,
    frameWidth: PREVIEW_FRAME_WIDTH,
    frameHeight: PREVIEW_FRAME_HEIGHT,
    durationSeconds: normalizeHoverPreviewSpriteDurationSeconds(durationSeconds)
  };
}

function normalizeHoverPreviewSpriteDurationSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return MIN_CAPTURE_SECONDS;
  }

  return Math.max(MIN_CAPTURE_SECONDS, Number(durationSeconds.toFixed(3)));
}

function doesHoverPreviewSpriteMatchConfiguredLayout(
  sprite: HoverPreviewSprite | null,
  configuredFrameCount: number
): boolean {
  if (!sprite) {
    return false;
  }

  const expectedLayout = createHoverPreviewLayout(configuredFrameCount);
  return (
    sprite.frameCount === expectedLayout.frameCount &&
    sprite.columns === expectedLayout.columns &&
    sprite.rows === expectedLayout.rows &&
    sprite.frameWidth === PREVIEW_FRAME_WIDTH &&
    sprite.frameHeight === PREVIEW_FRAME_HEIGHT
  );
}

function createExpectedHoverPreviewDurationSeconds(
  item: CatalogItem,
  bookmarks: CatalogBookmark[],
  previewDurationSeconds: number
): number | null {
  const durationSeconds = item.probe?.durationSeconds ?? null;
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  return normalizeHoverPreviewSpriteDurationSeconds(
    createHoverPreviewPlan(bookmarks, durationSeconds, previewDurationSeconds).effectiveDurationSeconds
  );
}

function doesHoverPreviewSpriteMatchExpectedPlaybackDuration(
  sprite: HoverPreviewSprite | null,
  expectedDurationSeconds: number
): boolean {
  const spriteDurationSeconds = sprite?.durationSeconds ?? null;
  if (spriteDurationSeconds === null || !Number.isFinite(spriteDurationSeconds) || spriteDurationSeconds <= 0) {
    return false;
  }

  return Math.abs(spriteDurationSeconds - expectedDurationSeconds) <= 0.01;
}

function getHoverPreviewRebuildReasonMessage(
  reason: Exclude<HoverPreviewRebuildReason, 'bookmark_added'>
): string {
  switch (reason) {
    case 'missing_preview_file':
      return 'Hover preview rebuild required because the preview file is missing.';
    case 'preview_layout_mismatch':
      return 'Hover preview rebuild required because the stored preview layout no longer matches the configured frame count.';
    case 'preview_playback_duration_mismatch':
      return 'Hover preview rebuild required because the stored preview playback duration is missing or no longer matches the generated capture duration.';
    case 'bookmark_count_revision_mismatch':
      return 'Hover preview rebuild required because bookmark count differs from stored preview revision.';
  }
}

function createHoverPreviewPlan(
  bookmarks: CatalogBookmark[],
  durationSeconds: number,
  previewDurationSeconds: number
): HoverPreviewPlan {
  const selectedBookmarks = selectHoverPreviewBookmarks(bookmarks);
  const rawSegments: Array<Omit<HoverPreviewSegment, 'durationSeconds'>> = [];
  const segmentBudgetSeconds = selectedBookmarks.length > 0
    ? previewDurationSeconds / selectedBookmarks.length
    : previewDurationSeconds;

  if (selectedBookmarks.length === 0) {
    rawSegments.push({
      source: durationSeconds < PREVIEW_NO_BOOKMARK_START_THRESHOLD_SECONDS ? 'video_start' : 'video_middle',
      startSeconds: durationSeconds < PREVIEW_NO_BOOKMARK_START_THRESHOLD_SECONDS ? 0 : durationSeconds / 2
    });
  } else {
    for (const bookmark of selectedBookmarks) {
      rawSegments.push({
        source: 'bookmark',
        startSeconds: bookmark.timeSeconds,
        bookmarkId: bookmark.id,
        bookmarkTimeSeconds: bookmark.timeSeconds
      });
    }
  }

  const segments = rawSegments.map((segment) => createSafeHoverPreviewSegment(segment, durationSeconds, segmentBudgetSeconds));
  const effectiveDurationSeconds = Math.max(
    MIN_CAPTURE_SECONDS,
    segments.reduce((total, segment) => total + segment.durationSeconds, 0)
  );

  return {
    segments,
    effectiveDurationSeconds
  };
}

function selectHoverPreviewBookmarks(bookmarks: CatalogBookmark[]): CatalogBookmark[] {
  if (bookmarks.length <= 3) {
    return bookmarks;
  }

  return bookmarks.slice(-3);
}

function createSafeHoverPreviewSegment(
  segment: Omit<HoverPreviewSegment, 'durationSeconds'>,
  durationSeconds: number,
  segmentBudgetSeconds: number
): HoverPreviewSegment {
  const maxStartSeconds = Math.max(0, durationSeconds - MIN_CAPTURE_SECONDS);
  const safeStartSeconds = Number.isFinite(segment.startSeconds) ? segment.startSeconds : 0;
  const startSeconds = Math.max(0, Math.min(maxStartSeconds, safeStartSeconds));
  const availableDurationSeconds = Math.max(MIN_CAPTURE_SECONDS, durationSeconds - startSeconds);
  const duration = Math.max(MIN_CAPTURE_SECONDS, Math.min(segmentBudgetSeconds, availableDurationSeconds));

  return {
    ...segment,
    startSeconds,
    durationSeconds: duration
  };
}

function createHoverPreviewLayout(configuredFrameCount: number): HoverPreviewLayout {
  const frameCount = Math.max(1, Math.floor(configuredFrameCount));
  const exactLayout = findBalancedExactHoverPreviewLayout(frameCount);
  if (exactLayout) {
    return exactLayout;
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(frameCount)));
  const rows = Math.max(1, Math.ceil(frameCount / columns));

  return {
    frameCount,
    columns,
    rows
  };
}

function findBalancedExactHoverPreviewLayout(frameCount: number): HoverPreviewLayout | null {
  for (let rows = Math.floor(Math.sqrt(frameCount)); rows >= 1; rows -= 1) {
    if (frameCount % rows !== 0) {
      continue;
    }

    const columns = frameCount / rows;
    if (columns / rows > MAX_EXACT_LAYOUT_COLUMN_ROW_RATIO) {
      continue;
    }

    return {
      frameCount,
      columns,
      rows
    };
  }

  return null;
}

function createHoverPreviewFfmpegArgs(input: {
  inputPath: string;
  outputPath: string;
  segments: HoverPreviewSegment[];
  samplingFps: string;
  frameCount: number;
  columns: number;
  rows: number;
}): string[] {
  const args = ['-y', '-nostdin', '-v', 'error'];

  for (const segment of input.segments) {
    args.push(
      '-ss',
      formatFfmpegTimestamp(segment.startSeconds),
      '-t',
      formatFfmpegTimestamp(segment.durationSeconds),
      '-i',
      input.inputPath
    );
  }

  args.push(
    '-an',
    '-filter_complex',
    createHoverPreviewFilter(input.segments.length, input.samplingFps, input.frameCount, input.columns, input.rows),
    '-map',
    '[hover_preview_sprite]',
    '-frames:v',
    '1',
    '-vsync',
    '0',
    '-q:v',
    '3',
    input.outputPath
  );

  return args;
}

function createHoverPreviewFilter(
  segmentCount: number,
  samplingFps: string,
  frameCount: number,
  columns: number,
  rows: number
): string {
  const preparedStreams = Array.from({ length: segmentCount }, (_, index) =>
    `[${index}:v]setpts=PTS-STARTPTS,scale=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}:force_original_aspect_ratio=decrease,pad=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[hover_preview_segment_${index}]`
  );
  const tileFilter = `fps=${samplingFps},tile=${columns}x${rows}:nb_frames=${frameCount}:color=black[hover_preview_sprite]`;

  if (segmentCount === 1) {
    return [...preparedStreams, `[hover_preview_segment_0]${tileFilter}`].join(';');
  }

  const concatInputs = Array.from(
    { length: segmentCount },
    (_, index) => `[hover_preview_segment_${index}]`
  ).join('');
  return [
    ...preparedStreams,
    `${concatInputs}concat=n=${segmentCount}:v=1:a=0,${tileFilter}`
  ].join(';');
}

function serializeHoverPreviewSegments(segments: HoverPreviewSegment[]): Array<Record<string, unknown>> {
  return segments.map((segment, index) => ({
    index,
    source: segment.source,
    startSeconds: Number(segment.startSeconds.toFixed(3)),
    durationSeconds: Number(segment.durationSeconds.toFixed(3)),
    bookmarkId: segment.bookmarkId ?? null,
    bookmarkTimeSeconds: segment.bookmarkTimeSeconds ?? null
  }));
}

function createHoverPreviewDescriptor(
  config: AppConfig,
  item: CatalogItem,
  revision: number
): HoverPreviewDescriptor {
  const absolutePath = path.join(config.previewsRoot, `${item.id}-r${revision}.jpg`);
  return {
    absolutePath,
    relativePath: path.relative(config.mediaRoot, absolutePath)
  };
}

function createCacheBustProcessingSnapshot(item: CatalogItem): ProcessingSnapshot {
  if (item.processing) {
    return {
      ...item.processing,
      updatedAt: new Date().toISOString()
    };
  }

  return {
    stage: 'completed',
    percent: 100,
    message: 'Media processing complete.',
    updatedAt: new Date().toISOString()
  };
}

function resolveHoverPreviewSpriteAbsolutePath(config: AppConfig, item: CatalogItem): string | null {
  const relativePath = item.hoverPreviewSprite?.relativePath ?? null;
  if (!relativePath) {
    return null;
  }

  return resolveManagedMediaAbsolutePath(config.mediaRoot, relativePath);
}

function resolveManagedMediaAbsolutePath(mediaRoot: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(mediaRoot);
  const absolutePath = path.resolve(normalizedRoot, relativePath);

  if (absolutePath === normalizedRoot || absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return absolutePath;
  }

  return null;
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function fileExists(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function removePathIfExists(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true, recursive: false });
  } catch {
    // Best-effort cleanup only.
  }
}

function renameReplacingDestination(sourcePath: string, destinationPath: string): void {
  removePathIfExists(destinationPath);
  fs.renameSync(sourcePath, destinationPath);
}

function removeObsoleteHoverPreviewFile(config: AppConfig, previousItem: CatalogItem, nextAbsolutePath: string): void {
  const previousRelativePath = previousItem.hoverPreviewSprite?.relativePath ?? null;
  if (!previousRelativePath) {
    return;
  }

  const previousAbsolutePath = resolveManagedMediaAbsolutePath(config.mediaRoot, previousRelativePath);
  if (!previousAbsolutePath) {
    return;
  }

  if (path.resolve(previousAbsolutePath) === path.resolve(nextAbsolutePath)) {
    return;
  }

  if (!isPathInsideRoot(config.previewsRoot, previousAbsolutePath)) {
    return;
  }

  removePathIfExists(previousAbsolutePath);
}

function formatFfmpegTimestamp(seconds: number): string {
  return Math.max(0, seconds).toFixed(3);
}

function sanitizeCommandFailure(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

async function runFfmpegCommand(
  command: string,
  args: string[],
  signal: AbortSignal,
  logger: Logger,
  context: { commandLabel: string; itemId: string; eventScope: HoverPreviewRebuildScope }
): Promise<CommandResult> {
  throwIfCancelled(signal);

  logger.info(
    {
      event: createScopedHoverPreviewEvent(context.eventScope, 'command_started'),
      itemId: context.itemId,
      commandLabel: context.commandLabel,
      command,
      argCount: args.length
    },
    context.eventScope === 'idle_audit'
    ? 'Starting idle hover preview ffmpeg command.'
    : 'Starting bookmark-triggered hover preview ffmpeg command.'
  );

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let forceKillTimer: NodeJS.Timeout | null = null;
    let settled = false;

    const cleanup = (): void => {
      signal.removeEventListener('abort', abortHandler);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
    };

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const abortHandler = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      try {
        child.kill('SIGTERM');
      } catch {
        // The close/error handler will settle the command promise.
      }

      forceKillTimer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) {
          return;
        }

        try {
          child.kill('SIGKILL');
        } catch {
          // The close/error handler will settle the command promise.
        }
      }, COMMAND_ABORT_GRACE_MS);
      forceKillTimer.unref?.();
    };

    signal.addEventListener('abort', abortHandler, { once: true });

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finish(() => {
        if (signal.aborted) {
          reject(new IdleHoverPreviewRebuildCancelledError());
          return;
        }

        logger.error(
          {
            event: createScopedHoverPreviewEvent(context.eventScope, 'command_spawn_failed'),
            itemId: context.itemId,
            commandLabel: context.commandLabel,
            err: error
          },
          context.eventScope === 'idle_audit'
            ? 'Failed to start idle hover preview ffmpeg command.'
            : 'Failed to start bookmark-triggered hover preview ffmpeg command.'
        );
        reject(error);
      });
    });

    child.on('close', (exitCode) => {
      finish(() => {
        if (signal.aborted) {
          reject(new IdleHoverPreviewRebuildCancelledError());
          return;
        }

        const result = {
          exitCode: exitCode ?? -1,
          stdout,
          stderr
        };

        logger.info(
          {
            event: result.exitCode === 0
              ? createScopedHoverPreviewEvent(context.eventScope, 'command_completed')
              : createScopedHoverPreviewEvent(context.eventScope, 'command_failed'),
            itemId: context.itemId,
            commandLabel: context.commandLabel,
            exitCode: result.exitCode,
            stdoutBytes: Buffer.byteLength(stdout),
            stderrBytes: Buffer.byteLength(stderr)
          },
          result.exitCode === 0
            ? context.eventScope === 'idle_audit'
              ? 'Idle hover preview ffmpeg command completed.'
              : 'Bookmark-triggered hover preview ffmpeg command completed.'
            : context.eventScope === 'idle_audit'
              ? 'Idle hover preview ffmpeg command exited with a non-zero status.'
              : 'Bookmark-triggered hover preview ffmpeg command exited with a non-zero status.'
        );

        resolve(result);
      });
    });

    if (signal.aborted) {
      abortHandler();
    }
  });
}

function createScopedHoverPreviewEvent(scope: HoverPreviewRebuildScope, eventName: string): string {
  return `hover_preview.${scope}.${eventName}`;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new IdleHoverPreviewRebuildCancelledError();
  }
}

function isCancellationError(error: unknown): boolean {
  return error instanceof IdleHoverPreviewRebuildCancelledError;
}

async function yieldToEventLoop(signal: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  throwIfCancelled(signal);
}
