import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { bootstrapPhotoCatalogSchema, withTransaction } from './db';
import {
  normalizeCatalogTagKey,
  normalizeCatalogTagLabel,
  normalizeVisibleName
} from './catalog-store';
import type {
  CatalogTag,
  Photo,
  PhotoCollection,
  PhotoHomeStrip,
  PhotoHomeStripRowCount,
  PhotoHomeStripSortCategory,
  PhotoHomeStripSortDirection
} from './types';

type Queryable = Pool | PoolClient;

type PhotoCatalogStoreOptions = {
  pool: Pool;
};

export type CreatePhotoCollectionInput = {
  name: string;
  description?: string | null;
};

export type UpdatePhotoCollectionInput = Partial<{
  name: string;
  description: string | null;
}>;

export type CreatePhotoHomeStripInput = {
  name: string;
  rowCount: PhotoHomeStripRowCount;
  sortCategory: PhotoHomeStripSortCategory;
  sortDirection: PhotoHomeStripSortDirection;
  search?: string | null;
  tagIds?: string[];
  excludedTagIds?: string[];
};

export type UpdatePhotoHomeStripInput = Partial<CreatePhotoHomeStripInput>;

export type AddPhotoInput = {
  originalName: string;
  storedName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  width?: number | null;
  height?: number | null;
  thumbnailRelativePath?: string | null;
  thumbnailMimeType?: string | null;
  thumbnailSizeBytes?: number | null;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
  sortOrder?: number | null;
};

export type UpdatePhotoThumbnailInput = {
  thumbnailRelativePath: string;
  thumbnailMimeType: string;
  thumbnailSizeBytes: number;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
};

export type UpdatePhotoCollectionThumbnailInput = {
  thumbnailSourcePhotoId: string;
  thumbnailRelativePath: string;
  thumbnailMimeType: string;
  thumbnailSizeBytes: number;
  thumbnailWidth?: number | null;
  thumbnailHeight?: number | null;
};

