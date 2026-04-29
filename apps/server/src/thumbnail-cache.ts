import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ThumbnailCacheStatus = 'hit' | 'miss' | 'bypass';

export type CachedThumbnailFile = {
  buffer: Buffer;
  contentType: string;
  etag: string;
  lastModified: string;
  mtimeMs: number;
  sizeBytes: number;
  cacheStatus: ThumbnailCacheStatus;
};

type ThumbnailCacheEntry = Omit<CachedThumbnailFile, 'cacheStatus'> & {
  key: string;
  revision: number;
};

type InFlightThumbnailRead = {
  revision: number;
  promise: Promise<CachedThumbnailFile | null>;
};

type ThumbnailMemoryCacheOptions = {
  maxEntries?: number;
  maxBytes?: number;
  maxFileBytes?: number;
};

type ThumbnailFileStats = {
  sizeBytes: number;
  mtimeMs: number;
};

const DEFAULT_MAX_ENTRIES = 768;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export class ThumbnailMemoryCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxFileBytes: number;
  private readonly entries = new Map<string, ThumbnailCacheEntry>();
  private readonly inFlightReads = new Map<string, InFlightThumbnailRead>();
  private readonly revisionByKey = new Map<string, number>();
  private totalBytes = 0;

  constructor(options: ThumbnailMemoryCacheOptions = {}) {
    this.maxEntries = normalizePositiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
    this.maxBytes = normalizePositiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
    this.maxFileBytes = normalizePositiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  }

  async read(filePath: string, contentType: string): Promise<CachedThumbnailFile | null> {
    const key = normalizeCacheKey(filePath);
    const stats = await statThumbnailFile(key);
    if (!stats) {
      this.invalidatePath(key);
      return null;
    }

    const revision = this.getRevision(key);
    const cachedEntry = this.entries.get(key);
    if (cachedEntry && cachedEntry.revision === revision && thumbnailStatsMatch(cachedEntry, stats)) {
      this.touchEntry(key, cachedEntry);
      return toCachedThumbnailFile(cachedEntry, 'hit');
    }

    if (cachedEntry) {
      this.deleteEntry(key);
    }

    const existingRead = this.inFlightReads.get(key);
    if (existingRead && existingRead.revision === revision) {
      return existingRead.promise;
    }

    const readPromise = this.readFromDisk(key, contentType, stats, revision);
    this.inFlightReads.set(key, {
      revision,
      promise: readPromise
    });

    try {
      return await readPromise;
    } finally {
      const currentRead = this.inFlightReads.get(key);
      if (currentRead?.promise === readPromise) {
        this.inFlightReads.delete(key);
      }
    }
  }

  invalidatePath(filePath: string): void {
    const key = normalizeCacheKey(filePath);
    this.deleteEntry(key);
    this.inFlightReads.delete(key);
    this.bumpRevision(key);
    this.pruneRevisionMap();
  }

  invalidatePathPrefix(rootPath: string): void {
    const normalizedRoot = normalizeCacheKey(rootPath);
    const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
    const candidateKeys = new Set<string>([
      ...this.entries.keys(),
      ...this.inFlightReads.keys(),
      ...this.revisionByKey.keys()
    ]);

    for (const key of candidateKeys) {
      if (key === normalizedRoot || key.startsWith(prefix)) {
        this.deleteEntry(key);
        this.inFlightReads.delete(key);
        this.bumpRevision(key);
      }
    }

    this.pruneRevisionMap();
  }

  private async readFromDisk(
    key: string,
    contentType: string,
    statsBeforeRead: ThumbnailFileStats,
    revision: number
  ): Promise<CachedThumbnailFile | null> {
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(key);
    } catch {
      this.invalidatePath(key);
      return null;
    }

    const statsAfterRead = await statThumbnailFile(key);
    const didFileChangeDuringRead = !statsAfterRead || !thumbnailStatsMatch(statsBeforeRead, statsAfterRead);
    const shouldCache =
      !didFileChangeDuringRead &&
      this.getRevision(key) === revision &&
      buffer.length <= this.maxFileBytes;

    const effectiveStats = statsAfterRead ?? statsBeforeRead;
    const thumbnailFile: CachedThumbnailFile = {
      buffer,
      contentType,
      etag: createThumbnailEtag(buffer),
      lastModified: new Date(effectiveStats.mtimeMs).toUTCString(),
      mtimeMs: effectiveStats.mtimeMs,
      sizeBytes: buffer.length,
      cacheStatus: shouldCache ? 'miss' : 'bypass'
    };

    if (shouldCache) {
      this.setEntry(key, {
        key,
        buffer,
        contentType,
        etag: thumbnailFile.etag,
        lastModified: thumbnailFile.lastModified,
        mtimeMs: effectiveStats.mtimeMs,
        revision,
        sizeBytes: buffer.length
      });
    } else {
      this.deleteEntry(key);
    }

    return thumbnailFile;
  }

  private setEntry(key: string, entry: ThumbnailCacheEntry): void {
    if (entry.sizeBytes > this.maxFileBytes) {
      this.deleteEntry(key);
      return;
    }

    this.deleteEntry(key);
    this.entries.set(key, entry);
    this.totalBytes += entry.sizeBytes;
    this.evictOverflow();
  }

  private touchEntry(key: string, entry: ThumbnailCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private deleteEntry(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }

    this.entries.delete(key);
    this.totalBytes = Math.max(0, this.totalBytes - entry.sizeBytes);
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }

      this.deleteEntry(oldestKey);
    }
  }

  private getRevision(key: string): number {
    return this.revisionByKey.get(key) ?? 0;
  }

  private bumpRevision(key: string): void {
    const nextRevision = this.getRevision(key) + 1;
    this.revisionByKey.delete(key);
    this.revisionByKey.set(key, nextRevision);
  }

  private pruneRevisionMap(): void {
    const softLimit = Math.max(this.maxEntries * 4, 64);
    const targetSize = Math.max(this.maxEntries * 2, 32);
    if (this.revisionByKey.size <= softLimit) {
      return;
    }

    for (const key of this.revisionByKey.keys()) {
      if (this.entries.has(key) || this.inFlightReads.has(key)) {
        continue;
      }

      this.revisionByKey.delete(key);
      if (this.revisionByKey.size <= targetSize) {
        break;
      }
    }
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeCacheKey(filePath: string): string {
  return path.resolve(filePath);
}

async function statThumbnailFile(filePath: string): Promise<ThumbnailFileStats | null> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }

    return {
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs
    };
  } catch {
    return null;
  }
}

function thumbnailStatsMatch(
  left: Pick<ThumbnailFileStats, 'sizeBytes' | 'mtimeMs'>,
  right: Pick<ThumbnailFileStats, 'sizeBytes' | 'mtimeMs'>
): boolean {
  return left.sizeBytes === right.sizeBytes && left.mtimeMs === right.mtimeMs;
}

function createThumbnailEtag(buffer: Buffer): string {
  return `"thumb-${createHash('sha256').update(buffer).digest('base64url')}"`;
}

function toCachedThumbnailFile(
  entry: ThumbnailCacheEntry,
  cacheStatus: ThumbnailCacheStatus
): CachedThumbnailFile {
  return {
    buffer: entry.buffer,
    contentType: entry.contentType,
    etag: entry.etag,
    lastModified: entry.lastModified,
    mtimeMs: entry.mtimeMs,
    sizeBytes: entry.sizeBytes,
    cacheStatus
  };
}
