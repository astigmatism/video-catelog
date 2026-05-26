import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config';
import {
  createPhotoThumbnailStoredName,
  generatePhotoThumbnailFile,
  readPhotoImageDimensions,
  getPhotoCollectionStorageRootsForCleanup,
  getPhotoOriginalCollectionStorageRoot,
  isUnsupportedPhotoThumbnailSourceError
} from './photo-derivatives';
import type { AddPhotoInput, PhotoCatalogStore } from './photo-store';
import type {
  CatalogTagListPayload,
  Photo,
  PhotoCollection,
  PhotoCollectionDetailPayload,
  PhotoCollectionListPayload,
  PhotoCollectionQueryInput,
  PhotoCollectionSort,
  PhotoHomeStripListPayload,
  PhotoHomeStripRowCount,
  PhotoHomeStripSortCategory,
  PhotoHomeStripSortDirection
} from './types';
import type { SessionStore } from './session-store';

const SUPPORTED_IMAGE_EXTENSIONS = new Map<string, string>([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.jpe', 'image/jpeg'],
  ['.jfif', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.apng', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp']
]);

const CANONICAL_IMAGE_EXTENSIONS = new Map<string, string>([
  ['.jpeg', '.jpg'],
  ['.jpe', '.jpg'],
  ['.jfif', '.jpg'],
  ['.apng', '.png']
]);

const SUPPORTED_IMAGE_MIME_TYPE_EXTENSIONS = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/apng', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/avif', '.avif'],
  ['image/bmp', '.bmp'],
  ['image/x-bmp', '.bmp'],
  ['image/x-ms-bmp', '.bmp'],
  ['image/ms-bmp', '.bmp']
]);

const CANONICAL_IMAGE_MIME_TYPES = new Map<string, string>([
  ['image/pjpeg', 'image/jpeg'],
  ['image/apng', 'image/png'],
  ['image/x-bmp', 'image/bmp'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['image/ms-bmp', 'image/bmp']
]);

const MAX_ZIP_ENTRIES = 5000;
const PHOTO_FILE_SEARCH_MAX_DEPTH = 8;
const PHOTO_FILE_SEARCH_MAX_ENTRIES = 25000;
const DEFAULT_PHOTO_COLLECTION_SORT: PhotoCollectionSort = 'newest';
const PHOTO_COLLECTION_NAME_MAX_LENGTH = 160;
const PHOTO_HOME_STRIP_NAME_MAX_LENGTH = 120;
const PHOTO_IMPORT_SKIPPED_FILE_RESPONSE_LIMIT = 25;
const PHOTO_IMPORT_SKIPPED_FILE_MESSAGE_LIMIT = 6;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_ID = 0x0001;
const ZIP64_PLACEHOLDER = 0xffffffff;
const ZIP_END_OF_CENTRAL_DIRECTORY_MIN_LENGTH = 22;
const ZIP_END_OF_CENTRAL_DIRECTORY_MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_LENGTH = 20;

const PHOTO_HOME_STRIP_SORT_CATEGORIES: PhotoHomeStripSortCategory[] = [
  'none',
  'createdAt',
  'name',
  'photoCount',
  'lastViewedAt',
  'viewCount',
  'random'
];

export type PhotoRoutesOptions = {
  config: AppConfig;
  photoStore: PhotoCatalogStore;
  sessionStore: SessionStore;
};

type MultipartFilePart = {
  type: 'file';
  fieldname: string;
  filename: string;
  mimetype?: string;
  file: Readable | NodeJS.ReadableStream;
};

type MultipartFieldPart = {
  type: 'field';
  fieldname: string;
  value: unknown;
};

type MultipartPart = MultipartFilePart | MultipartFieldPart;

type MultipartRequest = FastifyRequest & {
  parts(): AsyncIterableIterator<MultipartPart>;
};

type BufferedUploadFile = {
  fieldName: string;
  filename: string;
  mimetype: string | null;
  buffer: Buffer;
  sizeBytes: number;
};

type ParsedMultipartUpload = {
  fields: Map<string, string[]>;
  files: BufferedUploadFile[];
};

type TemporaryUploadedFile = {
  fieldName: string;
  filename: string;
  mimetype: string | null;
  path: string;
  sizeBytes: number;
};

type ParsedTemporaryMultipartUpload = {
  fields: Map<string, string[]>;
  files: TemporaryUploadedFile[];
  temporaryRoot: string;
};

type ZipImageFileEntry = {
  originalName: string;
  mimeType: string;
  extension: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type Zip64ExtendedInformation = {
  compressedSize: number | null;
  uncompressedSize: number | null;
  localHeaderOffset: number | null;
};

type PreparedImageFile = {
  originalName: string;
  buffer: Buffer;
  sizeBytes: number;
  mimeType: string;
  extension: string;
  width: number | null;
  height: number | null;
  checksumSha256: string;
};

type PhotoImportSkippedReason = 'unsupported_file_type' | 'unsupported_image_data';

type PhotoImportSkippedFile = {
  originalName: string;
  reason: PhotoImportSkippedReason;
  detail: string | null;
};

type PhotoImportReport = {
  importedCount: number;
  skippedCount: number;
  skippedFiles: PhotoImportSkippedFile[];
  skippedFilesTruncated: boolean;
  message: string | null;
};

type PhotoImportResultPayload = PhotoCollectionDetailPayload & {
  importReport: PhotoImportReport;
};

type ParsedPhotoHomeStripBody = {
  name: string;
  rowCount: PhotoHomeStripRowCount;
  sortCategory: PhotoHomeStripSortCategory;
  sortDirection: PhotoHomeStripSortDirection;
  search: string | null;
  tagIds: string[];
  excludedTagIds: string[];
};

type StoredPhotoFile = {
  input: AddPhotoInput;
  absolutePath: string;
  thumbnailAbsolutePath: string;
};

type ImageDimensions = {
  width: number | null;
  height: number | null;
};

type ZipEndOfCentralDirectory = {
  entryCount: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
};

class PhotoUploadError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = 'PhotoUploadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseCookieHeader(cookieHeader: string | string[] | undefined): Record<string, string> {
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

function getSessionId(request: FastifyRequest, config: AppConfig): string | undefined {
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

function getAuthenticatedSessionId(
  request: FastifyRequest,
  reply: FastifyReply,
  options: PhotoRoutesOptions
): string | null {
  const sessionId = getSessionId(request, options.config);
  if (!options.sessionStore.get(sessionId)) {
    reply.code(401).send({ authenticated: false });
    return null;
  }

  return sessionId ?? null;
}

function readBodyRecord(request: FastifyRequest): Record<string, unknown> {
  return isRecord(request.body) ? request.body : {};
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readRequiredBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readPositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function readQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return readQueryValue(value[0]);
  }

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readQueryStringList(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const result: string[] = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    for (const fragment of rawValue.split(',')) {
      const trimmed = fragment.trim();
      if (trimmed !== '') {
        result.push(trimmed);
      }
    }
  }

  return Array.from(new Set(result));
}

function isPhotoCollectionSort(value: string | null): value is PhotoCollectionSort {
  return (
    value === 'newest' ||
    value === 'oldest' ||
    value === 'name_asc' ||
    value === 'name_desc' ||
    value === 'photo_count_desc' ||
    value === 'photo_count_asc' ||
    value === 'last_viewed_desc' ||
    value === 'view_count_desc'
  );
}

function createPhotoCollectionQueryInput(request: FastifyRequest): PhotoCollectionQueryInput {
  const query = isRecord(request.query) ? request.query : {};
  const sortValue = readQueryValue(query.sort);

  return {
    search: readQueryValue(query.search),
    tagIds: readQueryStringList(query.tagIds ?? query.tags),
    excludedTagIds: readQueryStringList(query.excludedTagIds ?? query.excludedTags),
    sort: isPhotoCollectionSort(sortValue) ? sortValue : DEFAULT_PHOTO_COLLECTION_SORT
  };
}

function normalizePhotoHomeStripText(value: string | null | undefined, maxLength = Number.POSITIVE_INFINITY): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function isPhotoHomeStripRowCount(value: number): value is PhotoHomeStripRowCount {
  return value === 1 || value === 2 || value === 3;
}

function isPhotoHomeStripSortCategory(value: string): value is PhotoHomeStripSortCategory {
  return PHOTO_HOME_STRIP_SORT_CATEGORIES.includes(value as PhotoHomeStripSortCategory);
}

function readPhotoHomeStripTagIds(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const tagIds: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      return null;
    }

    const trimmedTagId = candidate.trim();
    if (trimmedTagId !== '' && !tagIds.includes(trimmedTagId)) {
      tagIds.push(trimmedTagId);
    }
  }

  return tagIds;
}

function parsePhotoHomeStripBody(body: unknown): ParsedPhotoHomeStripBody | null {
  if (!isRecord(body)) {
    return null;
  }

  const nameValue = typeof body.name === 'string' ? body.name : null;
  const rowCountValue = typeof body.rowCount === 'number' ? body.rowCount : Number(body.rowCount);
  const sortCategoryValue = typeof body.sortCategory === 'string' ? body.sortCategory : null;
  const sortDirectionValue = typeof body.sortDirection === 'string' ? body.sortDirection : null;
  const searchValue = body.search === undefined || body.search === null
    ? null
    : typeof body.search === 'string'
      ? body.search
      : undefined;
  const tagIds = readPhotoHomeStripTagIds(body.tagIds);
  const excludedTagIds = readPhotoHomeStripTagIds(body.excludedTagIds);

  if (
    nameValue === null ||
    !Number.isFinite(rowCountValue) ||
    !isPhotoHomeStripRowCount(rowCountValue) ||
    !sortCategoryValue ||
    !isPhotoHomeStripSortCategory(sortCategoryValue) ||
    (sortDirectionValue !== 'asc' && sortDirectionValue !== 'desc') ||
    searchValue === undefined ||
    tagIds === null ||
    excludedTagIds === null
  ) {
    return null;
  }

  const name = normalizePhotoHomeStripText(nameValue, PHOTO_HOME_STRIP_NAME_MAX_LENGTH);
  if (name === '') {
    return null;
  }

  const search = normalizePhotoHomeStripText(searchValue);

  return {
    name,
    rowCount: rowCountValue,
    sortCategory: sortCategoryValue,
    sortDirection: sortDirectionValue,
    search: search === '' ? null : search,
    tagIds,
    excludedTagIds
  };
}

