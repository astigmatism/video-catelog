import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { AppConfig } from './config';

export const PHOTO_THUMBNAIL_MAX_EDGE = 640;
export const PHOTO_THUMBNAIL_MIME_TYPE = 'image/webp';
export const PHOTO_THUMBNAIL_EXTENSION = '.webp';

const PHOTO_THUMBNAIL_QUALITY = 82;

export type PhotoImageDimensions = {
  width: number | null;
  height: number | null;
};

export type PhotoThumbnailSourceInput =
  | { sourceBuffer: Buffer; sourcePath?: never }
  | { sourceBuffer?: never; sourcePath: string };

export type GeneratedPhotoThumbnail = {
  absolutePath: string;
  relativePath: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export class UnsupportedPhotoThumbnailSourceError extends Error {
  readonly sourceMessage: string | null;

  constructor(sourceError: unknown) {
    const sourceMessage = sourceError instanceof Error ? sourceError.message : null;
    super(
      sourceMessage
        ? `Photo thumbnail generation could not decode the image source: ${sourceMessage}`
        : 'Photo thumbnail generation could not decode the image source.'
    );
    this.name = 'UnsupportedPhotoThumbnailSourceError';
    this.sourceMessage = sourceMessage;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }

  return String(error ?? '');
}

function isSharpDecodeFailure(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('unsupported image format') ||
    message.includes('input buffer contains unsupported') ||
    message.includes('input file contains unsupported') ||
    message.includes('corrupt') ||
    message.includes('truncated') ||
    message.includes('premature end') ||
    message.includes('invalid image') ||
    message.includes('invalid data') ||
    message.includes('not enough data') ||
    message.includes('not a') ||
    message.includes('bad header')
  );
}

export function isUnsupportedPhotoThumbnailSourceError(
  error: unknown
): error is UnsupportedPhotoThumbnailSourceError {
  return error instanceof UnsupportedPhotoThumbnailSourceError;
}

function resolvePhotoThumbnailSource(input: PhotoThumbnailSourceInput): Buffer | string {
  if (input.sourceBuffer !== undefined) {
    return input.sourceBuffer;
  }

  if (input.sourcePath !== undefined) {
    return input.sourcePath;
  }

  throw new Error('Photo thumbnail generation requires a source buffer or source path.');
}

function normalizeDimension(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export async function readPhotoImageDimensions(input: PhotoThumbnailSourceInput): Promise<PhotoImageDimensions> {
  try {
    const metadata = await sharp(resolvePhotoThumbnailSource(input), { animated: false, failOn: 'none' }).metadata();
    return {
      width: normalizeDimension(metadata.width),
      height: normalizeDimension(metadata.height)
    };
  } catch (error) {
    if (isSharpDecodeFailure(error)) {
      throw new UnsupportedPhotoThumbnailSourceError(error);
    }

    throw error;
  }
}

function normalizeStoredNameForDerivative(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  const parsed = path.posix.parse(basename);
  const stem = parsed.name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);

  return stem === '' ? 'photo' : stem;
}

export function getPhotoOriginalCollectionStorageRoot(config: AppConfig, collectionId: string): string {
  return path.join(config.photoStoreRoot, 'originals', 'collections', collectionId);
}

export function getPhotoThumbnailCollectionStorageRoot(config: AppConfig, collectionId: string): string {
  return path.join(config.photoStoreRoot, 'derivatives', 'thumbnails', 'collections', collectionId);
}

export function getPhotoCollectionStorageRootsForCleanup(config: AppConfig, collectionId: string): string[] {
  return [
    getPhotoOriginalCollectionStorageRoot(config, collectionId),
    getPhotoThumbnailCollectionStorageRoot(config, collectionId),
    path.join(config.mediaStoreRoot, 'photos', collectionId)
  ];
}

export function createPhotoThumbnailStoredName(originalStoredName: string): string {
  return `${normalizeStoredNameForDerivative(originalStoredName)}-thumb${PHOTO_THUMBNAIL_EXTENSION}`;
}

export async function generatePhotoThumbnailFile(input: PhotoThumbnailSourceInput & {
  config: AppConfig;
  collectionId: string;
  thumbnailStoredName: string;
}): Promise<GeneratedPhotoThumbnail> {
  const thumbnailRoot = getPhotoThumbnailCollectionStorageRoot(input.config, input.collectionId);
  fs.mkdirSync(thumbnailRoot, { recursive: true });

  const absolutePath = path.join(thumbnailRoot, input.thumbnailStoredName);
  const temporaryPath = path.join(
    thumbnailRoot,
    `${input.thumbnailStoredName}.${process.pid}.${Date.now()}.tmp`
  );

  let data: Buffer;
  let info: sharp.OutputInfo;

  try {
    const thumbnail = await sharp(resolvePhotoThumbnailSource(input), { animated: false, failOn: 'none' })
      .rotate()
      .resize({
        width: PHOTO_THUMBNAIL_MAX_EDGE,
        height: PHOTO_THUMBNAIL_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: PHOTO_THUMBNAIL_QUALITY })
      .toBuffer({ resolveWithObject: true });
    data = thumbnail.data;
    info = thumbnail.info;
  } catch (error) {
    if (isSharpDecodeFailure(error)) {
      throw new UnsupportedPhotoThumbnailSourceError(error);
    }

    throw error;
  }

  try {
    fs.writeFileSync(temporaryPath, data, { flag: 'wx' });
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }

  return {
    absolutePath,
    relativePath: path.relative(input.config.mediaRoot, absolutePath),
    storedName: input.thumbnailStoredName,
    mimeType: PHOTO_THUMBNAIL_MIME_TYPE,
    sizeBytes: data.length,
    width: normalizeDimension(info.width),
    height: normalizeDimension(info.height)
  };
}
