import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CatalogStore } from './catalog-store';
import type { AppConfig } from './config';
import type { CatalogBookmark, CatalogItem, HoverPreviewSprite, ProcessingSnapshot } from './types';

export const HOVER_PREVIEW_REBUILD_REVISION = 1;

const PREVIEW_PLAYBACK_SECONDS = 3;
const PREVIEW_TARGET_FRAME_COUNT = 25;
const PREVIEW_COLUMNS = 5;
const PREVIEW_FRAME_WIDTH = 160;
const PREVIEW_FRAME_HEIGHT = 90;
const COMMAND_ABORT_GRACE_MS = 2000;

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

    if (!this.options.isFfmpegAvailable()) {
      this.options.logger.warn(
        {
          event: 'hover_preview.idle_rebuild.skipped',
          reason,
          targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
          missingTool: 'ffmpeg'
        },
        'Skipping idle hover preview rebuild because ffmpeg is unavailable.'
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

  cancel(reason: string): void {
    this.restartAfterCurrentRunReason = null;
    const abortController = this.abortController;
    if (!abortController || abortController.signal.aborted) {
      return;
    }

    this.options.logger.info(
      {
        event: 'hover_preview.idle_rebuild.cancel_requested',
        reason,
        targetRevision: HOVER_PREVIEW_REBUILD_REVISION
      },
      'Cancelling idle hover preview rebuild because the server is active.'
    );
    abortController.abort(new IdleHoverPreviewRebuildCancelledError(reason));
  }

  async close(): Promise<void> {
    this.cancel('server.closing');
    await this.runPromise;
  }

  private async run(reason: string, runId: number, signal: AbortSignal): Promise<void> {
    const attemptedItemIds = new Set<string>();
    let rebuiltCount = 0;
    let unavailableCount = 0;
    let failedCount = 0;

    this.options.logger.info(
      {
        event: 'hover_preview.idle_rebuild.started',
        reason,
        runId,
        targetRevision: HOVER_PREVIEW_REBUILD_REVISION
      },
      'Started idle hover preview rebuild audit.'
    );

    try {
      while (!signal.aborted) {
        const item = this.findNextCandidate(attemptedItemIds);
        if (!item) {
          break;
        }

        attemptedItemIds.add(item.id);

        try {
          const result = await this.rebuildCatalogItemHoverPreview(item, signal);
          if (result === 'rebuilt') {
            rebuiltCount += 1;
          } else if (result === 'unavailable') {
            unavailableCount += 1;
          }
        } catch (error) {
          if (isCancellationError(error) || signal.aborted) {
            throw error;
          }

          failedCount += 1;
          this.options.logger.warn(
            {
              event: 'hover_preview.idle_rebuild.item_failed',
              runId,
              itemId: item.id,
              visibleName: item.visibleName,
              targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
              err: error
            },
            'Idle hover preview rebuild failed for one catalog item; continuing with the audit.'
          );
        }

        await yieldToEventLoop(signal);
      }

      if (signal.aborted) {
        throw new IdleHoverPreviewRebuildCancelledError();
      }

      this.options.logger.info(
        {
          event: 'hover_preview.idle_rebuild.completed',
          runId,
          targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
          attemptedCount: attemptedItemIds.size,
          rebuiltCount,
          unavailableCount,
          failedCount,
          remainingCount: this.countRemainingCandidates()
        },
        'Completed idle hover preview rebuild audit.'
      );
    } catch (error) {
      if (isCancellationError(error) || signal.aborted) {
        this.options.logger.info(
          {
            event: 'hover_preview.idle_rebuild.cancelled',
            runId,
            targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
            attemptedCount: attemptedItemIds.size,
            rebuiltCount,
            unavailableCount,
            failedCount,
            remainingCount: this.countRemainingCandidates()
          },
          'Idle hover preview rebuild audit stopped before completion.'
        );
        return;
      }

      this.options.logger.error(
        {
          event: 'hover_preview.idle_rebuild.failed',
          runId,
          targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
          attemptedCount: attemptedItemIds.size,
          rebuiltCount,
          unavailableCount,
          failedCount,
          err: error
        },
        'Idle hover preview rebuild audit failed unexpectedly.'
      );
    }
  }

  private findNextCandidate(attemptedItemIds: Set<string>): CatalogItem | null {
    return (
      this.options.catalogStore
        .list()
        .filter((item) => item.status === 'ready')
        .filter((item) => item.hoverPreviewRevision < HOVER_PREVIEW_REBUILD_REVISION)
        .filter((item) => !attemptedItemIds.has(item.id))
        .sort((left, right) => left.uploadedAt.localeCompare(right.uploadedAt))[0] ?? null
    );
  }

  private countRemainingCandidates(): number {
    return this.options.catalogStore
      .list()
      .filter((item) => item.status === 'ready')
      .filter((item) => item.hoverPreviewRevision < HOVER_PREVIEW_REBUILD_REVISION).length;
  }

  private async rebuildCatalogItemHoverPreview(
    item: CatalogItem,
    signal: AbortSignal
  ): Promise<'rebuilt' | 'unavailable'> {
    throwIfCancelled(signal);

    const durationSeconds = item.probe?.durationSeconds ?? null;
    if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      await this.markHoverPreviewUnavailable(item, 'duration_unavailable', signal);
      return 'unavailable';
    }

    const inputPath = resolveManagedMediaAbsolutePath(this.options.config.mediaRoot, item.relativePath);
    if (!inputPath || !fileExists(inputPath)) {
      this.options.logger.warn(
        {
          event: 'hover_preview.idle_rebuild.source_missing',
          itemId: item.id,
          visibleName: item.visibleName,
          relativePath: item.relativePath,
          targetRevision: HOVER_PREVIEW_REBUILD_REVISION
        },
        'Skipping idle hover preview rebuild because the catalog item media file is missing.'
      );
      return 'unavailable';
    }

    const bookmarks = this.options.catalogStore.listCatalogItemBookmarks(item.id);
    const captureStartSeconds = determineHoverPreviewStartSeconds(item, bookmarks, durationSeconds);
    const captureDurationSeconds = Math.max(
      0.001,
      Math.min(PREVIEW_PLAYBACK_SECONDS, durationSeconds - captureStartSeconds)
    );
    const frameCount = Math.max(
      1,
      Math.min(
        PREVIEW_TARGET_FRAME_COUNT,
        Math.round((PREVIEW_TARGET_FRAME_COUNT * captureDurationSeconds) / PREVIEW_PLAYBACK_SECONDS)
      )
    );
    const columns = Math.max(1, Math.min(PREVIEW_COLUMNS, frameCount));
    const rows = Math.max(1, Math.ceil(frameCount / columns));
    const samplingFps = (frameCount / captureDurationSeconds).toFixed(6);
    const outputDescriptor = createHoverPreviewDescriptor(this.options.config, item, HOVER_PREVIEW_REBUILD_REVISION);
    const temporaryOutputPath = path.join(
      path.dirname(outputDescriptor.absolutePath),
      `${item.id}-r${HOVER_PREVIEW_REBUILD_REVISION}-${randomUUID()}.tmp.jpg`
    );

    fs.mkdirSync(path.dirname(outputDescriptor.absolutePath), { recursive: true });
    removePathIfExists(temporaryOutputPath);

    this.options.logger.info(
      {
        event: 'hover_preview.idle_rebuild.item_started',
        itemId: item.id,
        visibleName: item.visibleName,
        targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
        bookmarkCount: bookmarks.length,
        captureStartSeconds,
        captureDurationSeconds,
        frameCount,
        columns,
        rows
      },
      'Rebuilding catalog item hover preview during server idle time.'
    );

    try {
      const commandResult = await runFfmpegCommand(
        this.options.config.ffmpegCommand,
        [
          '-y',
          '-nostdin',
          '-v',
          'error',
          '-ss',
          captureStartSeconds.toFixed(3),
          '-t',
          captureDurationSeconds.toFixed(3),
          '-i',
          inputPath,
          '-an',
          '-vf',
          `fps=${samplingFps},scale=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}:force_original_aspect_ratio=decrease,pad=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,tile=${columns}x${rows}:nb_frames=${frameCount}`,
          '-frames:v',
          '1',
          '-vsync',
          '0',
          '-q:v',
          '3',
          temporaryOutputPath
        ],
        signal,
        this.options.logger,
        {
          commandLabel: 'ffmpeg idle hover preview sprite',
          itemId: item.id
        }
      );

      if (commandResult.exitCode !== 0) {
        const message = sanitizeCommandFailure(commandResult.stderr || commandResult.stdout);
        throw new Error(message || 'ffmpeg idle hover preview sprite failed.');
      }

      throwIfCancelled(signal);

      const temporaryStats = fs.statSync(temporaryOutputPath);
      if (!temporaryStats.isFile() || temporaryStats.size <= 0) {
        throw new Error('ffmpeg did not produce a non-empty hover preview sprite.');
      }

      renameReplacingDestination(temporaryOutputPath, outputDescriptor.absolutePath);
      throwIfCancelled(signal);

      const latestItem = this.options.catalogStore.findById(item.id);
      if (!latestItem) {
        return 'unavailable';
      }

      const updatedItem = await this.options.catalogStore.updateCatalogItem(item.id, {
        hoverPreviewSprite: createHoverPreviewSprite(outputDescriptor.relativePath, frameCount, columns, rows),
        hoverPreviewRevision: HOVER_PREVIEW_REBUILD_REVISION,
        processing: createCacheBustProcessingSnapshot(latestItem)
      });

      if (!updatedItem) {
        return 'unavailable';
      }

      this.options.onCatalogItemUpdated?.(updatedItem);

      removeObsoleteHoverPreviewFile(this.options.config, latestItem, outputDescriptor.absolutePath);

      this.options.logger.info(
        {
          event: 'hover_preview.idle_rebuild.item_completed',
          itemId: updatedItem.id,
          visibleName: updatedItem.visibleName,
          targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
          hoverPreviewRelativePath: outputDescriptor.relativePath,
          bookmarkCount: bookmarks.length,
          captureStartSeconds,
          captureDurationSeconds,
          frameCount,
          columns,
          rows
        },
        'Rebuilt catalog item hover preview during server idle time.'
      );

      return 'rebuilt';
    } finally {
      removePathIfExists(temporaryOutputPath);
    }
  }

  private async markHoverPreviewUnavailable(
    item: CatalogItem,
    reason: string,
    signal: AbortSignal
  ): Promise<void> {
    throwIfCancelled(signal);

    const latestItem = this.options.catalogStore.findById(item.id);
    if (!latestItem) {
      return;
    }

    await this.options.catalogStore.updateCatalogItem(item.id, {
      hoverPreviewSprite: null,
      hoverPreviewRevision: HOVER_PREVIEW_REBUILD_REVISION,
      processing: createCacheBustProcessingSnapshot(latestItem)
    });

    this.options.logger.warn(
      {
        event: 'hover_preview.idle_rebuild.item_unavailable',
        itemId: item.id,
        visibleName: item.visibleName,
        targetRevision: HOVER_PREVIEW_REBUILD_REVISION,
        reason
      },
      'Marked catalog item hover preview as audited without a sprite because required media metadata is unavailable.'
    );
  }
}