function parsePhotoHomeStripIdParam(request: FastifyRequest): string | null {
  return getRequestParam(request, 'id');
}

function parsePhotoHomeStripReorderBody(body: unknown): { stripIds: string[] } | null {
  if (!isRecord(body)) {
    return null;
  }

  const stripIds = readPhotoHomeStripTagIds(body.stripIds);
  if (stripIds === null) {
    return null;
  }

  return { stripIds };
}

function createPhotoHomeStripListPayload(photoStore: PhotoCatalogStore): PhotoHomeStripListPayload {
  return { strips: photoStore.listHomeStrips() };
}

function queryPhotoCollections(
  collections: PhotoCollection[],
  input: PhotoCollectionQueryInput
): PhotoCollectionListPayload {
  const normalizedSearch = input.search ? input.search.trim().toLowerCase() : '';
  const selectedTagIds = new Set(input.tagIds.map((tagId) => tagId.trim()).filter(Boolean));
  const excludedTagIds = new Set(input.excludedTagIds.map((tagId) => tagId.trim()).filter(Boolean));

  const filtered = collections.filter((collection) => {
    const tagIds = new Set(collection.tags.map((tag) => tag.id));
    if (selectedTagIds.size > 0 && !Array.from(selectedTagIds).every((tagId) => tagIds.has(tagId))) {
      return false;
    }

    if (excludedTagIds.size > 0 && Array.from(excludedTagIds).some((tagId) => tagIds.has(tagId))) {
      return false;
    }

    if (normalizedSearch !== '') {
      const haystack = [collection.name, collection.description, ...collection.tags.map((tag) => tag.label)]
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
        .join(' ')
        .toLowerCase();

      if (!haystack.includes(normalizedSearch)) {
        return false;
      }
    }

    return true;
  });

  const sorted = [...filtered].sort((left, right) => {
    switch (input.sort) {
      case 'oldest':
        return left.createdAt.localeCompare(right.createdAt) || left.name.localeCompare(right.name);
      case 'name_asc':
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
          right.createdAt.localeCompare(left.createdAt);
      case 'name_desc':
        return right.name.localeCompare(left.name, undefined, { sensitivity: 'base' }) ||
          right.createdAt.localeCompare(left.createdAt);
      case 'photo_count_desc':
        return right.photoCount - left.photoCount || right.createdAt.localeCompare(left.createdAt);
      case 'photo_count_asc':
        return left.photoCount - right.photoCount || right.createdAt.localeCompare(left.createdAt);
      case 'last_viewed_desc':
        return (right.lastViewedAt ?? '').localeCompare(left.lastViewedAt ?? '') ||
          right.createdAt.localeCompare(left.createdAt);
      case 'view_count_desc':
        return right.viewCount - left.viewCount || right.createdAt.localeCompare(left.createdAt);
      case 'newest':
      default:
        return right.createdAt.localeCompare(left.createdAt) || left.name.localeCompare(right.name);
    }
  });

  return {
    collections: sorted,
    totalCount: sorted.length,
    filter: {
      search: input.search,
      tagIds: Array.from(selectedTagIds),
      excludedTagIds: Array.from(excludedTagIds),
      sort: input.sort
    }
  };
}

function getRequestParam(request: FastifyRequest, name: string): string | null {
  const params = isRecord(request.params) ? request.params : {};
  const value = params[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relativeToRoot = path.relative(resolvedRoot, resolvedCandidate);

  return relativeToRoot === '' || (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot));
}

function normalizeStoredPathForResolution(value: string): string {
  return value.trim().replace(/\\/g, '/').split('?')[0]?.split('#')[0] ?? '';
}

function normalizeStoredRelativePathSegments(relativePath: string): string[] {
  return normalizeStoredPathForResolution(relativePath)
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
}

function stripLeadingPathSegment(segments: string[], leadingSegment: string): string[] {
  return segments[0] === leadingSegment ? segments.slice(1) : segments;
}

function stripLeadingPathSegments(segments: string[], leadingSegments: string[]): string[] {
  if (leadingSegments.every((segment, index) => segments[index] === segment)) {
    return segments.slice(leadingSegments.length);
  }

  return segments;
}

function resolvePathSegmentsUnderRoot(rootPath: string, segments: string[]): string | null {
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return null;
  }

  const candidate = path.resolve(rootPath, ...segments);
  return isPathInsideRoot(rootPath, candidate) ? candidate : null;
}

function resolveStoredPathUnderRoot(rootPath: string, storedPath: string): string | null {
  const normalizedPath = normalizeStoredPathForResolution(storedPath);
  if (normalizedPath === '') {
    return null;
  }

  if (path.isAbsolute(normalizedPath)) {
    return isPathInsideRoot(rootPath, normalizedPath) ? path.resolve(normalizedPath) : null;
  }

  return resolvePathSegmentsUnderRoot(rootPath, normalizeStoredRelativePathSegments(normalizedPath));
}

function uniquePhotoPathCandidates(candidates: Array<string | null>): string[] {
  return Array.from(new Set(candidates.filter((candidate): candidate is string => candidate !== null)));
}

function getPhotoCollectionStorageRoot(config: AppConfig, collectionId: string): string {
  return getPhotoOriginalCollectionStorageRoot(config, collectionId);
}

function getLegacyPhotoCollectionStorageRoot(config: AppConfig, collectionId: string): string {
  return path.join(config.photoStoreRoot, collectionId);
}

function getStoredPhotoNameCandidates(photo: Photo): string[] {
  const normalizedStoredName = normalizeStoredPathForResolution(photo.storedName).replace(/^\/+/, '');
  const basename = path.posix.basename(normalizedStoredName);
  const candidates = [normalizedStoredName, basename].filter((candidate) => candidate !== '' && candidate !== '.' && candidate !== '..');

  return Array.from(new Set(candidates));
}

function getPhotoStoredBasenameCandidates(photo: Photo): string[] {
  return Array.from(
    new Set(
      getStoredPhotoNameCandidates(photo)
        .map((candidate) => path.posix.basename(candidate.replace(/\\/g, '/')))
        .filter((candidate) => candidate !== '' && candidate !== '.' && candidate !== '..')
    )
  );
}

function getPhotoSearchRootCandidates(config: AppConfig, photo: Photo): string[] {
  const relativePathSegments = normalizeStoredRelativePathSegments(photo.relativePath);
  const relativeDirectorySegments = relativePathSegments.slice(0, -1);
  const mediaStoreSegment = path.basename(config.mediaStoreRoot);
  const photoStoreSegment = path.basename(config.photoStoreRoot);
  const mediaStoreRelativeDirectorySegments = stripLeadingPathSegment(relativeDirectorySegments, mediaStoreSegment);
  const photoStoreRelativeDirectorySegments = stripLeadingPathSegment(relativeDirectorySegments, photoStoreSegment);
  const photoRelativeDirectorySegments = stripLeadingPathSegment(relativeDirectorySegments, 'photos');

  return uniquePhotoPathCandidates([
    resolvePathSegmentsUnderRoot(config.mediaRoot, relativeDirectorySegments),
    resolvePathSegmentsUnderRoot(config.mediaStoreRoot, mediaStoreRelativeDirectorySegments),
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoStoreRelativeDirectorySegments),
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoRelativeDirectorySegments),
    getPhotoOriginalCollectionStorageRoot(config, photo.collectionId),
    path.resolve(config.mediaStoreRoot, 'photos', photo.collectionId),
    path.resolve(config.photoStoreRoot, photo.collectionId),
    path.resolve(config.mediaRoot, 'media', 'photos', photo.collectionId),
    path.resolve(config.mediaRoot, 'photos', photo.collectionId),
    path.resolve(config.mediaStoreRoot),
    path.resolve(config.photoStoreRoot),
    path.resolve(config.mediaRoot)
  ]).filter((candidate) => isPathInsideRoot(config.mediaRoot, candidate));
}

function findPhotoFileInDirectory(
  config: AppConfig,
  rootPath: string,
  expectedBasenames: Set<string>,
  maxDepth: number,
  visitedEntryCount: { value: number }
): string | null {
  const normalizedRoot = path.resolve(rootPath);
  if (!isPathInsideRoot(config.mediaRoot, normalizedRoot)) {
    return null;
  }

  const stack: Array<{ directoryPath: string; depth: number }> = [{ directoryPath: normalizedRoot, depth: 0 }];

  while (stack.length > 0 && visitedEntryCount.value < PHOTO_FILE_SEARCH_MAX_ENTRIES) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visitedEntryCount.value += 1;
      if (visitedEntryCount.value > PHOTO_FILE_SEARCH_MAX_ENTRIES) {
        return null;
      }

      const candidatePath = path.join(current.directoryPath, entry.name);
      if (!isPathInsideRoot(config.mediaRoot, candidatePath)) {
        continue;
      }

      if (entry.isFile() && expectedBasenames.has(entry.name)) {
        return candidatePath;
      }

      if (entry.isDirectory() && current.depth < maxDepth) {
        stack.push({ directoryPath: candidatePath, depth: current.depth + 1 });
      }
    }
  }

  return null;
}