type PhotoCollectionRow = {
  id: string;
  name: string;
  normalized_name: string;
  description: string | null;
  cover_photo_id: string | null;
  thumbnail_source_photo_id: string | null;
  thumbnail_relative_path: string | null;
  thumbnail_mime_type: string | null;
  thumbnail_size_bytes: number | string | null;
  thumbnail_width: number | string | null;
  thumbnail_height: number | string | null;
  view_count: number | string;
  last_viewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PhotoRow = {
  id: string;
  collection_id: string;
  original_name: string;
  stored_name: string;
  relative_path: string;
  mime_type: string;
  size_bytes: number | string;
  checksum_sha256: string;
  width: number | string | null;
  height: number | string | null;
  thumbnail_relative_path: string | null;
  thumbnail_mime_type: string | null;
  thumbnail_size_bytes: number | string | null;
  thumbnail_width: number | string | null;
  thumbnail_height: number | string | null;
  sort_order: number | string;
  view_count: number | string;
  last_viewed_at: Date | string | null;
  is_favorite: boolean | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type CatalogTagRow = {
  id: string;
  label: string;
  normalized_label: string;
  usage_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type PhotoCollectionTagHydrationRow = CatalogTagRow & {
  collection_id: string;
};

type PhotoHomeStripRow = {
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

type DeletePhotoCollectionResult = {
  collection: PhotoCollection;
  photos: Photo[];
};

export type PhotoFavoriteUpdateResult = {
  photo: Photo;
  collection: PhotoCollection;
};

const PHOTO_COLLECTION_NAME_MAX_LENGTH = 160;
const PHOTO_COLLECTION_DESCRIPTION_MAX_LENGTH = 2000;
const PHOTO_HOME_STRIP_NAME_MAX_LENGTH = 120;
const DEFAULT_PHOTO_HOME_STRIP_ROW_COUNT: PhotoHomeStripRowCount = 1;
const DEFAULT_PHOTO_HOME_STRIP_SORT_CATEGORY: PhotoHomeStripSortCategory = 'createdAt';
const DEFAULT_PHOTO_HOME_STRIP_SORT_DIRECTION: PhotoHomeStripSortDirection = 'desc';
const DEFAULT_TAG_AUTOCOMPLETE_LIMIT = 10;
const DEFAULT_TOP_TAG_LIMIT = 10;

const PHOTO_HOME_STRIP_SORT_CATEGORIES: PhotoHomeStripSortCategory[] = [
  'none',
  'createdAt',
  'name',
  'photoCount',
  'lastViewedAt',
  'viewCount',
  'random'
];

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

function readIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  return null;
}

function normalizeNullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : readIsoString(value);
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = readNumber(value);
  if (parsed === null || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizeNullablePositiveDimension(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function normalizeCollectionName(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PHOTO_COLLECTION_NAME_MAX_LENGTH);

  return normalized === '' ? 'Untitled photo collection' : normalized;
}

function normalizeCollectionDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PHOTO_COLLECTION_DESCRIPTION_MAX_LENGTH);

  return normalized === '' ? null : normalized;
}

function normalizePhotoHomeStripName(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PHOTO_HOME_STRIP_NAME_MAX_LENGTH);

  return normalized === '' ? 'Untitled strip' : normalized;
}

function isPhotoHomeStripSortCategory(value: string): value is PhotoHomeStripSortCategory {
  return PHOTO_HOME_STRIP_SORT_CATEGORIES.includes(value as PhotoHomeStripSortCategory);
}

function normalizePhotoHomeStripSortCategory(value: unknown): PhotoHomeStripSortCategory {
  const text = readString(value);
  return text && isPhotoHomeStripSortCategory(text) ? text : DEFAULT_PHOTO_HOME_STRIP_SORT_CATEGORY;
}

function normalizePhotoHomeStripSortDirection(value: unknown): PhotoHomeStripSortDirection {
  return value === 'asc' || value === 'desc' ? value : DEFAULT_PHOTO_HOME_STRIP_SORT_DIRECTION;
}

function normalizePhotoHomeStripRowCount(value: unknown): PhotoHomeStripRowCount {
  const parsed = readNumber(value);
  if (parsed === 2 || parsed === 3) {
    return parsed;
  }

  return DEFAULT_PHOTO_HOME_STRIP_ROW_COUNT;
}

function normalizePhotoHomeStripSearch(value: unknown): string | null {
  const text = readString(value);
  if (text === null) {
    return null;
  }

  const trimmed = text.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

function normalizePhotoHomeStripTagIds(value: unknown): string[] {
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

function normalizePhotoHomeStripDisplayOrder(value: unknown): number {
  const parsed = readNumber(value);
  if (parsed === null || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function normalizePhotoHomeStrip(input: PhotoHomeStrip): PhotoHomeStrip {
  const createdAt = normalizeNullableTimestamp(input.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizeNullableTimestamp(input.updatedAt) ?? createdAt;

  return {
    id: input.id,
    name: normalizePhotoHomeStripName(input.name),
    displayOrder: normalizePhotoHomeStripDisplayOrder(input.displayOrder),
    rowCount: normalizePhotoHomeStripRowCount(input.rowCount),
    sortCategory: normalizePhotoHomeStripSortCategory(input.sortCategory),
    sortDirection: normalizePhotoHomeStripSortDirection(input.sortDirection),
    search: normalizePhotoHomeStripSearch(input.search),
    tagIds: normalizePhotoHomeStripTagIds(input.tagIds),
    excludedTagIds: normalizePhotoHomeStripTagIds(input.excludedTagIds),
    createdAt,
    updatedAt
  };
}

function toJsonParameter(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function hydrateCatalogTagFromRow(row: CatalogTagRow): CatalogTag {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return {
    id: row.id,
    label: row.label,
    normalizedLabel: row.normalized_label,
    usageCount: normalizeNonNegativeInteger(row.usage_count),
    createdAt,
    updatedAt
  };
}

function normalizeCatalogTag(tag: CatalogTag): CatalogTag {
  return {
    id: tag.id,
    label: normalizeCatalogTagLabel(tag.label),
    normalizedLabel: normalizeCatalogTagKey(tag.normalizedLabel || tag.label),
    usageCount: normalizeNonNegativeInteger(tag.usageCount),
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt
  };
}

function normalizeCatalogTags(tags: CatalogTag[]): CatalogTag[] {
  return [...tags]
    .map(normalizeCatalogTag)
    .sort((left, right) => {
      const comparison = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
      return comparison !== 0 ? comparison : left.id.localeCompare(right.id);
    });
}

function hydratePhotoFromRow(row: PhotoRow): Photo {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return {
    id: row.id,
    collectionId: row.collection_id,
    originalName: row.original_name,
    storedName: row.stored_name,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    sizeBytes: normalizeNonNegativeInteger(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    width: normalizeNullablePositiveDimension(row.width),
    height: normalizeNullablePositiveDimension(row.height),
    thumbnailRelativePath: row.thumbnail_relative_path,
    thumbnailMimeType: row.thumbnail_mime_type,
    thumbnailSizeBytes:
      row.thumbnail_size_bytes === null || row.thumbnail_size_bytes === undefined
        ? null
        : normalizeNonNegativeInteger(row.thumbnail_size_bytes),
    thumbnailWidth: normalizeNullablePositiveDimension(row.thumbnail_width),
    thumbnailHeight: normalizeNullablePositiveDimension(row.thumbnail_height),
    sortOrder: normalizeNonNegativeInteger(row.sort_order),
    viewCount: normalizeNonNegativeInteger(row.view_count),
    lastViewedAt: normalizeNullableTimestamp(row.last_viewed_at),
    isFavorite: normalizeBoolean(row.is_favorite),
    createdAt,
    updatedAt
  };
}

function clonePhoto(photo: Photo): Photo {
  return { ...photo };
}

function clonePhotoCollection(collection: PhotoCollection): PhotoCollection {
  return {
    ...collection,
    coverPhoto: collection.coverPhoto ? clonePhoto(collection.coverPhoto) : null,
    favoritePhotoIds: [...collection.favoritePhotoIds],
    tags: collection.tags.map((tag) => ({ ...tag }))
  };
}

function clonePhotoHomeStrip(strip: PhotoHomeStrip): PhotoHomeStrip {
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

function createPhotoFromInput(collectionId: string, input: AddPhotoInput, sortOrder: number): Photo {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    collectionId,
    originalName: input.originalName,
    storedName: input.storedName,
    relativePath: input.relativePath,
    mimeType: input.mimeType,
    sizeBytes: normalizeNonNegativeInteger(input.sizeBytes),
    checksumSha256: input.checksumSha256,
    width: normalizeNullablePositiveDimension(input.width),
    height: normalizeNullablePositiveDimension(input.height),
    thumbnailRelativePath: input.thumbnailRelativePath ?? null,
    thumbnailMimeType: input.thumbnailMimeType ?? null,
    thumbnailSizeBytes:
      input.thumbnailSizeBytes === null || input.thumbnailSizeBytes === undefined
        ? null
        : normalizeNonNegativeInteger(input.thumbnailSizeBytes),
    thumbnailWidth: normalizeNullablePositiveDimension(input.thumbnailWidth),
    thumbnailHeight: normalizeNullablePositiveDimension(input.thumbnailHeight),
    sortOrder,
    viewCount: 0,
    lastViewedAt: null,
    isFavorite: false,
    createdAt: now,
    updatedAt: now
  };
}

function createCollectionFromInput(input: CreatePhotoCollectionInput): PhotoCollection {
  const now = new Date().toISOString();
  const name = normalizeCollectionName(input.name);

  return {
    id: randomUUID(),
    name,
    normalizedName: normalizeVisibleName(name),
    description: normalizeCollectionDescription(input.description),
    coverPhotoId: null,
    coverPhoto: null,
    thumbnailSourcePhotoId: null,
    thumbnailRelativePath: null,
    thumbnailMimeType: null,
    thumbnailSizeBytes: null,
    thumbnailWidth: null,
    thumbnailHeight: null,
    photoCount: 0,
    favoritePhotoIds: [],
    totalSizeBytes: 0,
    viewCount: 0,
    lastViewedAt: null,
    tags: [],
    createdAt: now,
    updatedAt: now
  };
}

function buildPhotoHomeStripFromInput(
  input: CreatePhotoHomeStripInput,
  displayOrder: number
): PhotoHomeStrip {
  const now = new Date().toISOString();

  return normalizePhotoHomeStrip({
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

function hydratePhotoCollectionFromRow(row: PhotoCollectionRow): PhotoCollection {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    description: row.description,
    coverPhotoId: row.cover_photo_id,
    coverPhoto: null,
    thumbnailSourcePhotoId: row.thumbnail_source_photo_id,
    thumbnailRelativePath: row.thumbnail_relative_path,
    thumbnailMimeType: row.thumbnail_mime_type,
    thumbnailSizeBytes:
      row.thumbnail_size_bytes === null || row.thumbnail_size_bytes === undefined
        ? null
        : normalizeNonNegativeInteger(row.thumbnail_size_bytes),
    thumbnailWidth: normalizeNullablePositiveDimension(row.thumbnail_width),
    thumbnailHeight: normalizeNullablePositiveDimension(row.thumbnail_height),
    photoCount: 0,
    favoritePhotoIds: [],
    totalSizeBytes: 0,
    viewCount: normalizeNonNegativeInteger(row.view_count),
    lastViewedAt: normalizeNullableTimestamp(row.last_viewed_at),
    tags: [],
    createdAt,
    updatedAt
  };
}

function hydratePhotoHomeStripFromRow(row: PhotoHomeStripRow): PhotoHomeStrip {
  const createdAt = readIsoString(row.created_at) ?? new Date().toISOString();
  const updatedAt = readIsoString(row.updated_at) ?? createdAt;

  return normalizePhotoHomeStrip({
    id: row.id,
    name: row.name,
    displayOrder: normalizePhotoHomeStripDisplayOrder(row.display_order),
    rowCount: normalizePhotoHomeStripRowCount(row.row_count),
    sortCategory: normalizePhotoHomeStripSortCategory(row.sort_category),
    sortDirection: normalizePhotoHomeStripSortDirection(row.sort_direction),
    search: normalizePhotoHomeStripSearch(row.search_term),
    tagIds: normalizePhotoHomeStripTagIds(row.tag_ids),
    excludedTagIds: normalizePhotoHomeStripTagIds(row.excluded_tag_ids),
    createdAt,
    updatedAt
  });
}

export class PhotoCatalogStore {
  private readonly collectionById = new Map<string, PhotoCollection>();
  private readonly photoById = new Map<string, Photo>();
  private readonly homeStripById = new Map<string, PhotoHomeStrip>();
  private readonly photoIdsByCollectionId = new Map<string, string[]>();
  private readonly writeChains = new Map<string, Promise<void>>();
  private initializationPromise: Promise<void> | null = null;
  private initialized = false;

  constructor(private readonly options: PhotoCatalogStoreOptions) {}

  async initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeInternal();
    }

    await this.initializationPromise;
  }

  listCollections(): PhotoCollection[] {
    this.assertInitialized();

    return Array.from(this.collectionById.values())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(clonePhotoCollection);
  }

  findCollectionById(collectionId: string): PhotoCollection | undefined {
    this.assertInitialized();

    const collection = this.collectionById.get(collectionId);
    return collection ? clonePhotoCollection(collection) : undefined;
  }

  listHomeStrips(): PhotoHomeStrip[] {
    this.assertInitialized();

    return this.getSortedHomeStrips().map(clonePhotoHomeStrip);
  }

  async createHomeStrip(input: CreatePhotoHomeStripInput): Promise<PhotoHomeStrip> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoHomeStripsWriteKey(), async () => {
      const strip = buildPhotoHomeStripFromInput(input, this.getNextHomeStripDisplayOrder());
      await this.insertPhotoHomeStrip(this.options.pool, strip);
      this.homeStripById.set(strip.id, strip);
      return clonePhotoHomeStrip(strip);
    });
  }

  async updateHomeStrip(
    stripId: string,
    patch: UpdatePhotoHomeStripInput
  ): Promise<PhotoHomeStrip | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoHomeStripsWriteKey(), async () => {
      const currentStrip = this.homeStripById.get(stripId);
      if (!currentStrip) {
        return undefined;
      }

      const updatedStrip = normalizePhotoHomeStrip({
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

      const updated = await this.updatePhotoHomeStripRow(this.options.pool, updatedStrip);
      if (!updated) {
        this.homeStripById.delete(stripId);
        return undefined;
      }

      this.homeStripById.set(stripId, updatedStrip);
      return clonePhotoHomeStrip(updatedStrip);
    });
  }

  async deleteHomeStrip(stripId: string): Promise<PhotoHomeStrip | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoHomeStripsWriteKey(), async () => {
      const currentStrip = this.homeStripById.get(stripId);
      if (!currentStrip) {
        return undefined;
      }

      const result = await this.options.pool.query<{ id: string }>(
        'DELETE FROM photo_home_strips WHERE id = $1 RETURNING id',
        [stripId]
      );

      if (result.rowCount === 0) {
        this.homeStripById.delete(stripId);
        return undefined;
      }

      this.homeStripById.delete(stripId);
      await this.compactHomeStripDisplayOrders(this.options.pool);
      return clonePhotoHomeStrip(currentStrip);
    });
  }

  async reorderHomeStrips(stripIds: string[]): Promise<PhotoHomeStrip[] | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoHomeStripsWriteKey(), async () => {
      const requestedIds = normalizePhotoHomeStripTagIds(stripIds);
      if (requestedIds.some((stripId) => !this.homeStripById.has(stripId))) {
        return undefined;
      }

      const requestedIdSet = new Set(requestedIds);
      const orderedStrips = [
        ...requestedIds
          .map((stripId) => this.homeStripById.get(stripId))
          .filter((strip): strip is PhotoHomeStrip => strip !== undefined),
        ...this.getSortedHomeStrips().filter((strip) => !requestedIdSet.has(strip.id))
      ];

      const now = new Date().toISOString();
      const normalizedStrips = orderedStrips.map((strip, index) =>
        normalizePhotoHomeStrip({
          ...strip,
          displayOrder: index,
          updatedAt: strip.displayOrder === index ? strip.updatedAt : now
        })
      );

      await withTransaction(this.options.pool, async (client) => {
        for (const strip of normalizedStrips) {
          await this.updatePhotoHomeStripRow(client, strip);
        }
      });

      for (const strip of normalizedStrips) {
        this.homeStripById.set(strip.id, strip);
      }

      return this.listHomeStrips();
    });
  }

  listPhotos(collectionId: string): Photo[] {
    this.assertInitialized();

    return this.getCollectionPhotos(collectionId).map(clonePhoto);
  }

  findPhotoById(photoId: string): Photo | undefined {
    this.assertInitialized();

    const photo = this.photoById.get(photoId);
    return photo ? clonePhoto(photo) : undefined;
  }

  async createCollection(input: CreatePhotoCollectionInput): Promise<PhotoCollection> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoCollectionsWriteKey(), async () => {
      const collection = createCollectionFromInput(input);
      await this.insertPhotoCollection(this.options.pool, collection);
      this.collectionById.set(collection.id, collection);
      this.photoIdsByCollectionId.set(collection.id, []);
      return clonePhotoCollection(collection);
    });
  }

  async updateCollection(
    collectionId: string,
    patch: UpdatePhotoCollectionInput
  ): Promise<PhotoCollection | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoCollectionWriteKey(collectionId), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      if (!currentCollection) {
        return undefined;
      }

      const nextName = patch.name !== undefined ? normalizeCollectionName(patch.name) : currentCollection.name;
      const nextDescription =
        patch.description !== undefined
          ? normalizeCollectionDescription(patch.description)
          : currentCollection.description;
      const updatedAt = new Date().toISOString();
      const updatedCollection = {
        ...currentCollection,
        name: nextName,
        normalizedName: normalizeVisibleName(nextName),
        description: nextDescription,
        updatedAt
      };

      const updated = await this.updatePhotoCollectionRow(this.options.pool, updatedCollection);
      if (!updated) {
        this.collectionById.delete(collectionId);
        this.photoIdsByCollectionId.delete(collectionId);
        return undefined;
      }

      this.collectionById.set(collectionId, this.createCollectionSummary(updatedCollection));
      return clonePhotoCollection(this.collectionById.get(collectionId) as PhotoCollection);
    });
  }

  async setCollectionCoverPhoto(
    collectionId: string,
    photoId: string,
    thumbnail: UpdatePhotoCollectionThumbnailInput | null = null
  ): Promise<PhotoCollection | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoCollectionWriteKey(collectionId), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      const coverPhoto = this.photoById.get(photoId);

      if (!currentCollection || !coverPhoto || coverPhoto.collectionId !== collectionId) {
        return undefined;
      }

      if (thumbnail && thumbnail.thumbnailSourcePhotoId !== coverPhoto.id) {
        return undefined;
      }

      const updatedAt = new Date().toISOString();
      const updatedCollection = this.createCollectionSummary({
        ...currentCollection,
        coverPhotoId: coverPhoto.id,
        thumbnailSourcePhotoId: thumbnail?.thumbnailSourcePhotoId ?? null,
        thumbnailRelativePath: thumbnail?.thumbnailRelativePath ?? null,
        thumbnailMimeType: thumbnail?.thumbnailMimeType ?? null,
        thumbnailSizeBytes:
          thumbnail?.thumbnailSizeBytes === null || thumbnail?.thumbnailSizeBytes === undefined
            ? null
            : normalizeNonNegativeInteger(thumbnail.thumbnailSizeBytes),
        thumbnailWidth: normalizeNullablePositiveDimension(thumbnail?.thumbnailWidth),
        thumbnailHeight: normalizeNullablePositiveDimension(thumbnail?.thumbnailHeight),
        updatedAt
      });

      const persisted = await this.updatePhotoCollectionCoverPhotoRow(this.options.pool, updatedCollection);
      if (!persisted) {
        return undefined;
      }

      const summarizedCollection = this.createCollectionSummary({
        ...persisted,
        tags: currentCollection.tags
      });
      this.collectionById.set(collectionId, summarizedCollection);
      return clonePhotoCollection(summarizedCollection);
    });
  }

  async addPhotosToCollection(
    collectionId: string,
    inputs: AddPhotoInput[]
  ): Promise<{ collection: PhotoCollection; photos: Photo[] } | undefined> {
    this.assertInitialized();

    if (inputs.length === 0) {
      const collection = this.collectionById.get(collectionId);
      return collection ? { collection: clonePhotoCollection(collection), photos: [] } : undefined;
    }

    return this.enqueueWrite(this.getPhotoCollectionWriteKey(collectionId), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      if (!currentCollection) {
        return undefined;
      }

      const existingPhotoIds = this.photoIdsByCollectionId.get(collectionId) ?? [];
      const nextSortOrderStart = existingPhotoIds.reduce((maxValue, photoId) => {
        const photo = this.photoById.get(photoId);
        return photo ? Math.max(maxValue, photo.sortOrder + 1) : maxValue;
      }, 0);
      const photos = inputs.map((input, index) =>
        createPhotoFromInput(collectionId, input, input.sortOrder ?? nextSortOrderStart + index)
      );
      const updatedAt = new Date().toISOString();

      await withTransaction(this.options.pool, async (client) => {
        const collectionResult = await client.query<{ id: string; cover_photo_id: string | null }>(
          'SELECT id, cover_photo_id FROM photo_collections WHERE id = $1 FOR UPDATE',
          [collectionId]
        );

        if (collectionResult.rowCount === 0) {
          throw new Error('Photo collection not found.');
        }

        for (const photo of photos) {
          await this.insertPhoto(client, photo);
        }

        const currentCoverPhotoId = collectionResult.rows[0]?.cover_photo_id ?? null;
        const nextCoverPhotoId = currentCoverPhotoId ?? photos[0]?.id ?? null;
        await client.query(
          `
            UPDATE photo_collections
            SET cover_photo_id = $2,
                updated_at = $3::timestamptz
            WHERE id = $1
          `,
          [collectionId, nextCoverPhotoId, updatedAt]
        );
      });

      for (const photo of photos) {
        this.photoById.set(photo.id, photo);
      }
      this.photoIdsByCollectionId.set(collectionId, [...existingPhotoIds, ...photos.map((photo) => photo.id)]);
      const updatedCollection = this.createCollectionSummary({
        ...currentCollection,
        coverPhotoId: currentCollection.coverPhotoId ?? photos[0]?.id ?? null,
        updatedAt
      });
      this.collectionById.set(collectionId, updatedCollection);

      return {
        collection: clonePhotoCollection(updatedCollection),
        photos: photos.map(clonePhoto)
      };
    });
  }

  async incrementCollectionViewCount(collectionId: string): Promise<PhotoCollection | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoCollectionWriteKey(collectionId), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      if (!currentCollection) {
        return undefined;
      }

      const updatedCollection = this.createCollectionSummary({
        ...currentCollection,
        viewCount: currentCollection.viewCount + 1,
        lastViewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const updated = await this.updatePhotoCollectionCounters(this.options.pool, updatedCollection);
      if (!updated) {
        this.collectionById.delete(collectionId);
        this.photoIdsByCollectionId.delete(collectionId);
        return undefined;
      }

      this.collectionById.set(collectionId, updatedCollection);
      return clonePhotoCollection(updatedCollection);
    });
  }

  async incrementPhotoViewCount(photoId: string): Promise<Photo | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoWriteKey(photoId), async () => {
      const currentPhoto = this.photoById.get(photoId);
      if (!currentPhoto) {
        return undefined;
      }

      const updatedPhoto = {
        ...currentPhoto,
        viewCount: currentPhoto.viewCount + 1,
        lastViewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const updated = await this.updatePhotoCounters(this.options.pool, updatedPhoto);
      if (!updated) {
        this.photoById.delete(photoId);
        this.photoIdsByCollectionId.set(
          currentPhoto.collectionId,
          (this.photoIdsByCollectionId.get(currentPhoto.collectionId) ?? []).filter((id) => id !== photoId)
        );
        this.refreshCollectionSummaryInCache(currentPhoto.collectionId);
        return undefined;
      }

      this.photoById.set(photoId, updatedPhoto);
      this.refreshCollectionSummaryInCache(currentPhoto.collectionId);
      return clonePhoto(updatedPhoto);
    });
  }

  async setPhotoFavorite(photoId: string, isFavorite: boolean): Promise<PhotoFavoriteUpdateResult | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoWriteKey(photoId), async () => {
      const currentPhoto = this.photoById.get(photoId);
      if (!currentPhoto) {
        return undefined;
      }

      if (currentPhoto.isFavorite === isFavorite) {
        const currentCollection = this.collectionById.get(currentPhoto.collectionId);
        return currentCollection
          ? {
              photo: clonePhoto(currentPhoto),
              collection: clonePhotoCollection(currentCollection)
            }
          : undefined;
      }

      const updatedPhoto = {
        ...currentPhoto,
        isFavorite,
        updatedAt: new Date().toISOString()
      };
      const persistedPhoto = await this.updatePhotoFavoriteRow(this.options.pool, updatedPhoto);
      if (!persistedPhoto) {
        this.photoById.delete(photoId);
        this.photoIdsByCollectionId.set(
          currentPhoto.collectionId,
          (this.photoIdsByCollectionId.get(currentPhoto.collectionId) ?? []).filter((id) => id !== photoId)
        );
        this.refreshCollectionSummaryInCache(currentPhoto.collectionId);
        return undefined;
      }

      this.photoById.set(photoId, persistedPhoto);
      this.refreshCollectionSummaryInCache(persistedPhoto.collectionId);
      const updatedCollection = this.collectionById.get(persistedPhoto.collectionId);
      return updatedCollection
        ? {
            photo: clonePhoto(persistedPhoto),
            collection: clonePhotoCollection(updatedCollection)
          }
        : undefined;
    });
  }

  async updatePhotoThumbnail(
    photoId: string,
    input: UpdatePhotoThumbnailInput
  ): Promise<Photo | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoWriteKey(photoId), async () => {
      const currentPhoto = this.photoById.get(photoId);
      if (!currentPhoto) {
        return undefined;
      }

      const updatedPhoto = {
        ...currentPhoto,
        thumbnailRelativePath: input.thumbnailRelativePath,
        thumbnailMimeType: input.thumbnailMimeType,
        thumbnailSizeBytes: normalizeNonNegativeInteger(input.thumbnailSizeBytes),
        thumbnailWidth: normalizeNullablePositiveDimension(input.thumbnailWidth),
        thumbnailHeight: normalizeNullablePositiveDimension(input.thumbnailHeight),
        updatedAt: new Date().toISOString()
      };

      const persistedPhoto = await this.updatePhotoThumbnailRow(this.options.pool, updatedPhoto);
      if (!persistedPhoto) {
        this.photoById.delete(photoId);
        this.photoIdsByCollectionId.set(
          currentPhoto.collectionId,
          (this.photoIdsByCollectionId.get(currentPhoto.collectionId) ?? []).filter((id) => id !== photoId)
        );
        this.refreshCollectionSummaryInCache(currentPhoto.collectionId);
        return undefined;
      }

      this.photoById.set(photoId, persistedPhoto);
      this.refreshCollectionSummaryInCache(persistedPhoto.collectionId);
      return clonePhoto(persistedPhoto);
    });
  }

  async deleteCollection(collectionId: string): Promise<DeletePhotoCollectionResult | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoCollectionWriteKey(collectionId), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      if (!currentCollection) {
        return undefined;
      }

      const photos = this.getCollectionPhotos(collectionId);
      const result = await this.options.pool.query<{ id: string }>(
        'DELETE FROM photo_collections WHERE id = $1 RETURNING id',
        [collectionId]
      );

      if (result.rowCount === 0) {
        this.collectionById.delete(collectionId);
        this.photoIdsByCollectionId.delete(collectionId);
        return undefined;
      }

      this.collectionById.delete(collectionId);
      this.photoIdsByCollectionId.delete(collectionId);
      for (const photo of photos) {
        this.photoById.delete(photo.id);
      }

      return {
        collection: clonePhotoCollection(currentCollection),
        photos: photos.map(clonePhoto)
      };
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
          COUNT(pct.collection_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_tags t
        JOIN photo_collection_tags pct ON pct.tag_id = t.id
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
          COUNT(pct.collection_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_tags t
        JOIN photo_collection_tags pct ON pct.tag_id = t.id
        GROUP BY t.id, t.label, t.normalized_label, t.created_at, t.updated_at
        ORDER BY usage_count DESC, lower(t.label) ASC
        LIMIT $1
      `,
      [safeLimit]
    );

    return result.rows.map(hydrateCatalogTagFromRow);
  }

  async addCollectionTag(collectionId: string, label: string): Promise<PhotoCollection | undefined> {
    this.assertInitialized();

    const normalizedLabel = normalizeCatalogTagKey(label);
    const displayLabel = normalizeCatalogTagLabel(label);
    if (displayLabel === '' || normalizedLabel === '') {
      return this.findCollectionById(collectionId);
    }

    return this.enqueueWrite(this.getPhotoTagsWriteKey(), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      if (!currentCollection) {
        return undefined;
      }

      const tag = await withTransaction(this.options.pool, async (client) => {
        const collectionResult = await client.query<{ id: string }>(
          'SELECT id FROM photo_collections WHERE id = $1 FOR UPDATE',
          [collectionId]
        );

        if (collectionResult.rowCount === 0) {
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
            INSERT INTO photo_collection_tags (collection_id, tag_id, created_at)
            VALUES ($1, $2, now())
            ON CONFLICT (collection_id, tag_id) DO NOTHING
          `,
          [collectionId, tagId]
        );

        return await this.fetchPhotoTagSummary(client, tagId);
      });

      const latestCollection = this.collectionById.get(collectionId);
      if (!latestCollection) {
        return undefined;
      }

      if (!tag) {
        this.collectionById.delete(collectionId);
        this.photoIdsByCollectionId.delete(collectionId);
        return undefined;
      }

      this.syncPhotoTagUsageInCache(tag);
      const updatedCollection = this.createCollectionSummary({
        ...latestCollection,
        tags: this.upsertTagInList(latestCollection.tags, tag)
      });
      this.collectionById.set(collectionId, updatedCollection);
      return clonePhotoCollection(updatedCollection);
    });
  }

  async removeCollectionTag(collectionId: string, tagId: string): Promise<PhotoCollection | undefined> {
    this.assertInitialized();

    return this.enqueueWrite(this.getPhotoTagsWriteKey(), async () => {
      const currentCollection = this.collectionById.get(collectionId);
      if (!currentCollection) {
        return undefined;
      }

      const result = await withTransaction(this.options.pool, async (client) => {
        const collectionResult = await client.query<{ id: string }>(
          'SELECT id FROM photo_collections WHERE id = $1 FOR UPDATE',
          [collectionId]
        );

        if (collectionResult.rowCount === 0) {
          return {
            collectionStillExists: false,
            deleted: false,
            tag: null as CatalogTag | null
          };
        }

        const deleteResult = await client.query<{ tag_id: string }>(
          `
            DELETE FROM photo_collection_tags
            WHERE collection_id = $1 AND tag_id = $2
            RETURNING tag_id
          `,
          [collectionId, tagId]
        );

        return {
          collectionStillExists: true,
          deleted: (deleteResult.rowCount ?? 0) > 0,
          tag: await this.fetchPhotoTagSummary(client, tagId)
        };
      });

      if (!result.collectionStillExists) {
        this.collectionById.delete(collectionId);
        this.photoIdsByCollectionId.delete(collectionId);
        return undefined;
      }

      const latestCollection = this.collectionById.get(collectionId);
      if (!latestCollection) {
        return undefined;
      }

      if (!result.deleted) {
        return clonePhotoCollection(latestCollection);
      }

      const updatedCollection = this.createCollectionSummary({
        ...latestCollection,
        tags: latestCollection.tags.filter((candidate) => candidate.id !== tagId)
      });
      this.collectionById.set(collectionId, updatedCollection);

      if (result.tag && result.tag.usageCount > 0) {
        this.syncPhotoTagUsageInCache(result.tag);
      } else {
        this.removeTagFromAllCachedCollections(tagId);
      }

      return clonePhotoCollection(updatedCollection);
    });
  }

  private async initializeInternal(): Promise<void> {
    await bootstrapPhotoCatalogSchema(this.options.pool);

    const [collectionsResult, photosResult, tagsResult, homeStripsResult] = await Promise.all([
      this.options.pool.query<PhotoCollectionRow>(
        `
          SELECT
            id,
            name,
            normalized_name,
            description,
            cover_photo_id,
            thumbnail_source_photo_id,
            thumbnail_relative_path,
            thumbnail_mime_type,
            thumbnail_size_bytes,
            thumbnail_width,
            thumbnail_height,
            view_count,
            last_viewed_at,
            created_at,
            updated_at
          FROM photo_collections
          ORDER BY created_at DESC
        `
      ),
      this.options.pool.query<PhotoRow>(
        `
          SELECT
            id,
            collection_id,
            original_name,
            stored_name,
            relative_path,
            mime_type,
            size_bytes,
            checksum_sha256,
            width,
            height,
            thumbnail_relative_path,
            thumbnail_mime_type,
            thumbnail_size_bytes,
            thumbnail_width,
            thumbnail_height,
            sort_order,
            view_count,
            last_viewed_at,
            is_favorite,
            created_at,
            updated_at
          FROM photos
          ORDER BY collection_id ASC, sort_order ASC, created_at ASC
        `
      ),
      this.options.pool.query<PhotoCollectionTagHydrationRow>(
        `
          SELECT
            pct.collection_id,
            t.id,
            t.label,
            t.normalized_label,
            COUNT(pct2.collection_id) AS usage_count,
            t.created_at,
            t.updated_at
          FROM photo_collection_tags pct
          JOIN catalog_tags t ON t.id = pct.tag_id
          LEFT JOIN photo_collection_tags pct2 ON pct2.tag_id = t.id
          GROUP BY pct.collection_id, t.id, t.label, t.normalized_label, t.created_at, t.updated_at
          ORDER BY lower(t.label) ASC
        `
      ),
      this.options.pool.query<PhotoHomeStripRow>(
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
          FROM photo_home_strips
          ORDER BY display_order ASC, created_at ASC
        `
      )
    ]);

    this.collectionById.clear();
    this.photoById.clear();
    this.homeStripById.clear();
    this.photoIdsByCollectionId.clear();

    for (const row of collectionsResult.rows) {
      const collection = hydratePhotoCollectionFromRow(row);
      this.collectionById.set(collection.id, collection);
      this.photoIdsByCollectionId.set(collection.id, []);
    }

    for (const row of photosResult.rows) {
      const photo = hydratePhotoFromRow(row);
      this.photoById.set(photo.id, photo);
      const photoIds = this.photoIdsByCollectionId.get(photo.collectionId) ?? [];
      photoIds.push(photo.id);
      this.photoIdsByCollectionId.set(photo.collectionId, photoIds);
    }

    for (const row of tagsResult.rows) {
      const collection = this.collectionById.get(row.collection_id);
      if (!collection) {
        continue;
      }

      collection.tags = this.upsertTagInList(collection.tags, hydrateCatalogTagFromRow(row));
    }

    for (const row of homeStripsResult.rows) {
      const strip = hydratePhotoHomeStripFromRow(row);
      this.homeStripById.set(strip.id, strip);
    }

    for (const collectionId of Array.from(this.collectionById.keys())) {
      this.refreshCollectionSummaryInCache(collectionId);
    }

    this.initialized = true;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('Photo catalog store has not been initialized.');
    }
  }

  private getCollectionPhotos(collectionId: string): Photo[] {
    return (this.photoIdsByCollectionId.get(collectionId) ?? [])
      .map((photoId) => this.photoById.get(photoId))
      .filter((photo): photo is Photo => photo !== undefined)
      .sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }

        return left.createdAt.localeCompare(right.createdAt);
      });
  }

  private createCollectionSummary(collection: PhotoCollection): PhotoCollection {
    const photos = this.getCollectionPhotos(collection.id);
    const coverPhoto =
      (collection.coverPhotoId ? this.photoById.get(collection.coverPhotoId) ?? null : null) ??
      photos[0] ??
      null;

    return {
      ...collection,
      coverPhotoId: coverPhoto?.id ?? collection.coverPhotoId ?? null,
      coverPhoto: coverPhoto ? clonePhoto(coverPhoto) : null,
      photoCount: photos.length,
      favoritePhotoIds: photos.filter((photo) => photo.isFavorite).map((photo) => photo.id),
      totalSizeBytes: photos.reduce((total, photo) => total + photo.sizeBytes, 0),
      tags: normalizeCatalogTags(collection.tags)
    };
  }

  private refreshCollectionSummaryInCache(collectionId: string): void {
    const collection = this.collectionById.get(collectionId);
    if (!collection) {
      return;
    }

    this.collectionById.set(collectionId, this.createCollectionSummary(collection));
  }

  private normalizeTagLimit(limit: number | null | undefined, fallback: number): number {
    if (limit === null || limit === undefined || !Number.isFinite(limit)) {
      return fallback;
    }

    return Math.max(1, Math.min(50, Math.floor(limit)));
  }

  private upsertTagInList(tags: CatalogTag[], tag: CatalogTag): CatalogTag[] {
    const normalizedTag = normalizeCatalogTag(tag);
    return normalizeCatalogTags([
      ...tags.filter(
        (candidate) =>
          candidate.id !== normalizedTag.id && candidate.normalizedLabel !== normalizedTag.normalizedLabel
      ),
      normalizedTag
    ]);
  }

  private syncPhotoTagUsageInCache(tag: CatalogTag): void {
    const normalizedTag = normalizeCatalogTag(tag);

    for (const collection of this.collectionById.values()) {
      if (!collection.tags.some((candidate) => candidate.id === normalizedTag.id)) {
        continue;
      }

      this.collectionById.set(
        collection.id,
        this.createCollectionSummary({
          ...collection,
          tags: this.upsertTagInList(collection.tags, normalizedTag)
        })
      );
    }
  }

  private removeTagFromAllCachedCollections(tagId: string): void {
    for (const collection of this.collectionById.values()) {
      if (!collection.tags.some((candidate) => candidate.id === tagId)) {
        continue;
      }

      this.collectionById.set(
        collection.id,
        this.createCollectionSummary({
          ...collection,
          tags: collection.tags.filter((candidate) => candidate.id !== tagId)
        })
      );
    }
  }

  private async fetchPhotoTagSummary(queryable: Queryable, tagId: string): Promise<CatalogTag | null> {
    const result = await queryable.query<CatalogTagRow>(
      `
        SELECT
          t.id,
          t.label,
          t.normalized_label,
          COUNT(pct.collection_id) AS usage_count,
          t.created_at,
          t.updated_at
        FROM catalog_tags t
        LEFT JOIN photo_collection_tags pct ON pct.tag_id = t.id
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

  private getPhotoCollectionWriteKey(collectionId: string): string {
    return `photo-collection:${collectionId}`;
  }

  private getPhotoWriteKey(photoId: string): string {
    return `photo:${photoId}`;
  }

  private getPhotoCollectionsWriteKey(): string {
    return 'photo-collections';
  }

  private getPhotoTagsWriteKey(): string {
    return 'photo-tags';
  }

  private getPhotoHomeStripsWriteKey(): string {
    return 'photo-home-strips';
  }

  private getSortedHomeStrips(): PhotoHomeStrip[] {
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

      const updatedStrip = normalizePhotoHomeStrip({
        ...strip,
        displayOrder: index,
        updatedAt: now
      });
      await this.updatePhotoHomeStripRow(queryable, updatedStrip);
      this.homeStripById.set(updatedStrip.id, updatedStrip);
    }
  }

  private async insertPhotoHomeStrip(queryable: Queryable, strip: PhotoHomeStrip): Promise<void> {
    await queryable.query(
      `
        INSERT INTO photo_home_strips (
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

  private async updatePhotoHomeStripRow(
    queryable: Queryable,
    strip: PhotoHomeStrip
  ): Promise<PhotoHomeStrip | undefined> {
    const result = await queryable.query<{ id: string }>(
      `
        UPDATE photo_home_strips
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

  private async insertPhotoCollection(queryable: Queryable, collection: PhotoCollection): Promise<void> {
    await queryable.query(
      `
        INSERT INTO photo_collections (
          id,
          name,
          normalized_name,
          description,
          cover_photo_id,
          thumbnail_source_photo_id,
          thumbnail_relative_path,
          thumbnail_mime_type,
          thumbnail_size_bytes,
          thumbnail_width,
          thumbnail_height,
          view_count,
          last_viewed_at,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12, $13::timestamptz, $14::timestamptz, $15::timestamptz
        )
      `,
      [
        collection.id,
        collection.name,
        collection.normalizedName,
        collection.description,
        collection.coverPhotoId,
        collection.thumbnailSourcePhotoId,
        collection.thumbnailRelativePath,
        collection.thumbnailMimeType,
        collection.thumbnailSizeBytes,
        collection.thumbnailWidth,
        collection.thumbnailHeight,
        collection.viewCount,
        collection.lastViewedAt,
        collection.createdAt,
        collection.updatedAt
      ]
    );
  }

  private async updatePhotoCollectionRow(
    queryable: Queryable,
    collection: PhotoCollection
  ): Promise<PhotoCollection | undefined> {
    const result = await queryable.query<PhotoCollectionRow>(
      `
        UPDATE photo_collections
        SET name = $2,
            normalized_name = $3,
            description = $4,
            cover_photo_id = $5,
            updated_at = $6::timestamptz
        WHERE id = $1
        RETURNING
          id,
          name,
          normalized_name,
          description,
          cover_photo_id,
          thumbnail_source_photo_id,
          thumbnail_relative_path,
          thumbnail_mime_type,
          thumbnail_size_bytes,
          thumbnail_width,
          thumbnail_height,
          view_count,
          last_viewed_at,
          created_at,
          updated_at
      `,
      [
        collection.id,
        collection.name,
        collection.normalizedName,
        collection.description,
        collection.coverPhotoId,
        collection.updatedAt
      ]
    );

    return result.rows[0] ? hydratePhotoCollectionFromRow(result.rows[0]) : undefined;
  }

  private async updatePhotoCollectionCounters(
    queryable: Queryable,
    collection: PhotoCollection
  ): Promise<boolean> {
    const result = await queryable.query<{ id: string }>(
      `
        UPDATE photo_collections
        SET view_count = $2,
            last_viewed_at = $3::timestamptz,
            updated_at = $4::timestamptz
        WHERE id = $1
        RETURNING id
      `,
      [collection.id, collection.viewCount, collection.lastViewedAt, collection.updatedAt]
    );

    return (result.rowCount ?? 0) > 0;
  }

  private async updatePhotoCollectionCoverPhotoRow(
    queryable: Queryable,
    collection: PhotoCollection
  ): Promise<PhotoCollection | undefined> {
    const result = await queryable.query<PhotoCollectionRow>(
      `
        UPDATE photo_collections pc
        SET cover_photo_id = $2,
            thumbnail_source_photo_id = $3,
            thumbnail_relative_path = $4,
            thumbnail_mime_type = $5,
            thumbnail_size_bytes = $6,
            thumbnail_width = $7,
            thumbnail_height = $8,
            updated_at = $9::timestamptz
        WHERE pc.id = $1
          AND EXISTS (
            SELECT 1
            FROM photos p
            WHERE p.id = $2
              AND p.collection_id = pc.id
          )
        RETURNING
          id,
          name,
          normalized_name,
          description,
          cover_photo_id,
          thumbnail_source_photo_id,
          thumbnail_relative_path,
          thumbnail_mime_type,
          thumbnail_size_bytes,
          thumbnail_width,
          thumbnail_height,
          view_count,
          last_viewed_at,
          created_at,
          updated_at
      `,
      [
        collection.id,
        collection.coverPhotoId,
        collection.thumbnailSourcePhotoId,
        collection.thumbnailRelativePath,
        collection.thumbnailMimeType,
        collection.thumbnailSizeBytes,
        collection.thumbnailWidth,
        collection.thumbnailHeight,
        collection.updatedAt
      ]
    );

    return result.rows[0] ? hydratePhotoCollectionFromRow(result.rows[0]) : undefined;
  }

  private async insertPhoto(queryable: Queryable, photo: Photo): Promise<void> {
    await queryable.query(
      `
        INSERT INTO photos (
          id,
          collection_id,
          original_name,
          stored_name,
          relative_path,
          mime_type,
          size_bytes,
          checksum_sha256,
          width,
          height,
          thumbnail_relative_path,
          thumbnail_mime_type,
          thumbnail_size_bytes,
          thumbnail_width,
          thumbnail_height,
          sort_order,
          view_count,
          last_viewed_at,
          is_favorite,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18::timestamptz,
          $19,
          $20::timestamptz,
          $21::timestamptz
        )
      `,
      [
        photo.id,
        photo.collectionId,
        photo.originalName,
        photo.storedName,
        photo.relativePath,
        photo.mimeType,
        photo.sizeBytes,
        photo.checksumSha256,
        photo.width,
        photo.height,
        photo.thumbnailRelativePath,
        photo.thumbnailMimeType,
        photo.thumbnailSizeBytes,
        photo.thumbnailWidth,
        photo.thumbnailHeight,
        photo.sortOrder,
        photo.viewCount,
        photo.lastViewedAt,
        photo.isFavorite,
        photo.createdAt,
        photo.updatedAt
      ]
    );
  }

  private async updatePhotoThumbnailRow(queryable: Queryable, photo: Photo): Promise<Photo | undefined> {
    const result = await queryable.query<PhotoRow>(
      `
        UPDATE photos
        SET thumbnail_relative_path = $2,
            thumbnail_mime_type = $3,
            thumbnail_size_bytes = $4,
            thumbnail_width = $5,
            thumbnail_height = $6,
            updated_at = $7::timestamptz
        WHERE id = $1
        RETURNING
          id,
          collection_id,
          original_name,
          stored_name,
          relative_path,
          mime_type,
          size_bytes,
          checksum_sha256,
          width,
          height,
          thumbnail_relative_path,
          thumbnail_mime_type,
          thumbnail_size_bytes,
          thumbnail_width,
          thumbnail_height,
          sort_order,
          view_count,
          last_viewed_at,
          is_favorite,
          created_at,
          updated_at
      `,
      [
        photo.id,
        photo.thumbnailRelativePath,
        photo.thumbnailMimeType,
        photo.thumbnailSizeBytes,
        photo.thumbnailWidth,
        photo.thumbnailHeight,
        photo.updatedAt
      ]
    );

    return result.rows[0] ? hydratePhotoFromRow(result.rows[0]) : undefined;
  }

  private async updatePhotoFavoriteRow(queryable: Queryable, photo: Photo): Promise<Photo | undefined> {
    const result = await queryable.query<PhotoRow>(
      `
        UPDATE photos
        SET is_favorite = $2,
            updated_at = $3::timestamptz
        WHERE id = $1
        RETURNING
          id,
          collection_id,
          original_name,
          stored_name,
          relative_path,
          mime_type,
          size_bytes,
          checksum_sha256,
          width,
          height,
          thumbnail_relative_path,
          thumbnail_mime_type,
          thumbnail_size_bytes,
          thumbnail_width,
          thumbnail_height,
          sort_order,
          view_count,
          last_viewed_at,
          is_favorite,
          created_at,
          updated_at
      `,
      [photo.id, photo.isFavorite, photo.updatedAt]
    );

    return result.rows[0] ? hydratePhotoFromRow(result.rows[0]) : undefined;
  }

  private async updatePhotoCounters(queryable: Queryable, photo: Photo): Promise<boolean> {
    const result = await queryable.query<{ id: string }>(
      `
        UPDATE photos
        SET view_count = $2,
            last_viewed_at = $3::timestamptz,
            updated_at = $4::timestamptz
        WHERE id = $1
        RETURNING id
      `,
      [photo.id, photo.viewCount, photo.lastViewedAt, photo.updatedAt]
    );

    return (result.rowCount ?? 0) > 0;
  }
}