function createHoverPreviewSprite(
  relativePath: string,
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
    frameHeight: PREVIEW_FRAME_HEIGHT
  };
}

function determineHoverPreviewStartSeconds(
  item: CatalogItem,
  bookmarks: CatalogBookmark[],
  durationSeconds: number
): number {
  const maxStartSeconds = Math.max(0, durationSeconds - 0.001);
  const rawStartSeconds = bookmarks.length > 0
    ? bookmarks[Math.floor(bookmarks.length / 2)]?.timeSeconds ?? 0
    : durationSeconds / 2;

  const safeStartSeconds = Number.isFinite(rawStartSeconds) ? rawStartSeconds : 0;
  return Math.max(0, Math.min(maxStartSeconds, safeStartSeconds));
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
  context: { commandLabel: string; itemId: string }
): Promise<CommandResult> {
  throwIfCancelled(signal);

  logger.info(
    {
      event: 'hover_preview.idle_rebuild.command_started',
      itemId: context.itemId,
      commandLabel: context.commandLabel,
      command,
      argCount: args.length
    },
    'Starting idle hover preview ffmpeg command.'
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
            event: 'hover_preview.idle_rebuild.command_spawn_failed',
            itemId: context.itemId,
            commandLabel: context.commandLabel,
            err: error
          },
          'Failed to start idle hover preview ffmpeg command.'
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
              ? 'hover_preview.idle_rebuild.command_completed'
              : 'hover_preview.idle_rebuild.command_failed',
            itemId: context.itemId,
            commandLabel: context.commandLabel,
            exitCode: result.exitCode,
            stdoutBytes: Buffer.byteLength(stdout),
            stderrBytes: Buffer.byteLength(stderr)
          },
          result.exitCode === 0
            ? 'Idle hover preview ffmpeg command completed.'
            : 'Idle hover preview ffmpeg command exited with a non-zero status.'
        );

        resolve(result);
      });
    });

    if (signal.aborted) {
      abortHandler();
    }
  });
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