function findPhotoFileByStoredName(config: AppConfig, photo: Photo): string | null {
  const expectedBasenames = new Set(getPhotoStoredBasenameCandidates(photo));
  if (expectedBasenames.size === 0) {
    return null;
  }

  const visitedEntryCount = { value: 0 };
  for (const searchRoot of getPhotoSearchRootCandidates(config, photo)) {
    const match = findPhotoFileInDirectory(
      config,
      searchRoot,
      expectedBasenames,
      PHOTO_FILE_SEARCH_MAX_DEPTH,
      visitedEntryCount
    );
    if (match) {
      return match;
    }
  }

  return null;
}

function resolvePhotoFileCandidates(config: AppConfig, photo: Photo): string[] {
  const relativePathSegments = normalizeStoredRelativePathSegments(photo.relativePath);
  const mediaStoreSegment = path.basename(config.mediaStoreRoot);
  const photoStoreSegment = path.basename(config.photoStoreRoot);
  const mediaStoreRelativeSegments = stripLeadingPathSegment(relativePathSegments, mediaStoreSegment);
  const mediaStorePhotoRelativeSegments = stripLeadingPathSegments(relativePathSegments, [mediaStoreSegment, 'photos']);
  const photoStoreRelativeSegments = stripLeadingPathSegment(relativePathSegments, photoStoreSegment);
  const photoStoreCollectionRelativeSegments = stripLeadingPathSegment(
    stripLeadingPathSegment(relativePathSegments, photoStoreSegment),
    photo.collectionId
  );
  const photoRelativeSegments = stripLeadingPathSegment(relativePathSegments, 'photos');
  const storedNameCandidates = getStoredPhotoNameCandidates(photo);
  const candidates: Array<string | null> = [
    // Stored photo paths are resolved relative to the application media root.
    resolveStoredPathUnderRoot(config.mediaRoot, photo.relativePath),
    resolvePathSegmentsUnderRoot(config.mediaRoot, relativePathSegments),

    // Historical managed-media photo layout kept for existing imported photos.
    resolvePathSegmentsUnderRoot(config.mediaStoreRoot, mediaStoreRelativeSegments),
    resolvePathSegmentsUnderRoot(config.mediaStoreRoot, mediaStorePhotoRelativeSegments),
    resolvePathSegmentsUnderRoot(config.mediaStoreRoot, ['photos', photo.collectionId, ...storedNameCandidates.slice(0, 1)]),

    // Legacy photo-store layout from earlier photo imports.
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoStoreRelativeSegments),
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoStoreCollectionRelativeSegments),
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoRelativeSegments)
  ];

  for (const storedName of storedNameCandidates) {
    candidates.push(
      // Historical flat managed-media photo fallbacks.
      resolvePathSegmentsUnderRoot(config.mediaStoreRoot, [storedName]),
      resolvePathSegmentsUnderRoot(config.mediaStoreRoot, ['photos', storedName]),
      resolvePathSegmentsUnderRoot(config.mediaStoreRoot, ['photos', photo.collectionId, storedName]),
      resolvePathSegmentsUnderRoot(config.photoStoreRoot, [storedName]),
      resolvePathSegmentsUnderRoot(config.photoStoreRoot, [photo.collectionId, storedName]),
      resolvePathSegmentsUnderRoot(config.mediaRoot, ['media', storedName]),
      resolvePathSegmentsUnderRoot(config.mediaRoot, ['media', 'photos', photo.collectionId, storedName]),
      resolvePathSegmentsUnderRoot(config.mediaRoot, ['photos', photo.collectionId, storedName])
    );
  }

  return uniquePhotoPathCandidates(candidates).filter((candidate) => isPathInsideRoot(config.mediaRoot, candidate));
}

function getPhotoFileAbsolutePath(config: AppConfig, photo: Photo): string | null {
  for (const candidate of resolvePhotoFileCandidates(config, photo)) {
    try {
      const stats = fs.statSync(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next candidate. Older imports may have used a different media base or layout.
    }
  }

  return findPhotoFileByStoredName(config, photo);
}

function resolvePhotoThumbnailFileCandidates(config: AppConfig, photo: Photo): string[] {
  if (!photo.thumbnailRelativePath) {
    return [];
  }

  const thumbnailPathSegments = normalizeStoredRelativePathSegments(photo.thumbnailRelativePath);
  const photoStoreSegment = path.basename(config.photoStoreRoot);
  const photoStoreRelativeSegments = stripLeadingPathSegment(thumbnailPathSegments, photoStoreSegment);
  const photoRelativeSegments = stripLeadingPathSegment(thumbnailPathSegments, 'photos');
  const thumbnailBasename = path.posix.basename(normalizeStoredPathForResolution(photo.thumbnailRelativePath));

  const candidates: Array<string | null> = [
    resolveStoredPathUnderRoot(config.mediaRoot, photo.thumbnailRelativePath),
    resolvePathSegmentsUnderRoot(config.mediaRoot, thumbnailPathSegments),
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoStoreRelativeSegments),
    resolvePathSegmentsUnderRoot(config.photoStoreRoot, photoRelativeSegments)
  ];

  if (thumbnailBasename && thumbnailBasename !== '.' && thumbnailBasename !== '..') {
    candidates.push(
      resolvePathSegmentsUnderRoot(config.photoStoreRoot, [
        'derivatives',
        'thumbnails',
        'collections',
        photo.collectionId,
        thumbnailBasename
      ])
    );
  }

  return uniquePhotoPathCandidates(candidates).filter((candidate) => isPathInsideRoot(config.mediaRoot, candidate));
}

function getPhotoThumbnailFileAbsolutePath(config: AppConfig, photo: Photo): string | null {
  for (const candidate of resolvePhotoThumbnailFileCandidates(config, photo)) {
    try {
      const stats = fs.statSync(candidate);
      if (stats.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next photo-thumbnail-specific candidate.
    }
  }

  return null;
}

async function ensurePhotoThumbnailFile(
  request: FastifyRequest,
  config: AppConfig,
  photoStore: PhotoCatalogStore,
  photo: Photo
): Promise<{ absolutePath: string; mimeType: string } | null> {
  const existingThumbnailPath = getPhotoThumbnailFileAbsolutePath(config, photo);
  if (existingThumbnailPath) {
    return {
      absolutePath: existingThumbnailPath,
      mimeType: photo.thumbnailMimeType || getMimeTypeFromExtension(existingThumbnailPath) || 'image/webp'
    };
  }

  const originalAbsolutePath = getPhotoFileAbsolutePath(config, photo);
  if (!originalAbsolutePath) {
    return null;
  }

  try {
    const generatedThumbnail = await generatePhotoThumbnailFile({
      config,
      collectionId: photo.collectionId,
      sourcePath: originalAbsolutePath,
      thumbnailStoredName: createPhotoThumbnailStoredName(photo.storedName)
    });

    await photoStore.updatePhotoThumbnail(photo.id, {
      thumbnailRelativePath: generatedThumbnail.relativePath,
      thumbnailMimeType: generatedThumbnail.mimeType,
      thumbnailSizeBytes: generatedThumbnail.sizeBytes,
      thumbnailWidth: generatedThumbnail.width,
      thumbnailHeight: generatedThumbnail.height
    });

    return { absolutePath: generatedThumbnail.absolutePath, mimeType: generatedThumbnail.mimeType };
  } catch (error) {
    request.log.warn(
      {
        err: error,
        event: 'photo.thumbnail.generate_failed',
        photoId: photo.id,
        collectionId: photo.collectionId,
        originalAbsolutePath
      },
      'Photo thumbnail generation failed.'
    );
    return null;
  }
}

function sendPhotoFileResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
  contentType: string
): void {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      sendNotFound(reply, 'Photo file is not available.');
      return;
    }
  } catch {
    sendNotFound(reply, 'Photo file is not available.');
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    request.log.error({ err: error, filePath }, 'Failed to stream photo media file.');
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500;
      reply.raw.end();
    } else {
      reply.raw.destroy(error);
    }
  });

  reply.hijack();
  reply.raw.writeHead(200, {
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': String(stats.size),
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff'
  });
  stream.pipe(reply.raw);
}

function sendNotFound(reply: FastifyReply, message = 'Not found.'): void {
  reply.code(404).send({ message });
}

function normalizePathBasename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  return path.posix.basename(normalized) || 'photo';
}

function canonicalizeImageExtension(extension: string): string {
  return CANONICAL_IMAGE_EXTENSIONS.get(extension) ?? extension;
}

function normalizeSupportedImageMimeType(mimeType: string | null | undefined): string | null {
  const normalizedMimeType = mimeType?.split(';')[0]?.trim().toLowerCase() ?? null;
  if (!normalizedMimeType || !SUPPORTED_IMAGE_MIME_TYPE_EXTENSIONS.has(normalizedMimeType)) {
    return null;
  }

  return CANONICAL_IMAGE_MIME_TYPES.get(normalizedMimeType) ?? normalizedMimeType;
}

function getMimeTypeFromExtension(filename: string): string | null {
  return SUPPORTED_IMAGE_EXTENSIONS.get(path.extname(filename).toLowerCase()) ?? null;
}

function getImageExtension(filename: string, mimeType: string | null): string | null {
  const extension = path.extname(filename).toLowerCase();
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return canonicalizeImageExtension(extension);
  }

  const normalizedMimeType = normalizeSupportedImageMimeType(mimeType);
  if (normalizedMimeType) {
    return SUPPORTED_IMAGE_MIME_TYPE_EXTENSIONS.get(normalizedMimeType) ?? null;
  }

  return null;
}

function normalizeImageMimeType(filename: string, declaredMimeType: string | null | undefined): string | null {
  return normalizeSupportedImageMimeType(declaredMimeType) ?? getMimeTypeFromExtension(filename);
}

function normalizeImportDetail(value: string | null | undefined): string | null {
  const normalized = (value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized === '' ? null : normalized.slice(0, 220);
}

function addSkippedPhotoImportFile(
  skippedFiles: PhotoImportSkippedFile[],
  originalName: string,
  reason: PhotoImportSkippedReason,
  detail?: string | null
): void {
  skippedFiles.push({
    originalName: sanitizeVisibleFilename(originalName),
    reason,
    detail: normalizeImportDetail(detail)
  });
}

function getUnsupportedPhotoDetail(error: unknown): string | null {
  if (isUnsupportedPhotoThumbnailSourceError(error)) {
    return normalizeImportDetail(error.sourceMessage);
  }

  return error instanceof Error ? normalizeImportDetail(error.message) : null;
}

function getSkippedReasonLabel(reason: PhotoImportSkippedReason): string {
  switch (reason) {
    case 'unsupported_file_type':
      return 'unsupported file type';
    case 'unsupported_image_data':
      return 'unsupported or unreadable image data';
  }
}

function formatSkippedPhotoImportFile(skippedFile: PhotoImportSkippedFile): string {
  const reason = getSkippedReasonLabel(skippedFile.reason);
  return skippedFile.detail
    ? `${skippedFile.originalName} (${reason}: ${skippedFile.detail})`
    : `${skippedFile.originalName} (${reason})`;
}

function formatSkippedPhotoImportSummary(skippedFiles: PhotoImportSkippedFile[]): string {
  if (skippedFiles.length === 0) {
    return '';
  }

  const shownFiles = skippedFiles.slice(0, PHOTO_IMPORT_SKIPPED_FILE_MESSAGE_LIMIT);
  const shownSummary = shownFiles.map(formatSkippedPhotoImportFile).join('; ');
  const remainingCount = skippedFiles.length - shownFiles.length;
  const remainingSummary = remainingCount > 0 ? `; and ${remainingCount} more` : '';

  return `Skipped ${skippedFiles.length} unsupported file${skippedFiles.length === 1 ? '' : 's'}: ${shownSummary}${remainingSummary}.`;
}

function createNoImportablePhotosMessage(sourceLabel: string, skippedFiles: PhotoImportSkippedFile[]): string {
  const skippedSummary = formatSkippedPhotoImportSummary(skippedFiles);
  return skippedSummary
    ? `The ${sourceLabel} did not contain any importable photo files. ${skippedSummary}`
    : `The ${sourceLabel} did not contain any importable photo files.`;
}

function createPhotoImportReport(importedCount: number, skippedFiles: PhotoImportSkippedFile[]): PhotoImportReport {
  const skippedSummary = formatSkippedPhotoImportSummary(skippedFiles);
  return {
    importedCount,
    skippedCount: skippedFiles.length,
    skippedFiles: skippedFiles.slice(0, PHOTO_IMPORT_SKIPPED_FILE_RESPONSE_LIMIT),
    skippedFilesTruncated: skippedFiles.length > PHOTO_IMPORT_SKIPPED_FILE_RESPONSE_LIMIT,
    message: skippedSummary === '' ? null : `Imported ${importedCount} photo${importedCount === 1 ? '' : 's'}. ${skippedSummary}`
  };
}

function sanitizeVisibleFilename(filename: string): string {
  const basename = normalizePathBasename(filename);
  const normalized = basename
    .normalize('NFKC')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized === '' ? 'photo' : normalized.slice(0, 220);
}

function deriveCollectionNameFromFilename(filename: string, fallback: string): string {
  const basename = normalizePathBasename(filename);
  const parsed = path.parse(basename).name;
  const normalized = parsed
    .normalize('NFKC')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized === '' ? fallback : normalized.slice(0, PHOTO_COLLECTION_NAME_MAX_LENGTH);
}

function sanitizeCollectionName(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PHOTO_COLLECTION_NAME_MAX_LENGTH);

  return normalized === '' ? fallback : normalized;
}

async function bufferReadableStream(stream: Readable | NodeJS.ReadableStream, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new PhotoUploadError('Upload exceeds the configured maximum size.', 413);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

async function readMultipartUpload(request: FastifyRequest, maxBytes: number): Promise<ParsedMultipartUpload> {
  if (typeof (request as MultipartRequest).parts !== 'function') {
    throw new PhotoUploadError('Expected a multipart/form-data request.');
  }

  const fields = new Map<string, string[]>();
  const files: BufferedUploadFile[] = [];
  let totalBytes = 0;

  for await (const part of (request as MultipartRequest).parts()) {
    if (part.type === 'field') {
      const value = typeof part.value === 'string' ? part.value : String(part.value ?? '');
      fields.set(part.fieldname, [...(fields.get(part.fieldname) ?? []), value]);
      continue;
    }

    const buffer = await bufferReadableStream(part.file, maxBytes - totalBytes);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new PhotoUploadError('Upload exceeds the configured maximum size.', 413);
    }

    files.push({
      fieldName: part.fieldname,
      filename: sanitizeVisibleFilename(part.filename || 'photo'),
      mimetype: typeof part.mimetype === 'string' ? part.mimetype : null,
      buffer,
      sizeBytes: buffer.length
    });
  }

  return { fields, files };
}

function getMultipartField(fields: Map<string, string[]>, ...names: string[]): string | null {
  for (const name of names) {
    const values = fields.get(name) ?? [];
    const value = values.find((candidate) => candidate.trim() !== '');
    if (value !== undefined) {
      return value;
    }
  }

  return null;
}

function cleanupTemporaryDirectory(directoryPath: string | null | undefined): void {
  if (!directoryPath) {
    return;
  }

  try {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup only.
  }
}

function createPhotoImportTemporaryDirectory(config: AppConfig, prefix: string): string {
  fs.mkdirSync(config.photoTempRoot, { recursive: true });
  return fs.mkdtempSync(path.join(config.photoTempRoot, `${prefix}-`));
}

function createByteCountingTransform(input: {
  maxBytes: number;
  errorMessage: string;
  statusCode?: number;
  hash?: ReturnType<typeof createHash>;
}): { stream: Transform; getTotalBytes: () => number } {
  let totalBytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > input.maxBytes) {
        callback(new PhotoUploadError(input.errorMessage, input.statusCode ?? 400));
        return;
      }

      input.hash?.update(buffer);
      callback(null, buffer);
    }
  });

  return {
    stream,
    getTotalBytes: () => totalBytes
  };
}

async function writeReadableStreamToTemporaryFile(
  stream: Readable | NodeJS.ReadableStream,
  filePath: string,
  maxBytes: number
): Promise<number> {
  if (maxBytes <= 0) {
    throw new PhotoUploadError('Upload exceeds the configured maximum size.', 413);
  }

  const counter = createByteCountingTransform({
    maxBytes,
    errorMessage: 'Upload exceeds the configured maximum size.',
    statusCode: 413
  });

  try {
    await pipeline(
      stream as NodeJS.ReadableStream,
      counter.stream,
      fs.createWriteStream(filePath, { flags: 'wx' })
    );
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }

  return counter.getTotalBytes();
}

async function readMultipartUploadToTemporaryFiles(
  request: FastifyRequest,
  config: AppConfig,
  maxBytes: number
): Promise<ParsedTemporaryMultipartUpload> {
  if (typeof (request as MultipartRequest).parts !== 'function') {
    throw new PhotoUploadError('Expected a multipart/form-data request.');
  }

  const temporaryRoot = createPhotoImportTemporaryDirectory(config, 'zip-import');
  const fields = new Map<string, string[]>();
  const files: TemporaryUploadedFile[] = [];
  let totalBytes = 0;

  try {
    for await (const part of (request as MultipartRequest).parts()) {
      if (part.type === 'field') {
        const value = typeof part.value === 'string' ? part.value : String(part.value ?? '');
        fields.set(part.fieldname, [...(fields.get(part.fieldname) ?? []), value]);
        continue;
      }

      const temporaryPath = path.join(temporaryRoot, `${files.length}-${randomUUID()}.upload`);
      const sizeBytes = await writeReadableStreamToTemporaryFile(part.file, temporaryPath, maxBytes - totalBytes);
      totalBytes += sizeBytes;
      if (totalBytes > maxBytes) {
        throw new PhotoUploadError('Upload exceeds the configured maximum size.', 413);
      }

      files.push({
        fieldName: part.fieldname,
        filename: sanitizeVisibleFilename(part.filename || 'photo'),
        mimetype: typeof part.mimetype === 'string' ? part.mimetype : null,
        path: temporaryPath,
        sizeBytes
      });
    }

    return { fields, files, temporaryRoot };
  } catch (error) {
    cleanupTemporaryDirectory(temporaryRoot);
    throw error;
  }
}

function readUInt64LEAsSafeNumber(buffer: Buffer, offset: number, context: string): number {
  if (offset + 8 > buffer.length) {
    throw new PhotoUploadError(`${context} is truncated.`);
  }

  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PhotoUploadError(`${context} is too large to process safely.`);
  }

  return Number(value);
}

function readFileRange(fd: number, filePath: string, offset: number, length: number): Buffer {
  if (offset < 0 || length < 0) {
    throw new PhotoUploadError('The uploaded ZIP file has an invalid file range.');
  }

  if (length === 0) {
    return Buffer.alloc(0);
  }

  const buffer = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
  if (bytesRead !== length) {
    throw new PhotoUploadError(`The uploaded ZIP file is truncated near ${path.basename(filePath)}.`);
  }

  return buffer;
}

function assertZipFileRange(fileSize: number, offset: number, length: number, message: string): void {
  if (offset < 0 || length < 0 || offset > fileSize || offset + length > fileSize) {
    throw new PhotoUploadError(message);
  }
}

function readZip64EndOfCentralDirectory(
  fd: number,
  filePath: string,
  fileSize: number,
  eocdOffset: number
): ZipEndOfCentralDirectory {
  const locatorOffset = eocdOffset - ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_LENGTH;
  if (locatorOffset < 0) {
    throw new PhotoUploadError('The uploaded ZIP file is missing its ZIP64 end-of-central-directory locator.');
  }

  const locator = readFileRange(fd, filePath, locatorOffset, ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_LENGTH);
  if (locator.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
    throw new PhotoUploadError('The uploaded ZIP file is missing its ZIP64 end-of-central-directory locator.');
  }

  const zip64EocdDisk = locator.readUInt32LE(4);
  const zip64EocdOffset = readUInt64LEAsSafeNumber(locator, 8, 'The ZIP64 end-of-central-directory offset');
  const totalDisks = locator.readUInt32LE(16);
  if (zip64EocdDisk !== 0 || totalDisks !== 1) {
    throw new PhotoUploadError('Multi-disk ZIP archives are not supported.');
  }

  assertZipFileRange(
    fileSize,
    zip64EocdOffset,
    56,
    'The uploaded ZIP file has a truncated ZIP64 end-of-central-directory record.'
  );
  const record = readFileRange(fd, filePath, zip64EocdOffset, 56);
  if (record.readUInt32LE(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new PhotoUploadError('The uploaded ZIP file has an invalid ZIP64 end-of-central-directory record.');
  }

  const diskNumber = record.readUInt32LE(16);
  const centralDirectoryDisk = record.readUInt32LE(20);
  const entriesOnDisk = readUInt64LEAsSafeNumber(record, 24, 'The ZIP64 entries-on-disk value');
  const entryCount = readUInt64LEAsSafeNumber(record, 32, 'The ZIP64 entry count');
  const centralDirectorySize = readUInt64LEAsSafeNumber(record, 40, 'The ZIP64 central-directory size');
  const centralDirectoryOffset = readUInt64LEAsSafeNumber(record, 48, 'The ZIP64 central-directory offset');

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new PhotoUploadError('Multi-disk ZIP archives are not supported.');
  }

  if (entryCount > MAX_ZIP_ENTRIES) {
    throw new PhotoUploadError(`ZIP archives may contain at most ${MAX_ZIP_ENTRIES} entries.`);
  }

  assertZipFileRange(
    fileSize,
    centralDirectoryOffset,
    centralDirectorySize,
    'The uploaded ZIP file has an invalid central directory.'
  );

  return { entryCount, centralDirectorySize, centralDirectoryOffset };
}

function findZipEndOfCentralDirectoryInFile(zipFilePath: string): ZipEndOfCentralDirectory {
  const stats = fs.statSync(zipFilePath);
  if (!stats.isFile() || stats.size < ZIP_END_OF_CENTRAL_DIRECTORY_MIN_LENGTH) {
    throw new PhotoUploadError('The uploaded ZIP file is too small to be a valid ZIP archive.');
  }

  const fd = fs.openSync(zipFilePath, 'r');
  try {
    const fileSize = stats.size;
    const tailLength = Math.min(
      fileSize,
      ZIP_END_OF_CENTRAL_DIRECTORY_MIN_LENGTH + ZIP_END_OF_CENTRAL_DIRECTORY_MAX_COMMENT_LENGTH
    );
    const tailOffset = fileSize - tailLength;
    const tail = readFileRange(fd, zipFilePath, tailOffset, tailLength);

    for (let offset = tailLength - ZIP_END_OF_CENTRAL_DIRECTORY_MIN_LENGTH; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        continue;
      }

      const eocdOffset = tailOffset + offset;
      const commentLength = tail.readUInt16LE(offset + 20);
      if (eocdOffset + ZIP_END_OF_CENTRAL_DIRECTORY_MIN_LENGTH + commentLength !== fileSize) {
        continue;
      }

      const diskNumber = tail.readUInt16LE(offset + 4);
      const centralDirectoryDisk = tail.readUInt16LE(offset + 6);
      const entriesOnDisk = tail.readUInt16LE(offset + 8);
      const entryCount = tail.readUInt16LE(offset + 10);
      const centralDirectorySize = tail.readUInt32LE(offset + 12);
      const centralDirectoryOffset = tail.readUInt32LE(offset + 16);

      if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
        throw new PhotoUploadError('Multi-disk ZIP archives are not supported.');
      }

      if (
        centralDirectoryOffset === ZIP64_PLACEHOLDER ||
        centralDirectorySize === ZIP64_PLACEHOLDER ||
        entryCount === 0xffff
      ) {
        return readZip64EndOfCentralDirectory(fd, zipFilePath, fileSize, eocdOffset);
      }

      if (entryCount > MAX_ZIP_ENTRIES) {
        throw new PhotoUploadError(`ZIP archives may contain at most ${MAX_ZIP_ENTRIES} entries.`);
      }

      assertZipFileRange(
        fileSize,
        centralDirectoryOffset,
        centralDirectorySize,
        'The uploaded ZIP file has an invalid central directory.'
      );

      return { entryCount, centralDirectorySize, centralDirectoryOffset };
    }
  } finally {
    fs.closeSync(fd);
  }

  throw new PhotoUploadError('The uploaded ZIP file is malformed or unsupported.');
}

function parseZip64ExtendedInformation(
  extraField: Buffer,
  needed: { compressedSize: boolean; uncompressedSize: boolean; localHeaderOffset: boolean }
): Zip64ExtendedInformation {
  let cursor = 0;

  while (cursor + 4 <= extraField.length) {
    const headerId = extraField.readUInt16LE(cursor);
    const dataSize = extraField.readUInt16LE(cursor + 2);
    const dataStart = cursor + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > extraField.length) {
      throw new PhotoUploadError('The uploaded ZIP file has a truncated ZIP64 extra field.');
    }

    if (headerId !== ZIP64_EXTENDED_INFORMATION_EXTRA_FIELD_ID) {
      cursor = dataEnd;
      continue;
    }

    let dataCursor = dataStart;
    const result: Zip64ExtendedInformation = {
      compressedSize: null,
      uncompressedSize: null,
      localHeaderOffset: null
    };
    const readZip64Value = (context: string): number => {
      if (dataCursor + 8 > dataEnd) {
        throw new PhotoUploadError('The uploaded ZIP file has a truncated ZIP64 extra field.');
      }

      const value = readUInt64LEAsSafeNumber(extraField, dataCursor, context);
      dataCursor += 8;
      return value;
    };

    if (needed.uncompressedSize) {
      result.uncompressedSize = readZip64Value('The ZIP64 uncompressed size');
    }

    if (needed.compressedSize) {
      result.compressedSize = readZip64Value('The ZIP64 compressed size');
    }

    if (needed.localHeaderOffset) {
      result.localHeaderOffset = readZip64Value('The ZIP64 local-header offset');
    }

    return result;
  }

  return {
    compressedSize: null,
    uncompressedSize: null,
    localHeaderOffset: null
  };
}

function readZipImageEntriesFromFile(
  zipFilePath: string,
  skippedFiles: PhotoImportSkippedFile[]
): ZipImageFileEntry[] {
  const eocd = findZipEndOfCentralDirectoryInFile(zipFilePath);
  const stats = fs.statSync(zipFilePath);
  const fileSize = stats.size;
  const entries: ZipImageFileEntry[] = [];
  const fd = fs.openSync(zipFilePath, 'r');

  try {
    let cursor = eocd.centralDirectoryOffset;
    const centralDirectoryEnd = eocd.centralDirectoryOffset + eocd.centralDirectorySize;

    for (let entryIndex = 0; entryIndex < eocd.entryCount; entryIndex += 1) {
      if (cursor + 46 > centralDirectoryEnd) {
        throw new PhotoUploadError('The uploaded ZIP file has an invalid central directory entry.');
      }

      assertZipFileRange(
        fileSize,
        cursor,
        46,
        'The uploaded ZIP file has an invalid central directory entry.'
      );
      const header = readFileRange(fd, zipFilePath, cursor, 46);
      if (header.readUInt32LE(0) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
        throw new PhotoUploadError('The uploaded ZIP file has an invalid central directory entry.');
      }

      const generalPurposeFlags = header.readUInt16LE(8);
      const compressionMethod = header.readUInt16LE(10);
      const compressedSize32 = header.readUInt32LE(20);
      const uncompressedSize32 = header.readUInt32LE(24);
      const fileNameLength = header.readUInt16LE(28);
      const extraFieldLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const localHeaderOffset32 = header.readUInt32LE(42);
      const fileNameStart = cursor + 46;
      const extraFieldStart = fileNameStart + fileNameLength;
      const commentStart = extraFieldStart + extraFieldLength;
      const nextCursor = commentStart + commentLength;
      if (nextCursor > centralDirectoryEnd) {
        throw new PhotoUploadError('The uploaded ZIP file has a truncated central directory entry.');
      }

      assertZipFileRange(fileSize, fileNameStart, fileNameLength, 'The uploaded ZIP file has a truncated entry name.');
      assertZipFileRange(fileSize, extraFieldStart, extraFieldLength, 'The uploaded ZIP file has a truncated extra field.');
      assertZipFileRange(fileSize, commentStart, commentLength, 'The uploaded ZIP file has a truncated entry comment.');

      const entryName = decodeZipEntryName(
        readFileRange(fd, zipFilePath, fileNameStart, fileNameLength),
        (generalPurposeFlags & 0x0800) !== 0
      );
      const extraField = readFileRange(fd, zipFilePath, extraFieldStart, extraFieldLength);
      cursor = nextCursor;

      if (entryName.endsWith('/') || entryName.endsWith('\\') || isIgnorableZipMetadataEntry(entryName)) {
        continue;
      }

      const originalName = sanitizeVisibleFilename(entryName);
      const declaredMimeType = normalizeImageMimeType(originalName, null);
      const extension = getImageExtension(originalName, declaredMimeType);
      if (!declaredMimeType || !extension) {
        addSkippedPhotoImportFile(skippedFiles, originalName, 'unsupported_file_type');
        continue;
      }

      if ((generalPurposeFlags & 0x0001) !== 0) {
        throw new PhotoUploadError('Encrypted ZIP archives are not supported.');
      }

      if (compressionMethod !== 0 && compressionMethod !== 8) {
        throw new PhotoUploadError('Only stored and deflated ZIP entries are supported.');
      }

      const needsZip64 = {
        compressedSize: compressedSize32 === ZIP64_PLACEHOLDER,
        uncompressedSize: uncompressedSize32 === ZIP64_PLACEHOLDER,
        localHeaderOffset: localHeaderOffset32 === ZIP64_PLACEHOLDER
      };
      const zip64 = needsZip64.compressedSize || needsZip64.uncompressedSize || needsZip64.localHeaderOffset
        ? parseZip64ExtendedInformation(extraField, needsZip64)
        : { compressedSize: null, uncompressedSize: null, localHeaderOffset: null };
      const compressedSize = needsZip64.compressedSize ? zip64.compressedSize : compressedSize32;
      const uncompressedSize = needsZip64.uncompressedSize ? zip64.uncompressedSize : uncompressedSize32;
      const localHeaderOffset = needsZip64.localHeaderOffset ? zip64.localHeaderOffset : localHeaderOffset32;

      if (compressedSize === null || uncompressedSize === null || localHeaderOffset === null) {
        throw new PhotoUploadError('The uploaded ZIP file has an incomplete ZIP64 extra field.');
      }

      assertZipFileRange(
        fileSize,
        localHeaderOffset,
        30,
        'The uploaded ZIP file has an invalid local file header.'
      );

      entries.push({
        originalName,
        mimeType: declaredMimeType,
        extension,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
    }
  } finally {
    fs.closeSync(fd);
  }

  return entries;
}

function readZipEntryCompressedDataRange(
  zipFilePath: string,
  fileSize: number,
  entry: ZipImageFileEntry
): { start: number; length: number } {
  const fd = fs.openSync(zipFilePath, 'r');
  try {
    assertZipFileRange(
      fileSize,
      entry.localHeaderOffset,
      30,
      'The uploaded ZIP file has an invalid local file header.'
    );
    const localHeader = readFileRange(fd, zipFilePath, entry.localHeaderOffset, 30);
    if (localHeader.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new PhotoUploadError('The uploaded ZIP file has an invalid local file header.');
    }

    const localFileNameLength = localHeader.readUInt16LE(26);
    const localExtraFieldLength = localHeader.readUInt16LE(28);
    const compressedDataStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    assertZipFileRange(
      fileSize,
      compressedDataStart,
      entry.compressedSize,
      'The uploaded ZIP file has a truncated file entry.'
    );

    return { start: compressedDataStart, length: entry.compressedSize };
  } finally {
    fs.closeSync(fd);
  }
}

function createZipCompressedDataStream(zipFilePath: string, start: number, length: number): Readable {
  if (length === 0) {
    return Readable.from([]);
  }

  return fs.createReadStream(zipFilePath, {
    start,
    end: start + length - 1
  });
}

function isZlibDecompressionError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  return code.startsWith('Z_');
}

async function extractZipImageEntryToFile(input: {
  zipFilePath: string;
  zipFileSize: number;
  entry: ZipImageFileEntry;
  destinationPath: string;
  remainingUncompressedBytes: number;
}): Promise<{ sizeBytes: number; checksumSha256: string }> {
  if (input.entry.uncompressedSize > input.remainingUncompressedBytes) {
    throw new PhotoUploadError('The uncompressed ZIP contents exceed the configured maximum upload size.', 413);
  }

  const range = readZipEntryCompressedDataRange(input.zipFilePath, input.zipFileSize, input.entry);
  const compressedDataStream = createZipCompressedDataStream(input.zipFilePath, range.start, range.length);
  const checksum = createHash('sha256');
  const counter = createByteCountingTransform({
    maxBytes: input.entry.uncompressedSize,
    errorMessage: 'The uploaded ZIP file has an entry with an invalid uncompressed size.',
    hash: checksum
  });
  const output = fs.createWriteStream(input.destinationPath, { flags: 'wx' });

  try {
    if (input.entry.compressionMethod === 8) {
      await pipeline(compressedDataStream, createInflateRaw(), counter.stream, output);
    } else {
      await pipeline(compressedDataStream, counter.stream, output);
    }
  } catch (error) {
    try {
      fs.rmSync(input.destinationPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }

    if (isZlibDecompressionError(error)) {
      throw new PhotoUploadError('The uploaded ZIP file has a corrupt deflated entry.');
    }

    throw error;
  }

  const sizeBytes = counter.getTotalBytes();
  if (sizeBytes !== input.entry.uncompressedSize) {
    try {
      fs.rmSync(input.destinationPath, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
    throw new PhotoUploadError('The uploaded ZIP file has an entry with an invalid uncompressed size.');
  }

  return {
    sizeBytes,
    checksumSha256: checksum.digest('hex')
  };
}

async function writeZipEntriesToStorage(
  config: AppConfig,
  collectionId: string,
  zipFilePath: string,
  entries: ZipImageFileEntry[],
  skippedFiles: PhotoImportSkippedFile[],
  maxUncompressedBytes: number
): Promise<StoredPhotoFile[]> {
  const storedFiles: StoredPhotoFile[] = [];
  const collectionRoot = getPhotoCollectionStorageRoot(config, collectionId);
  const zipFileSize = fs.statSync(zipFilePath).size;
  let totalUncompressedBytes = 0;
  fs.mkdirSync(collectionRoot, { recursive: true });

  try {
    for (const entry of entries) {
      const storedName = createStoredPhotoName(entry.extension);
      const absolutePath = path.join(collectionRoot, storedName);
      const temporaryOriginalPath = path.join(
        collectionRoot,
        `${storedName}.${process.pid}.${Date.now()}.tmp`
      );
      let thumbnailAbsolutePath: string | null = null;

      try {
        const extracted = await extractZipImageEntryToFile({
          zipFilePath,
          zipFileSize,
          entry,
          destinationPath: temporaryOriginalPath,
          remainingUncompressedBytes: maxUncompressedBytes - totalUncompressedBytes
        });
        totalUncompressedBytes += extracted.sizeBytes;
        fs.renameSync(temporaryOriginalPath, absolutePath);

        const dimensions = await readPhotoImageDimensions({ sourcePath: absolutePath });
        const thumbnail = await generatePhotoThumbnailFile({
          config,
          collectionId,
          sourcePath: absolutePath,
          thumbnailStoredName: createPhotoThumbnailStoredName(storedName)
        });
        thumbnailAbsolutePath = thumbnail.absolutePath;

        storedFiles.push({
          absolutePath,
          thumbnailAbsolutePath,
          input: {
            originalName: entry.originalName,
            storedName,
            relativePath: path.relative(config.mediaRoot, absolutePath),
            mimeType: entry.mimeType,
            sizeBytes: extracted.sizeBytes,
            checksumSha256: extracted.checksumSha256,
            width: dimensions.width,
            height: dimensions.height,
            thumbnailRelativePath: thumbnail.relativePath,
            thumbnailMimeType: thumbnail.mimeType,
            thumbnailSizeBytes: thumbnail.sizeBytes,
            thumbnailWidth: thumbnail.width,
            thumbnailHeight: thumbnail.height
          }
        });
      } catch (error) {
        try {
          fs.rmSync(temporaryOriginalPath, { force: true });
        } catch {
          // Best-effort cleanup only.
        }
        try {
          fs.rmSync(absolutePath, { force: true });
        } catch {
          // Best-effort cleanup only.
        }
        if (thumbnailAbsolutePath) {
          try {
            fs.rmSync(thumbnailAbsolutePath, { force: true });
          } catch {
            // Best-effort cleanup only.
          }
        }

        if (isUnsupportedPhotoThumbnailSourceError(error)) {
          addSkippedPhotoImportFile(
            skippedFiles,
            entry.originalName,
            'unsupported_image_data',
            getUnsupportedPhotoDetail(error)
          );
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    cleanupStoredFiles(storedFiles);
    throw error;
  }

  return storedFiles;
}

function getPhotoUploadErrorStatusCode(error: unknown): number {
  if (error instanceof PhotoUploadError) {
    return error.statusCode;
  }

  if (isRecord(error)) {
    const statusCode = error.statusCode;
    if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
      return statusCode;
    }

    const code = typeof error.code === 'string' ? error.code : '';
    if (code.includes('FILE_TOO_LARGE') || code.includes('LIMIT_FILE_SIZE')) {
      return 413;
    }
  }

  return 500;
}

function getPhotoUploadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof PhotoUploadError) {
    return error.message;
  }

  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : '';
    if (code.includes('FILE_TOO_LARGE') || code.includes('LIMIT_FILE_SIZE')) {
      return 'Upload exceeds the configured maximum size.';
    }
  }

  return error instanceof Error ? error.message : fallback;
}

function decodeZipEntryName(buffer: Buffer, isUtf8: boolean): string {
  return buffer.toString(isUtf8 ? 'utf8' : 'latin1');
}

function isIgnorableZipMetadataEntry(entryName: string): boolean {
  const normalized = entryName.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) => segment !== '');
  const basename = segments.at(-1) ?? '';

  return (
    segments.includes('__MACOSX') ||
    basename === '.DS_Store' ||
    basename === 'Thumbs.db' ||
    basename === 'desktop.ini' ||
    basename.startsWith('._')
  );
}

function detectImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions {
  if (mimeType === 'image/png') {
    return detectPngDimensions(buffer);
  }

  if (mimeType === 'image/jpeg') {
    return detectJpegDimensions(buffer);
  }

  if (mimeType === 'image/gif') {
    return detectGifDimensions(buffer);
  }

  if (mimeType === 'image/webp') {
    return detectWebpDimensions(buffer);
  }

  if (mimeType === 'image/bmp') {
    return detectBmpDimensions(buffer);
  }

  return { width: null, height: null };
}

function detectPngDimensions(buffer: Buffer): ImageDimensions {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) {
    return { width: null, height: null };
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function detectGifDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 10 || (buffer.subarray(0, 6).toString('ascii') !== 'GIF87a' && buffer.subarray(0, 6).toString('ascii') !== 'GIF89a')) {
    return { width: null, height: null };
  }

  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  };
}

function detectBmpDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 26 || buffer.subarray(0, 2).toString('ascii') !== 'BM') {
    return { width: null, height: null };
  }

  const width = buffer.readInt32LE(18);
  const height = Math.abs(buffer.readInt32LE(22));
  return {
    width: width > 0 ? width : null,
    height: height > 0 ? height : null
  };
}

function detectJpegDimensions(buffer: Buffer): ImageDimensions {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return { width: null, height: null };
  }

  let offset = 2;
  while (offset + 4 < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= buffer.length) {
      break;
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }

    offset += segmentLength;
  }

  return { width: null, height: null };
}

function detectWebpDimensions(buffer: Buffer): ImageDimensions {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return { width: null, height: null };
  }

  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (chunkType === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
    };
  }

  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    const frameStart = 20;
    if (buffer[frameStart + 3] === 0x9d && buffer[frameStart + 4] === 0x01 && buffer[frameStart + 5] === 0x2a) {
      return {
        width: buffer.readUInt16LE(frameStart + 6) & 0x3fff,
        height: buffer.readUInt16LE(frameStart + 8) & 0x3fff
      };
    }
  }

  return { width: null, height: null };
}

function prepareUploadedImageFile(file: BufferedUploadFile): PreparedImageFile | null {
  const mimeType = normalizeImageMimeType(file.filename, file.mimetype);
  const extension = getImageExtension(file.filename, mimeType);
  if (!mimeType || !extension) {
    return null;
  }

  const dimensions = detectImageDimensions(file.buffer, mimeType);
  return {
    originalName: file.filename,
    buffer: file.buffer,
    sizeBytes: file.sizeBytes,
    mimeType,
    extension,
    width: dimensions.width,
    height: dimensions.height,
    checksumSha256: createHash('sha256').update(file.buffer).digest('hex')
  };
}

function createStoredPhotoName(extension: string): string {
  return `${Date.now()}-${randomUUID()}${extension}`;
}

async function writePreparedImagesToStorage(
  config: AppConfig,
  collectionId: string,
  images: PreparedImageFile[],
  skippedFiles: PhotoImportSkippedFile[]
): Promise<StoredPhotoFile[]> {
  const storedFiles: StoredPhotoFile[] = [];
  const collectionRoot = getPhotoCollectionStorageRoot(config, collectionId);
  fs.mkdirSync(collectionRoot, { recursive: true });

  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const storedName = createStoredPhotoName(image.extension);
      const absolutePath = path.join(collectionRoot, storedName);
      let thumbnailAbsolutePath: string | null = null;

      try {
        fs.writeFileSync(absolutePath, image.buffer, { flag: 'wx' });
        const thumbnail = await generatePhotoThumbnailFile({
          config,
          collectionId,
          sourceBuffer: image.buffer,
          thumbnailStoredName: createPhotoThumbnailStoredName(storedName)
        });
        thumbnailAbsolutePath = thumbnail.absolutePath;

        storedFiles.push({
          absolutePath,
          thumbnailAbsolutePath,
          input: {
            originalName: image.originalName,
            storedName,
            relativePath: path.relative(config.mediaRoot, absolutePath),
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            checksumSha256: image.checksumSha256,
            width: image.width,
            height: image.height,
            thumbnailRelativePath: thumbnail.relativePath,
            thumbnailMimeType: thumbnail.mimeType,
            thumbnailSizeBytes: thumbnail.sizeBytes,
            thumbnailWidth: thumbnail.width,
            thumbnailHeight: thumbnail.height
          }
        });
      } catch (error) {
        try {
          fs.rmSync(absolutePath, { force: true });
        } catch {
          // Best-effort cleanup only.
        }
        if (thumbnailAbsolutePath) {
          try {
            fs.rmSync(thumbnailAbsolutePath, { force: true });
          } catch {
            // Best-effort cleanup only.
          }
        }

        if (isUnsupportedPhotoThumbnailSourceError(error)) {
          addSkippedPhotoImportFile(
            skippedFiles,
            image.originalName,
            'unsupported_image_data',
            getUnsupportedPhotoDetail(error)
          );
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    cleanupStoredFiles(storedFiles);
    throw error;
  }

  return storedFiles;
}

function cleanupStoredFiles(storedFiles: StoredPhotoFile[]): void {
  for (const storedFile of storedFiles) {
    for (const filePath of [storedFile.absolutePath, storedFile.thumbnailAbsolutePath]) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

function cleanupCollectionDirectory(config: AppConfig, collectionId: string): void {
  for (const rootPath of [
    ...getPhotoCollectionStorageRootsForCleanup(config, collectionId),
    getLegacyPhotoCollectionStorageRoot(config, collectionId)
  ]) {
    try {
      fs.rmSync(rootPath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function createPhotoCollectionDetailPayload(
  collection: PhotoCollection,
  photos: Photo[]
): PhotoCollectionDetailPayload {
  return { collection, photos };
}

function serializePhotoImportResult(
  collection: PhotoCollection,
  photos: Photo[],
  skippedFiles: PhotoImportSkippedFile[]
): PhotoImportResultPayload {
  return {
    ...createPhotoCollectionDetailPayload(collection, photos),
    importReport: createPhotoImportReport(photos.length, skippedFiles)
  };
}

export function registerPhotoRoutes(app: FastifyInstance, options: PhotoRoutesOptions): void {
  const { config, photoStore } = options;

  app.get('/api/photos/home-strips', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    reply.send(createPhotoHomeStripListPayload(photoStore));
  });

  app.post('/api/photos/home-strips', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const body = parsePhotoHomeStripBody(request.body);
    if (!body) {
      reply.code(400).send({
        ok: false,
        message: 'Provide a strip name, row count, sort, direction, optional search, and optional include/exclude tag ids.'
      });
      return;
    }

    const strip = await photoStore.createHomeStrip(body);
    reply.code(201).send({
      ok: true,
      strip,
      ...createPhotoHomeStripListPayload(photoStore)
    });
  });

  app.put('/api/photos/home-strips/reorder', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const body = parsePhotoHomeStripReorderBody(request.body);
    if (!body) {
      reply.code(400).send({
        ok: false,
        message: 'Provide an ordered stripIds array.'
      });
      return;
    }

    const strips = await photoStore.reorderHomeStrips(body.stripIds);
    if (!strips) {
      reply.code(400).send({
        ok: false,
        message: 'One or more strip ids do not exist.'
      });
      return;
    }

    reply.send({
      ok: true,
      strips
    });
  });

  app.patch('/api/photos/home-strips/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const stripId = parsePhotoHomeStripIdParam(request);
    if (!stripId) {
      reply.code(400).send({ ok: false, message: 'A strip id is required.' });
      return;
    }

    const body = parsePhotoHomeStripBody(request.body);
    if (!body) {
      reply.code(400).send({
        ok: false,
        message: 'Provide a strip name, row count, sort, direction, optional search, and optional include/exclude tag ids.'
      });
      return;
    }

    const strip = await photoStore.updateHomeStrip(stripId, body);
    if (!strip) {
      reply.code(404).send({ ok: false, message: 'Photo home strip not found.' });
      return;
    }

    reply.send({
      ok: true,
      strip,
      ...createPhotoHomeStripListPayload(photoStore)
    });
  });

  app.delete('/api/photos/home-strips/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const stripId = parsePhotoHomeStripIdParam(request);
    if (!stripId) {
      reply.code(400).send({ ok: false, message: 'A strip id is required.' });
      return;
    }

    const strip = await photoStore.deleteHomeStrip(stripId);
    if (!strip) {
      reply.code(404).send({ ok: false, message: 'Photo home strip not found.' });
      return;
    }

    reply.send({
      ok: true,
      strip,
      ...createPhotoHomeStripListPayload(photoStore)
    });
  });

  app.get('/api/photos/collections', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const queryInput = createPhotoCollectionQueryInput(request);
    reply.send(queryPhotoCollections(photoStore.listCollections(), queryInput));
  });

  app.get('/api/photos/collections/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    if (!collectionId) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    const collection = photoStore.findCollectionById(collectionId);
    if (!collection) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    reply.send(createPhotoCollectionDetailPayload(collection, photoStore.listPhotos(collectionId)));
  });

  app.patch('/api/photos/collections/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    if (!collectionId) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    const body = readBodyRecord(request);
    const requestedDescription = body.description;
    const descriptionPatch: string | null | undefined =
      requestedDescription === null
        ? null
        : typeof requestedDescription === 'string'
          ? requestedDescription
          : undefined;
    const updated = await photoStore.updateCollection(collectionId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: descriptionPatch
    });

    if (!updated) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    reply.send({ collection: updated });
  });

  app.delete('/api/photos/collections/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    if (!collectionId) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    const deleted = await photoStore.deleteCollection(collectionId);
    if (!deleted) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    cleanupCollectionDirectory(config, collectionId);
    reply.send({ ok: true, collection: deleted.collection });
  });

  app.post('/api/photos/collections/:id/views', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    if (!collectionId) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    const updated = await photoStore.incrementCollectionViewCount(collectionId);
    if (!updated) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    reply.send({ collection: updated });
  });

  app.post('/api/photos/collections/:id/thumbnail', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    if (!collectionId) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    const body = readBodyRecord(request);
    const photoId = readOptionalString(body.photoId);
    if (!photoId) {
      reply.code(400).send({ message: 'Photo id is required.' });
      return;
    }

    const updated = await photoStore.setCollectionCoverPhoto(collectionId, photoId);
    if (!updated) {
      sendNotFound(reply, 'Photo collection or photo not found.');
      return;
    }

    reply.send({ collection: updated });
  });

  app.post('/api/photos/collections/:id/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    if (!collectionId) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    const body = readBodyRecord(request);
    const label = readOptionalString(body.label);
    if (!label) {
      reply.code(400).send({ message: 'Tag label is required.' });
      return;
    }

    const updated = await photoStore.addCollectionTag(collectionId, label);
    if (!updated) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    reply.send({ collection: updated });
  });

  app.delete('/api/photos/collections/:id/tags/:tagId', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const collectionId = getRequestParam(request, 'id');
    const tagId = getRequestParam(request, 'tagId');
    if (!collectionId || !tagId) {
      sendNotFound(reply, 'Photo collection or tag not found.');
      return;
    }

    const updated = await photoStore.removeCollectionTag(collectionId, tagId);
    if (!updated) {
      sendNotFound(reply, 'Photo collection not found.');
      return;
    }

    reply.send({ collection: updated });
  });

  app.get('/api/photos/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const query = isRecord(request.query) ? request.query : {};
    const search = readQueryValue(query.search);
    const limit = readPositiveInteger(query.limit, 10, 50);
    const tags = await photoStore.searchTags({ search, limit });
    reply.send({ tags } satisfies CatalogTagListPayload);
  });

  app.get('/api/photos/tags/top', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const query = isRecord(request.query) ? request.query : {};
    const limit = readPositiveInteger(query.limit, 10, 50);
    const tags = await photoStore.listMostUsedTags(limit);
    reply.send({ tags } satisfies CatalogTagListPayload);
  });

  app.post('/api/photos/imports/zip', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    let upload: ParsedTemporaryMultipartUpload | null = null;
    try {
      upload = await readMultipartUploadToTemporaryFiles(request, config, config.maxUploadBytes);
      const zipFile = upload.files.find((file) => file.fieldName === 'file' || file.fieldName === 'zip') ?? upload.files[0];
      if (!zipFile) {
        throw new PhotoUploadError('Choose a ZIP file to import.');
      }

      if (path.extname(zipFile.filename).toLowerCase() !== '.zip' && zipFile.mimetype !== 'application/zip') {
        throw new PhotoUploadError('Photo collection ZIP imports require a .zip file.');
      }

      const skippedFiles: PhotoImportSkippedFile[] = [];
      const entries = readZipImageEntriesFromFile(zipFile.path, skippedFiles);
      if (entries.length === 0) {
        throw new PhotoUploadError(createNoImportablePhotosMessage('ZIP file', skippedFiles));
      }

      const requestedName = getMultipartField(upload.fields, 'collectionName', 'name');
      const collectionName = sanitizeCollectionName(
        requestedName,
        deriveCollectionNameFromFilename(zipFile.filename, 'Imported photo collection')
      );
      const collection = await photoStore.createCollection({ name: collectionName });
      let storedFiles: StoredPhotoFile[] = [];

      try {
        storedFiles = await writeZipEntriesToStorage(
          config,
          collection.id,
          zipFile.path,
          entries,
          skippedFiles,
          config.maxUploadBytes
        );
        if (storedFiles.length === 0) {
          throw new PhotoUploadError(createNoImportablePhotosMessage('ZIP file', skippedFiles));
        }

        const result = await photoStore.addPhotosToCollection(
          collection.id,
          storedFiles.map((storedFile) => storedFile.input)
        );

        if (!result) {
          throw new PhotoUploadError('The new photo collection could not be created.', 500);
        }

        reply.send(serializePhotoImportResult(result.collection, result.photos, skippedFiles));
      } catch (error) {
        cleanupStoredFiles(storedFiles);
        await photoStore.deleteCollection(collection.id).catch(() => undefined);
        cleanupCollectionDirectory(config, collection.id);
        throw error;
      }
    } catch (error) {
      reply.code(getPhotoUploadErrorStatusCode(error)).send({
        ok: false,
        message: getPhotoUploadErrorMessage(error, 'Photo ZIP import failed.')
      });
    } finally {
      cleanupTemporaryDirectory(upload?.temporaryRoot);
    }
  });

  app.post('/api/photos/imports/files', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    try {
      const upload = await readMultipartUpload(request, config.maxUploadBytes);
      const skippedFiles: PhotoImportSkippedFile[] = [];
      const images: PreparedImageFile[] = [];
      for (const file of upload.files) {
        const image = prepareUploadedImageFile(file);
        if (image) {
          images.push(image);
        } else {
          addSkippedPhotoImportFile(skippedFiles, file.filename, 'unsupported_file_type');
        }
      }

      if (images.length === 0) {
        throw new PhotoUploadError(createNoImportablePhotosMessage('upload', skippedFiles));
      }

      const requestedCollectionId = getMultipartField(upload.fields, 'collectionId');
      const requestedCollectionName = getMultipartField(upload.fields, 'collectionName', 'name');
      let collection = requestedCollectionId ? photoStore.findCollectionById(requestedCollectionId) : undefined;
      let createdCollectionId: string | null = null;

      if (requestedCollectionId && !collection) {
        throw new PhotoUploadError('The selected photo collection no longer exists.', 404);
      }

      if (!collection) {
        const fallbackName = deriveCollectionNameFromFilename(
          images[0]?.originalName ?? 'Photo collection',
          'New photo collection'
        );
        collection = await photoStore.createCollection({
          name: sanitizeCollectionName(requestedCollectionName, fallbackName)
        });
        createdCollectionId = collection.id;
      }

      let storedFiles: StoredPhotoFile[] = [];
      try {
        storedFiles = await writePreparedImagesToStorage(config, collection.id, images, skippedFiles);
        if (storedFiles.length === 0) {
          throw new PhotoUploadError(createNoImportablePhotosMessage('upload', skippedFiles));
        }

        const result = await photoStore.addPhotosToCollection(
          collection.id,
          storedFiles.map((storedFile) => storedFile.input)
        );

        if (!result) {
          throw new PhotoUploadError('The selected photo collection no longer exists.', 404);
        }

        reply.send(serializePhotoImportResult(result.collection, result.photos, skippedFiles));
      } catch (error) {
        cleanupStoredFiles(storedFiles);
        if (createdCollectionId) {
          await photoStore.deleteCollection(createdCollectionId).catch(() => undefined);
          cleanupCollectionDirectory(config, createdCollectionId);
        }
        throw error;
      }
    } catch (error) {
      reply.code(getPhotoUploadErrorStatusCode(error)).send({
        ok: false,
        message: getPhotoUploadErrorMessage(error, 'Photo import failed.')
      });
    }
  });

  app.put('/api/photos/:id/favorite', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const photoId = getRequestParam(request, 'id');
    if (!photoId) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    const body = readBodyRecord(request);
    const isFavorite = readRequiredBoolean(body.isFavorite);
    if (isFavorite === null) {
      reply.code(400).send({ message: 'Favorite state is required.' });
      return;
    }

    const updated = await photoStore.setPhotoFavorite(photoId, isFavorite);
    if (!updated) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    reply.send(updated);
  });

  app.post('/api/photos/:id/views', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const photoId = getRequestParam(request, 'id');
    if (!photoId) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    const updated = await photoStore.incrementPhotoViewCount(photoId);
    if (!updated) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    reply.send({ photo: updated });
  });

  async function sendPhotoMediaResponse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const photoId = getRequestParam(request, 'id');
    if (!photoId) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    const photo = photoStore.findPhotoById(photoId);
    if (!photo) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    const absolutePath = getPhotoFileAbsolutePath(config, photo);
    if (!absolutePath) {
      request.log.warn(
        {
          event: 'photo.media.file_missing',
          photoId: photo.id,
          collectionId: photo.collectionId,
          storedName: photo.storedName,
          relativePath: photo.relativePath,
          attemptedPaths: resolvePhotoFileCandidates(config, photo)
        },
        'Photo media request could not resolve a stored image file.'
      );
      sendNotFound(reply, 'Photo file is not available.');
      return;
    }

    sendPhotoFileResponse(
      request,
      reply,
      absolutePath,
      photo.mimeType || getMimeTypeFromExtension(photo.storedName) || getMimeTypeFromExtension(absolutePath) || 'application/octet-stream'
    );
  }

  async function sendPhotoThumbnailMediaResponse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!getAuthenticatedSessionId(request, reply, options)) {
      return;
    }

    const photoId = getRequestParam(request, 'id');
    if (!photoId) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    const photo = photoStore.findPhotoById(photoId);
    if (!photo) {
      sendNotFound(reply, 'Photo not found.');
      return;
    }

    const thumbnail = await ensurePhotoThumbnailFile(request, config, photoStore, photo);
    if (!thumbnail) {
      request.log.warn(
        {
          event: 'photo.thumbnail.file_missing',
          photoId: photo.id,
          collectionId: photo.collectionId,
          thumbnailRelativePath: photo.thumbnailRelativePath,
          attemptedPaths: resolvePhotoThumbnailFileCandidates(config, photo)
        },
        'Photo thumbnail request could not resolve or generate a thumbnail file.'
      );
      sendNotFound(reply, 'Photo thumbnail is not available.');
      return;
    }

    sendPhotoFileResponse(request, reply, thumbnail.absolutePath, thumbnail.mimeType);
  }

  app.get('/api/photos/:id/thumbnail', sendPhotoThumbnailMediaResponse);
  app.get('/media/photos/:id/thumbnail', sendPhotoThumbnailMediaResponse);
  app.get('/api/photos/:id/media', sendPhotoMediaResponse);
  app.get('/media/photos/:id', sendPhotoMediaResponse);
}
