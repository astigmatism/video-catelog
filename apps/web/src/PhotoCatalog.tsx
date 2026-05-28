import type {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FocusEvent as ReactFocusEvent,
  FormEvent,
  ImgHTMLAttributes,
  JSX,
  ReactNode,
  RefObject,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
  WheelEvent as ReactWheelEvent
} from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type PhotoCatalogTag = {
  id: string;
  label: string;
  normalizedLabel: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Photo = {
  id: string;
  collectionId: string;
  originalName: string;
  storedName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  width: number | null;
  height: number | null;
  thumbnailRelativePath: string | null;
  thumbnailMimeType: string | null;
  thumbnailSizeBytes: number | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  sortOrder: number;
  viewCount: number;
  lastViewedAt: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PhotoCollection = {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  coverPhotoId: string | null;
  coverPhoto: Photo | null;
  thumbnailSourcePhotoId: string | null;
  thumbnailRelativePath: string | null;
  thumbnailMimeType: string | null;
  thumbnailSizeBytes: number | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  photoCount: number;
  favoritePhotoIds: string[];
  totalSizeBytes: number;
  viewCount: number;
  lastViewedAt: string | null;
  tags: PhotoCatalogTag[];
  createdAt: string;
  updatedAt: string;
};

export type PhotoCollectionDetailPayload = {
  collection: PhotoCollection;
  photos: Photo[];
};

export type PhotoCollectionSortCategory =
  | 'none'
  | 'createdAt'
  | 'name'
  | 'photoCount'
  | 'lastViewedAt'
  | 'viewCount'
  | 'random';

export type PhotoCollectionSortDirection = 'asc' | 'desc';

export type PhotoHomeStripRowCount = 1 | 2 | 3;

export type PhotoHomeStrip = {
  id: string;
  name: string;
  displayOrder: number;
  rowCount: PhotoHomeStripRowCount;
  sortCategory: PhotoCollectionSortCategory;
  sortDirection: PhotoCollectionSortDirection;
  search: string | null;
  tagIds: string[];
  excludedTagIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PhotoCollectionFilters = {
  search: string;
  sortCategory: PhotoCollectionSortCategory;
  sortDirection: PhotoCollectionSortDirection;
  tagSearch: string;
  selectedTagIds: string[];
  excludedTagIds: string[];
  randomSeed: number;
};

export const PHOTO_COLLECTION_SORT_CATEGORY_LABELS: Record<PhotoCollectionSortCategory, string> = {
  none: '',
  createdAt: 'Date added',
  name: 'Name',
  photoCount: 'Photo count',
  lastViewedAt: 'Last viewed',
  viewCount: 'View count',
  random: 'Randomized'
};

function createPhotoCollectionRandomSeed(): number {
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

export function createNextPhotoCollectionRandomSeed(currentSeed: number): number {
  const nextSeed = createPhotoCollectionRandomSeed();
  return nextSeed === currentSeed ? (nextSeed + 1) >>> 0 : nextSeed;
}

export function getDefaultPhotoCollectionFilters(): PhotoCollectionFilters {
  return {
    search: '',
    sortCategory: 'none',
    sortDirection: 'desc',
    tagSearch: '',
    selectedTagIds: [],
    excludedTagIds: [],
    randomSeed: createPhotoCollectionRandomSeed()
  };
}

type PhotoGridSortCategory = 'name' | 'views' | 'resolution' | 'file_size' | 'random';

type PhotoGridSortDirection = 'asc' | 'desc';

const PHOTO_GRID_SORT_CATEGORY_LABELS: Record<PhotoGridSortCategory, string> = {
  name: 'Name',
  views: 'Views',
  resolution: 'Resolution',
  file_size: 'File size',
  random: 'Randomized'
};

function createPhotoGridRandomSeed(): number {
  return createPhotoCollectionRandomSeed();
}

function createNextPhotoGridRandomSeed(currentSeed: number): number {
  return createNextPhotoCollectionRandomSeed(currentSeed);
}

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

type PhotoNotice = {
  tone: NoticeTone;
  text: string;
};

type PhotoHomeStripMoveDirection = 'up' | 'down';

export type PhotoCatalogViewProps = {
  collections: PhotoCollection[];
  selectedCollectionId: string | null;
  viewerPhotoId: string | null;
  isActive: boolean;
  attemptFullscreenOnOpen: boolean;
  photoFavoritesBrowseRequestId?: number;
  homeStrips?: PhotoHomeStrip[];
  isHomeViewActive?: boolean;
  onReturnHome?: () => void;
  onMoveHomeStrip?: (stripId: string, direction: PhotoHomeStripMoveDirection) => void;
  onEditHomeStrip?: (strip: PhotoHomeStrip) => void;
  onDeleteHomeStrip?: (strip: PhotoHomeStrip) => void;
  onSelectCollection: (collectionId: string) => void;
  onBackToCollections: () => void;
  onOpenPhoto: (photoId: string) => void;
  onClosePhotoViewer: () => void;
  onOpenImport: () => void;
  onRefresh: () => Promise<void> | void;
  filters: PhotoCollectionFilters;
  onCollectionUpdated: (collection: PhotoCollection) => void;
  onCollectionDeleted: (collectionId: string) => void;
  onTagsChanged?: () => Promise<void> | void;
  onUnauthorized: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function joinClassNames(...classNames: Array<string | false | null | undefined>): string {
  return classNames
    .filter((className): className is string => typeof className === 'string' && className.trim() !== '')
    .join(' ');
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNullablePositiveNumber(value: unknown): number | null {
  const parsed = readNumber(value, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function readIsoString(value: unknown, fallback = new Date(0).toISOString()): string {
  if (typeof value === 'string' && value.trim() !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  return fallback;
}

function readNullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }

  return null;
}

function hydratePhotoCatalogTag(value: unknown): PhotoCatalogTag | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id).trim();
  const label = readString(value.label).trim();
  if (!id || !label) {
    return null;
  }

  const createdAt = readIsoString(value.createdAt);
  return {
    id,
    label,
    normalizedLabel: readString(value.normalizedLabel, label.toLowerCase()),
    usageCount: Math.max(0, Math.floor(readNumber(value.usageCount))),
    createdAt,
    updatedAt: readIsoString(value.updatedAt, createdAt)
  };
}

export function hydratePhoto(value: unknown): Photo | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id).trim();
  const collectionId = readString(value.collectionId).trim();
  const originalName = readString(value.originalName).trim();
  if (!id || !collectionId || !originalName) {
    return null;
  }

  const createdAt = readIsoString(value.createdAt);
  return {
    id,
    collectionId,
    originalName,
    storedName: readString(value.storedName),
    relativePath: readString(value.relativePath),
    mimeType: readString(value.mimeType, 'image/jpeg'),
    sizeBytes: Math.max(0, Math.floor(readNumber(value.sizeBytes))),
    checksumSha256: readString(value.checksumSha256),
    width: readNullablePositiveNumber(value.width),
    height: readNullablePositiveNumber(value.height),
    thumbnailRelativePath: readNullableString(value.thumbnailRelativePath),
    thumbnailMimeType: readNullableString(value.thumbnailMimeType),
    thumbnailSizeBytes: readNullablePositiveNumber(value.thumbnailSizeBytes),
    thumbnailWidth: readNullablePositiveNumber(value.thumbnailWidth),
    thumbnailHeight: readNullablePositiveNumber(value.thumbnailHeight),
    sortOrder: Math.max(0, Math.floor(readNumber(value.sortOrder))),
    viewCount: Math.max(0, Math.floor(readNumber(value.viewCount))),
    lastViewedAt: readNullableIsoString(value.lastViewedAt),
    isFavorite: readBoolean(value.isFavorite),
    createdAt,
    updatedAt: readIsoString(value.updatedAt, createdAt)
  };
}

export function hydratePhotoCollection(value: unknown): PhotoCollection | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id).trim();
  const name = readString(value.name).trim();
  if (!id || !name) {
    return null;
  }

  const createdAt = readIsoString(value.createdAt);
  const coverPhoto = hydratePhoto(value.coverPhoto);
  const rawTags = Array.isArray(value.tags) ? value.tags : [];
  const rawFavoritePhotoIds = Array.isArray(value.favoritePhotoIds) ? value.favoritePhotoIds : [];

  return {
    id,
    name,
    normalizedName: readString(value.normalizedName, name.toLowerCase()),
    description: readNullableString(value.description),
    coverPhotoId: readNullableString(value.coverPhotoId),
    coverPhoto,
    thumbnailSourcePhotoId: readNullableString(value.thumbnailSourcePhotoId),
    thumbnailRelativePath: readNullableString(value.thumbnailRelativePath),
    thumbnailMimeType: readNullableString(value.thumbnailMimeType),
    thumbnailSizeBytes: readNullablePositiveNumber(value.thumbnailSizeBytes),
    thumbnailWidth: readNullablePositiveNumber(value.thumbnailWidth),
    thumbnailHeight: readNullablePositiveNumber(value.thumbnailHeight),
    photoCount: Math.max(0, Math.floor(readNumber(value.photoCount))),
    favoritePhotoIds: uniqueStrings(
      rawFavoritePhotoIds
        .filter((photoId): photoId is string => typeof photoId === 'string')
        .map((photoId) => photoId.trim())
    ),
    totalSizeBytes: Math.max(0, Math.floor(readNumber(value.totalSizeBytes))),
    viewCount: Math.max(0, Math.floor(readNumber(value.viewCount))),
    lastViewedAt: readNullableIsoString(value.lastViewedAt),
    tags: rawTags.map(hydratePhotoCatalogTag).filter((tag): tag is PhotoCatalogTag => tag !== null),
    createdAt,
    updatedAt: readIsoString(value.updatedAt, createdAt)
  };
}

export function parsePhotoCollectionsPayload(payload: unknown): PhotoCollection[] {
  if (!isRecord(payload) || !Array.isArray(payload.collections)) {
    return [];
  }

  return payload.collections
    .map(hydratePhotoCollection)
    .filter((collection): collection is PhotoCollection => collection !== null);
}

function isPhotoCollectionSortCategory(value: string): value is PhotoCollectionSortCategory {
  return Object.prototype.hasOwnProperty.call(PHOTO_COLLECTION_SORT_CATEGORY_LABELS, value);
}

function isPhotoCollectionSortDirection(value: string): value is PhotoCollectionSortDirection {
  return value === 'asc' || value === 'desc';
}

function normalizePhotoHomeStripRowCount(value: unknown): PhotoHomeStripRowCount {
  const parsed = Math.floor(readNumber(value, 1));
  return parsed === 2 || parsed === 3 ? parsed : 1;
}

export function hydratePhotoHomeStrip(value: unknown): PhotoHomeStrip | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id).trim();
  const name = readString(value.name).trim();
  const displayOrder = readNumber(value.displayOrder, Number.NaN);
  const sortCategory = readString(value.sortCategory);
  const sortDirection = readString(value.sortDirection);
  const rawTagIds = Array.isArray(value.tagIds) ? value.tagIds : null;
  const rawExcludedTagIds =
    value.excludedTagIds === undefined || value.excludedTagIds === null
      ? []
      : Array.isArray(value.excludedTagIds)
        ? value.excludedTagIds
        : null;
  const search = value.search === null || value.search === undefined ? null : readString(value.search).trim();
  const createdAt = readIsoString(value.createdAt, '');
  const updatedAt = readIsoString(value.updatedAt, createdAt);

  if (
    !id ||
    !name ||
    !Number.isFinite(displayOrder) ||
    !isPhotoCollectionSortCategory(sortCategory) ||
    !isPhotoCollectionSortDirection(sortDirection) ||
    (value.search !== null && value.search !== undefined && typeof value.search !== 'string') ||
    rawTagIds === null ||
    rawExcludedTagIds === null ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const tagIds = uniqueStrings(
    rawTagIds.filter((tagId): tagId is string => typeof tagId === 'string').map((tagId) => tagId.trim())
  );
  const excludedTagIds = uniqueStrings(
    rawExcludedTagIds
      .filter((tagId): tagId is string => typeof tagId === 'string')
      .map((tagId) => tagId.trim())
  );
  if (
    tagIds.length !== rawTagIds.filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '').length ||
    excludedTagIds.length !==
      rawExcludedTagIds.filter((candidate) => typeof candidate === 'string' && candidate.trim() !== '').length
  ) {
    return null;
  }

  return {
    id,
    name,
    displayOrder: Math.max(0, Math.floor(displayOrder)),
    rowCount: normalizePhotoHomeStripRowCount(value.rowCount),
    sortCategory,
    sortDirection,
    search: search && search !== '' ? search : null,
    tagIds,
    excludedTagIds,
    createdAt,
    updatedAt
  };
}

export function parsePhotoHomeStripsPayload(payload: unknown): PhotoHomeStrip[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.strips)) {
    return null;
  }

  const strips = payload.strips
    .map(hydratePhotoHomeStrip)
    .filter((strip): strip is PhotoHomeStrip => strip !== null);

  return strips.length === payload.strips.length ? strips : null;
}

export function parsePhotoCollectionDetailPayload(payload: unknown): PhotoCollectionDetailPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const collection = hydratePhotoCollection(payload.collection);
  if (!collection) {
    return null;
  }

  const photos = Array.isArray(payload.photos)
    ? payload.photos.map(hydratePhoto).filter((photo): photo is Photo => photo !== null)
    : [];

  return { collection, photos };
}

function parsePhotoCollectionUpdatePayload(payload: unknown): PhotoCollection | null {
  if (!isRecord(payload)) {
    return null;
  }

  return hydratePhotoCollection(payload.collection);
}

function parsePhotoUpdatePayload(payload: unknown): Photo | null {
  if (!isRecord(payload)) {
    return null;
  }

  return hydratePhoto(payload.photo);
}

type PhotoFavoriteUpdatePayload = {
  photo: Photo;
  collection: PhotoCollection | null;
};

function parsePhotoFavoriteUpdatePayload(payload: unknown): PhotoFavoriteUpdatePayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const photo = hydratePhoto(payload.photo);
  if (!photo) {
    return null;
  }

  return {
    photo,
    collection: hydratePhotoCollection(payload.collection)
  };
}

export function parsePhotoCatalogTagsPayload(payload: unknown): PhotoCatalogTag[] {
  if (!isRecord(payload) || !Array.isArray(payload.tags)) {
    return [];
  }

  return payload.tags.map(hydratePhotoCatalogTag).filter((tag): tag is PhotoCatalogTag => tag !== null);
}

async function fetchJson(endpoint: string, init: RequestInit | undefined, onUnauthorized: () => void): Promise<unknown> {
  const response = await fetch(endpoint, init);
  if (response.status === 401) {
    onUnauthorized();
    throw new Error('Your session expired.');
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === 'string' ? payload.message : 'Request failed.';
    throw new Error(message);
  }

  return payload;
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

type PhotoFavoriteState = Record<string, string[]>;

type PhotoFavoriteTagSummary = {
  tag: PhotoCatalogTag;
  photoCount: number;
  collectionCount: number;
};

type PhotoFavoriteOverview = {
  photoCount: number;
  collectionCount: number;
  tags: PhotoFavoriteTagSummary[];
};

type FavoritePhotoEntry = {
  photo: Photo;
  collection: PhotoCollection;
};

type FavoriteCollectionDetailsState = Record<string, PhotoCollectionDetailPayload>;

function getFavoritePhotoIdsForCollection(favorites: PhotoFavoriteState, collectionId: string): string[] {
  return uniqueStrings(favorites[collectionId] ?? []);
}

function getFavoritePhotoCountForCollection(favorites: PhotoFavoriteState, collectionId: string): number {
  return getFavoritePhotoIdsForCollection(favorites, collectionId).length;
}

function doesPhotoCollectionHaveTag(collection: PhotoCollection, tagId: string | null): boolean {
  return tagId === null || collection.tags.some((tag) => tag.id === tagId);
}

function createPhotoFavoriteOverview(collections: PhotoCollection[], favorites: PhotoFavoriteState): PhotoFavoriteOverview {
  const favoriteTagsById = new Map<string, PhotoFavoriteTagSummary>();
  let photoCount = 0;
  let collectionCount = 0;

  for (const collection of collections) {
    const collectionFavoriteCount = getFavoritePhotoCountForCollection(favorites, collection.id);
    if (collectionFavoriteCount === 0) {
      continue;
    }

    photoCount += collectionFavoriteCount;
    collectionCount += 1;

    for (const tag of collection.tags) {
      const existingSummary = favoriteTagsById.get(tag.id);
      if (existingSummary) {
        existingSummary.photoCount += collectionFavoriteCount;
        existingSummary.collectionCount += 1;
        if (tag.usageCount > existingSummary.tag.usageCount) {
          existingSummary.tag = tag;
        }
      } else {
        favoriteTagsById.set(tag.id, {
          tag,
          photoCount: collectionFavoriteCount,
          collectionCount: 1
        });
      }
    }
  }

  return {
    photoCount,
    collectionCount,
    tags: Array.from(favoriteTagsById.values()).sort(
      (left, right) =>
        right.photoCount - left.photoCount ||
        right.collectionCount - left.collectionCount ||
        left.tag.label.localeCompare(right.tag.label, undefined, { sensitivity: 'base' })
    )
  };
}

function compareFavoritePhotoEntriesForGridSort(
  left: FavoritePhotoEntry,
  right: FavoritePhotoEntry,
  sortCategory: PhotoGridSortCategory
): number {
  return (
    comparePhotosForGridSort(left.photo, right.photo, sortCategory) ||
    left.collection.name.localeCompare(right.collection.name, undefined, { sensitivity: 'base' }) ||
    tieBreakPhotosForGridSort(left.photo, right.photo)
  );
}

function sortFavoritePhotoEntries(
  entries: FavoritePhotoEntry[],
  sortCategory: PhotoGridSortCategory,
  sortDirection: PhotoGridSortDirection,
  randomSeed: number
): FavoritePhotoEntry[] {
  const nextEntries = [...entries];

  if (sortCategory === 'random') {
    return nextEntries
      .map((entry) => ({
        entry,
        sortValue: getSeededPhotoGridRandomSortValue(entry.photo, randomSeed)
      }))
      .sort((left, right) => {
        if (left.sortValue !== right.sortValue) {
          return left.sortValue < right.sortValue ? -1 : 1;
        }

        return compareFavoritePhotoEntriesForGridSort(left.entry, right.entry, 'name');
      })
      .map(({ entry }) => entry);
  }

  return nextEntries.sort((left, right) => {
    const primaryComparison = compareFavoritePhotoEntriesForGridSort(left, right, sortCategory);
    return sortDirection === 'asc' ? primaryComparison : -primaryComparison;
  });
}

function doesFavoritePhotoEntryMatchSearch(entry: FavoritePhotoEntry, normalizedSearch: string): boolean {
  if (normalizedSearch === '') {
    return true;
  }

  const haystack = [
    entry.photo.originalName,
    entry.collection.name,
    entry.collection.description,
    ...entry.collection.tags.map((tag) => tag.label)
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedSearch);
}


const PHOTO_VIEWER_CONTROLS_AUTO_HIDE_DELAY_MS = 2000;
const PHOTO_VIEWER_DEFAULT_SLIDESHOW_DELAY_MS = 5000;
const PHOTO_VIEWER_MIN_SLIDESHOW_DELAY_MS = 1000;
const PHOTO_VIEWER_MAX_SLIDESHOW_DELAY_MS = 10000;
const PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS = 500;
const PHOTO_VIEWER_SLIDESHOW_DELAY_OPTIONS_MS = Array.from(
  { length: (PHOTO_VIEWER_MAX_SLIDESHOW_DELAY_MS - PHOTO_VIEWER_MIN_SLIDESHOW_DELAY_MS) / PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS + 1 },
  (_, index) => PHOTO_VIEWER_MIN_SLIDESHOW_DELAY_MS + index * PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS
);
const PHOTO_VIEWER_TRANSITION_DURATION_MS = 720;
const PHOTO_VIEWER_KEN_BURNS_VARIANTS = ['zoom-in', 'pan-right', 'pan-left', 'pan-down'] as const;
const PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_VARIANTS = [
  'zoom-in-drift-left',
  'zoom-in-drift-right',
  'zoom-out-drift-left',
  'zoom-out-drift-right',
  'zoom-in-drift-down',
  'zoom-out-drift-up'
] as const;
const PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_MIN_DURATION_MS = 3200;
const PHOTO_VIEWER_LAYOUT_SESSION_STORAGE_KEY = 'photoViewer.layout';
const PHOTO_VIEWER_FILM_STRIP_SIDE_FRAME_COUNT = 4;
const PHOTO_VIEWER_FILM_STRIP_MIN_GAP_PX = 6;
const PHOTO_VIEWER_FILM_STRIP_MAX_GAP_PX = 12;

type PhotoViewerStandardSlideshowMode = 'cut' | 'crossfade' | 'dissolve' | 'slide' | 'ken-burns';
type PhotoViewerFilmStripSlideshowMode = 'scroll' | 'ken-burns';
type PhotoViewerSlideshowMode = PhotoViewerStandardSlideshowMode | PhotoViewerFilmStripSlideshowMode;
type PhotoViewerLayoutMode = 'standard' | 'film-strip';
type PhotoViewerTransitionDirection = 'next' | 'previous';
type PhotoViewerKenBurnsVariant = (typeof PHOTO_VIEWER_KEN_BURNS_VARIANTS)[number];
type PhotoViewerFilmStripKenBurnsVariant = (typeof PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_VARIANTS)[number];

type PhotoViewerSlideshowModeOption<TMode extends PhotoViewerSlideshowMode = PhotoViewerSlideshowMode> = {
  value: TMode;
  label: string;
  description: string;
};

type PhotoViewerLayoutModeOption = {
  value: PhotoViewerLayoutMode;
  label: string;
  description: string;
};

const PHOTO_VIEWER_STANDARD_SLIDESHOW_MODE_OPTIONS: PhotoViewerSlideshowModeOption<PhotoViewerStandardSlideshowMode>[] = [
  {
    value: 'cut',
    label: 'Standard',
    description: 'Advance directly to the next photo with no animated transition.'
  },
  {
    value: 'crossfade',
    label: 'Crossfade',
    description: 'Smoothly fade between the outgoing and incoming photos.'
  },
  {
    value: 'dissolve',
    label: 'Dissolve',
    description: 'Use a soft dissolve with a subtle blur as each photo changes.'
  },
  {
    value: 'slide',
    label: 'Slide',
    description: 'Gently slide photos horizontally as the slideshow advances.'
  },
  {
    value: 'ken-burns',
    label: 'Ken Burns',
    description: 'Apply a slow, subtle pan and zoom while each slideshow photo is displayed.'
  }
];

const PHOTO_VIEWER_FILM_STRIP_SLIDESHOW_MODE_OPTIONS: PhotoViewerSlideshowModeOption<PhotoViewerFilmStripSlideshowMode>[] = [
  {
    value: 'scroll',
    label: 'Scroll',
    description: 'Advance through the filmstrip using the existing centered scrolling motion.'
  },
  {
    value: 'ken-burns',
    label: 'Ken Burns',
    description: 'Apply a slow, understated mix of pan, zoom-in, and zoom-out motion to the centered filmstrip photo.'
  }
];

const PHOTO_VIEWER_LAYOUT_MODE_OPTIONS: PhotoViewerLayoutModeOption[] = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Show only the current photo as the full-screen viewer focus.'
  },
  {
    value: 'film-strip',
    label: 'Filmstrip',
    description: 'Center the current photo with neighboring previous and next photos visible on each side.'
  }
];

const PHOTO_VIEWER_MIN_ZOOM = 1;
const PHOTO_VIEWER_MAX_ZOOM = 4;
const PHOTO_VIEWER_WHEEL_ZOOM_FACTOR = 1.12;
const PHOTO_VIEWER_MIN_WHEEL_ZOOM_STEPS = 0.5;
const PHOTO_VIEWER_MAX_WHEEL_ZOOM_STEPS = 3;
const PHOTO_COLLECTION_THUMBNAIL_CROP_MIN_SOURCE_SIZE = 32;
const PHOTO_COLLECTION_THUMBNAIL_CROP_INITIAL_SCALE = 0.82;
const PHOTO_COLLECTION_THUMBNAIL_CROP_KEYBOARD_NUDGE_PX = 12;
const PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_WIDTH = 4;
const PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_HEIGHT = 3;
const PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO =
  PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_WIDTH / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_HEIGHT;

type PhotoViewerFitMode = 'fit' | 'fill';

type PhotoViewerSize = {
  width: number;
  height: number;
};

type PhotoViewerPan = {
  x: number;
  y: number;
};

type PhotoThumbnailCropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PhotoThumbnailCropSelectionState = {
  photoId: string;
  crop: PhotoThumbnailCropBox;
};

type PhotoThumbnailCropResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

type PhotoThumbnailCropDragState = {
  pointerId: number;
  action: 'move' | 'resize';
  handle?: PhotoThumbnailCropResizeHandle;
  startClientX: number;
  startClientY: number;
  startCrop: PhotoThumbnailCropBox;
};

type PhotoThumbnailCropPreviousViewState = {
  layoutMode: PhotoViewerLayoutMode;
  fitMode: PhotoViewerFitMode;
  zoom: number;
  pan: PhotoViewerPan;
  wasSlideshowActive: boolean;
};

type PhotoViewerImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PhotoViewerTransitionState = {
  id: number;
  incomingPhotoId: string;
  outgoingPhoto: Photo;
  outgoingFrameStyle: CSSProperties;
  outgoingImageStyle: CSSProperties;
  direction: PhotoViewerTransitionDirection;
  mode: PhotoViewerStandardSlideshowMode;
};

type PhotoViewerFilmStripVirtualCenter = {
  photoId: string;
  orderedPhotoIds: string;
  virtualIndex: number;
};

type PhotoViewerFilmStripFrame = {
  key: string;
  photo: Photo;
  offset: number;
  distance: number;
  x: number;
  width: number;
  height: number;
  opacity: number;
  zIndex: number;
};

function formatPhotoViewerSlideDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0s';
  }

  return Number.isInteger(seconds) ? `${seconds}s` : `${Number(seconds.toFixed(1))}s`;
}

function describePhotoViewerSlideDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0 seconds';
  }

  const roundedSeconds = Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(1));
  return `${roundedSeconds} ${roundedSeconds === 1 ? 'second' : 'seconds'}`;
}

function clampPhotoViewerSlideshowDelayMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return PHOTO_VIEWER_DEFAULT_SLIDESHOW_DELAY_MS;
  }

  const snappedDurationMs = Math.round(durationMs / PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS) * PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS;
  return Math.max(
    PHOTO_VIEWER_MIN_SLIDESHOW_DELAY_MS,
    Math.min(PHOTO_VIEWER_MAX_SLIDESHOW_DELAY_MS, snappedDurationMs)
  );
}

function isPhotoViewerStandardSlideshowMode(value: string): value is PhotoViewerStandardSlideshowMode {
  return PHOTO_VIEWER_STANDARD_SLIDESHOW_MODE_OPTIONS.some((option) => option.value === value);
}

function isPhotoViewerFilmStripSlideshowMode(value: string): value is PhotoViewerFilmStripSlideshowMode {
  return PHOTO_VIEWER_FILM_STRIP_SLIDESHOW_MODE_OPTIONS.some((option) => option.value === value);
}

function getPhotoViewerStandardSlideshowModeOption(
  mode: PhotoViewerStandardSlideshowMode
): PhotoViewerSlideshowModeOption<PhotoViewerStandardSlideshowMode> {
  return PHOTO_VIEWER_STANDARD_SLIDESHOW_MODE_OPTIONS.find((option) => option.value === mode) ??
    PHOTO_VIEWER_STANDARD_SLIDESHOW_MODE_OPTIONS[0];
}

function getPhotoViewerFilmStripSlideshowModeOption(
  mode: PhotoViewerFilmStripSlideshowMode
): PhotoViewerSlideshowModeOption<PhotoViewerFilmStripSlideshowMode> {
  return PHOTO_VIEWER_FILM_STRIP_SLIDESHOW_MODE_OPTIONS.find((option) => option.value === mode) ??
    PHOTO_VIEWER_FILM_STRIP_SLIDESHOW_MODE_OPTIONS[0];
}

function isPhotoViewerLayoutMode(value: string): value is PhotoViewerLayoutMode {
  return PHOTO_VIEWER_LAYOUT_MODE_OPTIONS.some((option) => option.value === value);
}

function getPhotoViewerLayoutModeOption(mode: PhotoViewerLayoutMode): PhotoViewerLayoutModeOption {
  return PHOTO_VIEWER_LAYOUT_MODE_OPTIONS.find((option) => option.value === mode) ??
    PHOTO_VIEWER_LAYOUT_MODE_OPTIONS[0];
}

function getNextPhotoViewerLayoutMode(mode: PhotoViewerLayoutMode): PhotoViewerLayoutMode {
  const currentIndex = PHOTO_VIEWER_LAYOUT_MODE_OPTIONS.findIndex((option) => option.value === mode);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % PHOTO_VIEWER_LAYOUT_MODE_OPTIONS.length;
  return PHOTO_VIEWER_LAYOUT_MODE_OPTIONS[nextIndex]?.value ?? PHOTO_VIEWER_LAYOUT_MODE_OPTIONS[0].value;
}

function readPhotoViewerLayoutModeFromSession(): PhotoViewerLayoutMode {
  if (typeof window === 'undefined') {
    return 'standard';
  }

  try {
    const storedLayoutMode = window.sessionStorage.getItem(PHOTO_VIEWER_LAYOUT_SESSION_STORAGE_KEY);
    return storedLayoutMode && isPhotoViewerLayoutMode(storedLayoutMode) ? storedLayoutMode : 'standard';
  } catch {
    return 'standard';
  }
}

function writePhotoViewerLayoutModeToSession(mode: PhotoViewerLayoutMode): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(PHOTO_VIEWER_LAYOUT_SESSION_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures, such as private browsing or disabled session storage.
  }
}

function getPhotoViewerStableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getPhotoViewerKenBurnsVariant(photo: Photo): PhotoViewerKenBurnsVariant {
  return PHOTO_VIEWER_KEN_BURNS_VARIANTS[
    getPhotoViewerStableHash(photo.id || photo.originalName) % PHOTO_VIEWER_KEN_BURNS_VARIANTS.length
  ];
}

function getPhotoViewerFilmStripKenBurnsVariant(photo: Photo): PhotoViewerFilmStripKenBurnsVariant {
  const hashKey = `${photo.id}:${photo.checksumSha256 || photo.originalName}`;
  return PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_VARIANTS[
    getPhotoViewerStableHash(hashKey) % PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_VARIANTS.length
  ];
}

function getPhotoViewerFilmStripKenBurnsDurationMs(photo: Photo, baseDurationMs: number): number {
  const hash = getPhotoViewerStableHash(`${photo.collectionId}:${photo.id}:film-strip-ken-burns-duration`);
  const durationFactor = 1.06 + (hash % 5) * 0.03;
  return Math.round(Math.max(PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_MIN_DURATION_MS, baseDurationMs * durationFactor));
}

function capturePhotoViewerFrameTransformStyle(frameElement: HTMLDivElement | null): CSSProperties {
  if (frameElement === null || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return {};
  }

  const computedStyle = window.getComputedStyle(frameElement);
  const transform = computedStyle.transform;
  if (!transform || transform === 'none') {
    return {};
  }

  return {
    transform,
    transformOrigin: computedStyle.transformOrigin
  };
}

function PhotoViewerPreviousIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <path d="M7 5.5h2.2v13H7v-13Z" />
      <path d="M18 6.25 10.2 12 18 17.75V6.25Z" />
    </svg>
  );
}

function PhotoViewerNextIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <path d="M14.8 5.5H17v13h-2.2v-13Z" />
      <path d="M6 6.25 13.8 12 6 17.75V6.25Z" />
    </svg>
  );
}

function PhotoViewerPlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <path d="M8 6.5v11l8.5-5.5L8 6.5Z" />
    </svg>
  );
}

function PhotoViewerPauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="viewer-toolbar-solid-icon">
      <rect x="6.5" y="5.5" width="4" height="13" rx="1" />
      <rect x="13.5" y="5.5" width="4" height="13" rx="1" />
    </svg>
  );
}

function isPhotoViewerSlideDurationSelectTarget(target: EventTarget | null): boolean {
  if (typeof HTMLSelectElement === 'undefined') {
    return false;
  }

  return (
    target instanceof HTMLSelectElement &&
    (target.classList.contains('photo-viewer-slide-duration-select') ||
      target.classList.contains('photo-viewer-slideshow-style-select') ||
      target.classList.contains('photo-viewer-layout-select'))
  );
}

function isKeyboardEventFromInteractiveElement(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }

  return (
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="link"], [role="textbox"]'
    ) !== null
  );
}

function createPhotoFavoriteStateFromCollections(collections: PhotoCollection[]): PhotoFavoriteState {
  return collections.reduce<PhotoFavoriteState>((result, collection) => {
    const favoritePhotoIds = uniqueStrings(collection.favoritePhotoIds.map((photoId) => photoId.trim()));
    if (favoritePhotoIds.length > 0) {
      result[collection.id] = favoritePhotoIds;
    }

    return result;
  }, {});
}

function setFavoritePhotoIdsForCollection(
  favorites: PhotoFavoriteState,
  collectionId: string,
  photoIds: string[]
): PhotoFavoriteState {
  const normalizedPhotoIds = uniqueStrings(photoIds.map((photoId) => photoId.trim()).filter(Boolean));
  const nextFavorites = { ...favorites };

  if (normalizedPhotoIds.length > 0) {
    nextFavorites[collectionId] = normalizedPhotoIds;
  } else {
    delete nextFavorites[collectionId];
  }

  return nextFavorites;
}

function setPhotoFavoriteInState(favorites: PhotoFavoriteState, photo: Photo): PhotoFavoriteState {
  const currentPhotoIds = new Set(favorites[photo.collectionId] ?? []);
  if (photo.isFavorite) {
    currentPhotoIds.add(photo.id);
  } else {
    currentPhotoIds.delete(photo.id);
  }

  return setFavoritePhotoIdsForCollection(favorites, photo.collectionId, Array.from(currentPhotoIds));
}

function updateCollectionFavoritePhotoIds(collection: PhotoCollection, photo: Photo): PhotoCollection {
  if (collection.id !== photo.collectionId) {
    return collection;
  }

  const currentPhotoIds = new Set(collection.favoritePhotoIds);
  if (photo.isFavorite) {
    currentPhotoIds.add(photo.id);
  } else {
    currentPhotoIds.delete(photo.id);
  }

  return {
    ...collection,
    favoritePhotoIds: uniqueStrings(Array.from(currentPhotoIds))
  };
}

function updatePhotoInCollectionDetail(detail: PhotoCollectionDetailPayload, updatedPhoto: Photo): PhotoCollectionDetailPayload {
  if (detail.collection.id !== updatedPhoto.collectionId) {
    return detail;
  }

  return {
    collection: updateCollectionFavoritePhotoIds(detail.collection, updatedPhoto),
    photos: detail.photos.map((photo) => (photo.id === updatedPhoto.id ? updatedPhoto : photo))
  };
}

function normalizePhotoViewerDimension(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function clampPhotoViewerZoom(value: number): number {
  return Math.max(PHOTO_VIEWER_MIN_ZOOM, Math.min(PHOTO_VIEWER_MAX_ZOOM, Number(value.toFixed(3))));
}

function getPhotoViewerWheelZoom(currentZoom: number, deltaY: number, deltaMode: number, stageHeight: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return clampPhotoViewerZoom(currentZoom);
  }

  const stageHeightFallback = Number.isFinite(stageHeight) && stageHeight > 0 ? stageHeight : 800;
  const normalizedDelta =
    deltaMode === 1
      ? Math.abs(deltaY) * 16
      : deltaMode === 2
        ? Math.abs(deltaY) * stageHeightFallback
        : Math.abs(deltaY);
  const stepCount = Math.min(
    PHOTO_VIEWER_MAX_WHEEL_ZOOM_STEPS,
    Math.max(PHOTO_VIEWER_MIN_WHEEL_ZOOM_STEPS, normalizedDelta / 100)
  );
  const direction = deltaY < 0 ? 1 : -1;

  return clampPhotoViewerZoom(currentZoom * Math.pow(PHOTO_VIEWER_WHEEL_ZOOM_FACTOR, direction * stepCount));
}

function calculatePhotoViewerRenderedSize(
  naturalSize: PhotoViewerSize | null,
  stageSize: PhotoViewerSize,
  fitMode: PhotoViewerFitMode,
  zoom: number
): PhotoViewerSize | null {
  if (
    naturalSize === null ||
    naturalSize.width <= 0 ||
    naturalSize.height <= 0 ||
    stageSize.width <= 0 ||
    stageSize.height <= 0
  ) {
    return null;
  }

  const widthScale = stageSize.width / naturalSize.width;
  const heightScale = stageSize.height / naturalSize.height;
  const baseScale = fitMode === 'fit' ? Math.min(widthScale, heightScale) : Math.max(widthScale, heightScale);
  const safeScale = Number.isFinite(baseScale) && baseScale > 0 ? baseScale : 1;
  const safeZoom = clampPhotoViewerZoom(zoom);

  return {
    width: Math.max(1, naturalSize.width * safeScale * safeZoom),
    height: Math.max(1, naturalSize.height * safeScale * safeZoom)
  };
}

function calculatePhotoViewerPanLimit(
  renderedSize: PhotoViewerSize | null,
  stageSize: PhotoViewerSize
): PhotoViewerPan {
  return {
    x: renderedSize !== null ? Math.max(0, (renderedSize.width - stageSize.width) / 2) : 0,
    y: renderedSize !== null ? Math.max(0, (renderedSize.height - stageSize.height) / 2) : 0
  };
}

function calculatePhotoViewerImageRect(
  renderedSize: PhotoViewerSize | null,
  stageSize: PhotoViewerSize,
  pan: PhotoViewerPan
): PhotoViewerImageRect | null {
  if (!renderedSize || renderedSize.width <= 0 || renderedSize.height <= 0 || stageSize.width <= 0 || stageSize.height <= 0) {
    return null;
  }

  return {
    left: (stageSize.width - renderedSize.width) / 2 + pan.x,
    top: (stageSize.height - renderedSize.height) / 2 + pan.y,
    width: renderedSize.width,
    height: renderedSize.height
  };
}

function getPhotoThumbnailCropMaxWidth(naturalSize: PhotoViewerSize): number {
  return Math.max(
    1,
    Math.min(naturalSize.width, naturalSize.height * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO)
  );
}

function getPhotoThumbnailCropMinWidth(naturalSize: PhotoViewerSize): number {
  const maxWidth = getPhotoThumbnailCropMaxWidth(naturalSize);
  return Math.min(
    maxWidth,
    Math.max(1, PHOTO_COLLECTION_THUMBNAIL_CROP_MIN_SOURCE_SIZE * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO)
  );
}

function clampPhotoThumbnailCropBox(crop: PhotoThumbnailCropBox, naturalSize: PhotoViewerSize): PhotoThumbnailCropBox {
  const maxWidth = getPhotoThumbnailCropMaxWidth(naturalSize);
  const minWidth = getPhotoThumbnailCropMinWidth(naturalSize);
  const cropWidth = Number.isFinite(crop.width) ? crop.width : crop.height * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO;
  const width = Math.max(minWidth, Math.min(maxWidth, Number(cropWidth.toFixed(2))));
  const height = Number((width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO).toFixed(2));

  return {
    x: Math.max(0, Math.min(naturalSize.width - width, Number(crop.x.toFixed(2)))),
    y: Math.max(0, Math.min(naturalSize.height - height, Number(crop.y.toFixed(2)))),
    width,
    height
  };
}

type PhotoThumbnailCropRequest = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function createPhotoThumbnailCropRequest(
  crop: PhotoThumbnailCropBox,
  naturalSize: PhotoViewerSize
): PhotoThumbnailCropRequest {
  const clampedCrop = clampPhotoThumbnailCropBox(crop, naturalSize);
  const aspectScale = Math.max(
    1,
    Math.floor(
      Math.min(
        clampedCrop.width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_WIDTH,
        clampedCrop.height / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_HEIGHT
      )
    )
  );
  const width = aspectScale * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_WIDTH;
  const height = aspectScale * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_HEIGHT;

  return {
    left: Math.max(0, Math.min(Math.round(naturalSize.width - width), Math.round(clampedCrop.x + (clampedCrop.width - width) / 2))),
    top: Math.max(0, Math.min(Math.round(naturalSize.height - height), Math.round(clampedCrop.y + (clampedCrop.height - height) / 2))),
    width,
    height
  };
}

function createInitialPhotoThumbnailCropBox(naturalSize: PhotoViewerSize): PhotoThumbnailCropBox {
  const maxWidth = getPhotoThumbnailCropMaxWidth(naturalSize);
  const minWidth = getPhotoThumbnailCropMinWidth(naturalSize);
  const width = Math.max(minWidth, maxWidth * PHOTO_COLLECTION_THUMBNAIL_CROP_INITIAL_SCALE);
  const height = width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO;

  return clampPhotoThumbnailCropBox(
    {
      x: (naturalSize.width - width) / 2,
      y: (naturalSize.height - height) / 2,
      width,
      height
    },
    naturalSize
  );
}

function resizePhotoThumbnailCropBox(
  dragState: PhotoThumbnailCropDragState,
  deltaX: number,
  deltaY: number,
  naturalSize: PhotoViewerSize
): PhotoThumbnailCropBox {
  const { startCrop, handle } = dragState;
  if (!handle) {
    return clampPhotoThumbnailCropBox(startCrop, naturalSize);
  }

  const minWidth = getPhotoThumbnailCropMinWidth(naturalSize);

  if (handle === 'se') {
    const maxWidth = Math.min(
      naturalSize.width - startCrop.x,
      (naturalSize.height - startCrop.y) * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO
    );
    const widthDelta = Math.max(deltaX, deltaY * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO);
    const width = Math.max(minWidth, Math.min(maxWidth, startCrop.width + widthDelta));
    return clampPhotoThumbnailCropBox(
      { ...startCrop, width, height: width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO },
      naturalSize
    );
  }

  if (handle === 'nw') {
    const fixedRight = startCrop.x + startCrop.width;
    const fixedBottom = startCrop.y + startCrop.height;
    const maxWidth = Math.min(fixedRight, fixedBottom * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO);
    const widthDelta = Math.max(-deltaX, -deltaY * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO);
    const width = Math.max(minWidth, Math.min(maxWidth, startCrop.width + widthDelta));
    const height = width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO;
    return clampPhotoThumbnailCropBox({ x: fixedRight - width, y: fixedBottom - height, width, height }, naturalSize);
  }

  if (handle === 'ne') {
    const fixedLeft = startCrop.x;
    const fixedBottom = startCrop.y + startCrop.height;
    const maxWidth = Math.min(naturalSize.width - fixedLeft, fixedBottom * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO);
    const widthDelta = Math.max(deltaX, -deltaY * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO);
    const width = Math.max(minWidth, Math.min(maxWidth, startCrop.width + widthDelta));
    const height = width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO;
    return clampPhotoThumbnailCropBox({ x: fixedLeft, y: fixedBottom - height, width, height }, naturalSize);
  }

  const fixedRight = startCrop.x + startCrop.width;
  const fixedTop = startCrop.y;
  const maxWidth = Math.min(
    fixedRight,
    (naturalSize.height - fixedTop) * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO
  );
  const widthDelta = Math.max(-deltaX, deltaY * PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO);
  const width = Math.max(minWidth, Math.min(maxWidth, startCrop.width + widthDelta));
  const height = width / PHOTO_COLLECTION_THUMBNAIL_CROP_ASPECT_RATIO;
  return clampPhotoThumbnailCropBox({ x: fixedRight - width, y: fixedTop, width, height }, naturalSize);
}

function getPhotoViewerNaturalSizeFromPhoto(photo: Photo): PhotoViewerSize | null {
  const width = normalizePhotoViewerDimension(photo.width);
  const height = normalizePhotoViewerDimension(photo.height);

  return width !== null && height !== null ? { width, height } : null;
}

function calculatePhotoViewerContainedSize(
  naturalSize: PhotoViewerSize | null,
  bounds: PhotoViewerSize
): PhotoViewerSize {
  if (
    naturalSize === null ||
    naturalSize.width <= 0 ||
    naturalSize.height <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return {
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height)
    };
  }

  const scale = Math.min(bounds.width / naturalSize.width, bounds.height / naturalSize.height);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  return {
    width: Math.max(1, naturalSize.width * safeScale),
    height: Math.max(1, naturalSize.height * safeScale)
  };
}

function getPhotoViewerFilmStripNeighborScale(distance: number): number {
  if (distance <= 1) {
    return 0.88;
  }

  if (distance === 2) {
    return 0.74;
  }

  if (distance === 3) {
    return 0.62;
  }

  return 0.52;
}

function getPhotoViewerFilmStripFrameOpacity(distance: number): number {
  if (distance === 0) {
    return 1;
  }

  if (distance === 1) {
    return 0.72;
  }

  if (distance === 2) {
    return 0.44;
  }

  if (distance === 3) {
    return 0.26;
  }

  return 0.16;
}

function getPhotoViewerFilmStripFrameSize(
  photo: Photo,
  currentFrameSize: PhotoViewerSize,
  stageSize: PhotoViewerSize,
  offset: number
): PhotoViewerSize {
  const distance = Math.abs(offset);

  if (distance === 0) {
    return {
      width: Math.max(1, currentFrameSize.width),
      height: Math.max(1, currentFrameSize.height)
    };
  }

  const scale = getPhotoViewerFilmStripNeighborScale(distance);
  const naturalSize = getPhotoViewerNaturalSizeFromPhoto(photo);
  const neighborBounds = {
    width: Math.max(72, Math.min(stageSize.width * 0.5, currentFrameSize.width * (0.72 - Math.min(distance - 1, 3) * 0.08))),
    height: Math.max(72, currentFrameSize.height * scale)
  };

  return calculatePhotoViewerContainedSize(naturalSize, neighborBounds);
}

function wrapPhotoViewerFilmStripIndex(index: number, photoCount: number): number {
  return ((index % photoCount) + photoCount) % photoCount;
}

function buildPhotoViewerFilmStripFrames(
  photos: Photo[],
  currentVirtualIndex: number,
  currentFrameSize: PhotoViewerSize,
  stageSize: PhotoViewerSize
): PhotoViewerFilmStripFrame[] {
  if (photos.length === 0 || currentFrameSize.width <= 0 || currentFrameSize.height <= 0) {
    return [];
  }

  const sideFrameCount = Math.min(PHOTO_VIEWER_FILM_STRIP_SIDE_FRAME_COUNT, Math.max(0, photos.length - 1));
  const gap = Math.max(
    PHOTO_VIEWER_FILM_STRIP_MIN_GAP_PX,
    Math.min(PHOTO_VIEWER_FILM_STRIP_MAX_GAP_PX, stageSize.width * 0.012)
  );
  const framesByOffset = new Map<number, Omit<PhotoViewerFilmStripFrame, 'x' | 'opacity' | 'zIndex'>>();

  for (let offset = -sideFrameCount; offset <= sideFrameCount; offset += 1) {
    const virtualIndex = currentVirtualIndex + offset;
    const photo = photos[wrapPhotoViewerFilmStripIndex(virtualIndex, photos.length)];
    if (!photo) {
      continue;
    }

    const distance = Math.abs(offset);
    const frameSize = getPhotoViewerFilmStripFrameSize(photo, currentFrameSize, stageSize, offset);

    framesByOffset.set(offset, {
      key: `film-strip-${virtualIndex}-${photo.id}`,
      photo,
      offset,
      distance,
      width: frameSize.width,
      height: frameSize.height
    });
  }

  const getFrame = (offset: number): Omit<PhotoViewerFilmStripFrame, 'x' | 'opacity' | 'zIndex'> | null =>
    framesByOffset.get(offset) ?? null;
  const xPositions = new Map<number, number>();
  xPositions.set(0, 0);

  for (let offset = 1; offset <= sideFrameCount; offset += 1) {
    const previousFrame = getFrame(offset - 1);
    const currentFrame = getFrame(offset);
    const previousX = xPositions.get(offset - 1);
    if (!previousFrame || !currentFrame || previousX === undefined) {
      continue;
    }

    xPositions.set(offset, previousX + previousFrame.width / 2 + gap + currentFrame.width / 2);
  }

  for (let offset = -1; offset >= -sideFrameCount; offset -= 1) {
    const previousFrame = getFrame(offset + 1);
    const currentFrame = getFrame(offset);
    const previousX = xPositions.get(offset + 1);
    if (!previousFrame || !currentFrame || previousX === undefined) {
      continue;
    }

    xPositions.set(offset, previousX - previousFrame.width / 2 - gap - currentFrame.width / 2);
  }

  return Array.from(framesByOffset.values()).map((frame) => ({
    ...frame,
    x: xPositions.get(frame.offset) ?? 0,
    opacity: getPhotoViewerFilmStripFrameOpacity(frame.distance),
    zIndex: Math.max(1, 10 - frame.distance)
  }));
}


function clampPhotoViewerPan(pan: PhotoViewerPan, limit: PhotoViewerPan): PhotoViewerPan {
  return {
    x: limit.x > 0 ? Math.max(-limit.x, Math.min(limit.x, Number(pan.x.toFixed(2)))) : 0,
    y: limit.y > 0 ? Math.max(-limit.y, Math.min(limit.y, Number(pan.y.toFixed(2)))) : 0
  };
}

type PhotoImageSource = 'thumbnail' | 'original';

function normalizePhotoMimeType(value: string | null | undefined): string {
  return value?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function hasGifFileExtension(value: string | null | undefined): boolean {
  return (value ?? '').split(/[?#]/, 1)[0].trim().toLowerCase().endsWith('.gif');
}

function isGifPhoto(photo: Photo): boolean {
  return (
    normalizePhotoMimeType(photo.mimeType) === 'image/gif' ||
    hasGifFileExtension(photo.originalName) ||
    hasGifFileExtension(photo.storedName) ||
    hasGifFileExtension(photo.relativePath)
  );
}

function isGifThumbnail(photo: Photo): boolean {
  return (
    normalizePhotoMimeType(photo.thumbnailMimeType) === 'image/gif' ||
    hasGifFileExtension(photo.thumbnailRelativePath)
  );
}

function shouldUseOriginalGifHoverPreview(photo: Photo): boolean {
  return isGifPhoto(photo) && !isGifThumbnail(photo);
}

function getPhotoVersionToken(photo: Photo, source: PhotoImageSource): string {
  if (source === 'thumbnail') {
    return (
      photo.thumbnailRelativePath ||
      (photo.thumbnailSizeBytes ? String(photo.thumbnailSizeBytes) : '') ||
      photo.checksumSha256 ||
      photo.updatedAt ||
      photo.id
    );
  }

  return photo.checksumSha256 || photo.relativePath || photo.updatedAt || photo.id;
}

function getPhotoUrlCandidates(photo: Photo, source: PhotoImageSource): string[] {
  const photoId = encodeURIComponent(photo.id);
  const version = encodeURIComponent(getPhotoVersionToken(photo, source));

  if (source === 'thumbnail') {
    return uniqueStrings([
      `/api/photos/${photoId}/thumbnail?v=${version}`,
      `/media/photos/${photoId}/thumbnail?v=${version}`
    ]);
  }

  return uniqueStrings([
    `/api/photos/${photoId}/media?v=${version}`,
    `/media/photos/${photoId}?v=${version}`
  ]);
}

function getPhotoUrl(photo: Photo, source: PhotoImageSource): string {
  return getPhotoUrlCandidates(photo, source)[0] ?? '';
}

function getPhotoCollectionThumbnailUrl(collection: PhotoCollection): string | null {
  if (!collection.thumbnailRelativePath) {
    return null;
  }

  const version = encodeURIComponent(
    collection.thumbnailRelativePath ||
      (collection.thumbnailSizeBytes ? String(collection.thumbnailSizeBytes) : '') ||
      collection.updatedAt ||
      collection.id
  );
  return `/api/photos/collections/${encodeURIComponent(collection.id)}/thumbnail?v=${version}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Never';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function normalizePhotoTagLabel(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function normalizePhotoTagKey(value: string): string {
  return normalizePhotoTagLabel(value).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function comparePhotoCollectionsForSort(
  left: PhotoCollection,
  right: PhotoCollection,
  sortCategory: PhotoCollectionSortCategory
): number {
  switch (sortCategory) {
    case 'createdAt':
      return left.createdAt.localeCompare(right.createdAt);
    case 'name':
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    case 'photoCount':
      return left.photoCount - right.photoCount;
    case 'lastViewedAt':
      return (left.lastViewedAt ?? '').localeCompare(right.lastViewedAt ?? '');
    case 'viewCount':
      return left.viewCount - right.viewCount;
    case 'random':
      return 0;
    case 'none':
    default:
      return 0;
  }
}

function tieBreakPhotoCollections(left: PhotoCollection, right: PhotoCollection): number {
  return right.createdAt.localeCompare(left.createdAt) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function getSeededPhotoCollectionRandomSortValue(collection: PhotoCollection, seed: number): number {
  const key = `${collection.id}:${collection.createdAt}`;
  let hash = (seed ^ 0x811c9dc5) >>> 0;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function filterAndSortPhotoCollections(
  collections: PhotoCollection[],
  filters: PhotoCollectionFilters
): PhotoCollection[] {
  const normalizedSearch = filters.search.trim().toLowerCase();
  const selectedTags = new Set(filters.selectedTagIds);
  const excludedTags = new Set(filters.excludedTagIds);

  const filteredCollections = collections.filter((collection) => {
    const collectionTagIds = new Set(collection.tags.map((tag) => tag.id));
    if (selectedTags.size > 0 && !Array.from(selectedTags).every((tagId) => collectionTagIds.has(tagId))) {
      return false;
    }

    if (excludedTags.size > 0 && Array.from(excludedTags).some((tagId) => collectionTagIds.has(tagId))) {
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

  if (filters.sortCategory === 'none') {
    return filteredCollections;
  }

  if (filters.sortCategory === 'random') {
    return filteredCollections
      .map((collection) => ({
        collection,
        sortValue: getSeededPhotoCollectionRandomSortValue(collection, filters.randomSeed)
      }))
      .sort((left, right) => {
        if (left.sortValue !== right.sortValue) {
          return left.sortValue < right.sortValue ? -1 : 1;
        }

        return tieBreakPhotoCollections(left.collection, right.collection);
      })
      .map(({ collection }) => collection);
  }

  return [...filteredCollections].sort((left, right) => {
    const primaryComparison = comparePhotoCollectionsForSort(left, right, filters.sortCategory);
    const directedComparison = filters.sortDirection === 'asc' ? primaryComparison : -primaryComparison;
    return directedComparison || tieBreakPhotoCollections(left, right);
  });
}

function getPhotoHomeStripRandomSeed(strip: PhotoHomeStrip, randomSeed: number): number {
  let hash = (randomSeed ^ 0x811c9dc5) >>> 0;

  for (let index = 0; index < strip.id.length; index += 1) {
    hash ^= strip.id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash >>> 0;
}

function getPhotoHomeStripCollections(
  strip: PhotoHomeStrip,
  collections: PhotoCollection[],
  randomSeed: number
): PhotoCollection[] {
  return filterAndSortPhotoCollections(collections, {
    search: strip.search ?? '',
    sortCategory: strip.sortCategory,
    sortDirection: strip.sortDirection,
    tagSearch: '',
    selectedTagIds: strip.tagIds,
    excludedTagIds: strip.excludedTagIds,
    randomSeed: getPhotoHomeStripRandomSeed(strip, randomSeed)
  });
}

const PHOTO_HOME_STRIP_MIN_ITEMS_PER_ROW = 1;
const PHOTO_HOME_STRIP_EAGER_THUMBNAIL_SECTION_LIMIT = 2;
const PHOTO_HOME_STRIP_CARD_MIN_WIDTH_FALLBACK_PX = 260;
const PHOTO_HOME_STRIP_COLUMN_GAP_FALLBACK_PX = 16;

function readCssPixelValue(value: string, fallbackValue: number): number {
  const parsedValue = Number.parseFloat(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

function getPhotoHomeStripItemsPerRow(gridElement: HTMLElement): number {
  const computedStyle = window.getComputedStyle(gridElement);
  const horizontalPadding =
    readCssPixelValue(computedStyle.paddingLeft, 0) + readCssPixelValue(computedStyle.paddingRight, 0);
  const availableWidth = Math.max(0, gridElement.getBoundingClientRect().width - horizontalPadding);

  if (availableWidth <= 0) {
    return PHOTO_HOME_STRIP_MIN_ITEMS_PER_ROW;
  }

  const cardMinWidth = Math.max(
    1,
    readCssPixelValue(
      computedStyle.getPropertyValue('--home-strip-card-min-width'),
      PHOTO_HOME_STRIP_CARD_MIN_WIDTH_FALLBACK_PX
    )
  );
  const columnGap = Math.max(
    0,
    readCssPixelValue(computedStyle.columnGap, PHOTO_HOME_STRIP_COLUMN_GAP_FALLBACK_PX)
  );

  return Math.max(
    PHOTO_HOME_STRIP_MIN_ITEMS_PER_ROW,
    Math.floor((availableWidth + columnGap) / (cardMinWidth + columnGap))
  );
}

type PhotoHomeStripView = {
  strip: PhotoHomeStrip;
  collections: PhotoCollection[];
};

function comparePhotosByName(left: Photo, right: Photo): number {
  return left.originalName.localeCompare(right.originalName, undefined, { sensitivity: 'base' });
}

function normalizePhotoDimensionPixels(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function getPhotoResolutionPixelCount(photo: Photo): number {
  const width = normalizePhotoDimensionPixels(photo.width);
  const height = normalizePhotoDimensionPixels(photo.height);
  return width > 0 && height > 0 ? width * height : 0;
}

function comparePhotosForGridSort(
  left: Photo,
  right: Photo,
  sortCategory: PhotoGridSortCategory
): number {
  switch (sortCategory) {
    case 'views':
      return left.viewCount - right.viewCount;
    case 'resolution':
      return getPhotoResolutionPixelCount(left) - getPhotoResolutionPixelCount(right);
    case 'file_size':
      return left.sizeBytes - right.sizeBytes;
    case 'random':
      return 0;
    case 'name':
    default:
      return comparePhotosByName(left, right);
  }
}

function tieBreakPhotosForGridSort(left: Photo, right: Photo): number {
  return comparePhotosByName(left, right) || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

function getSeededPhotoGridRandomSortValue(photo: Photo, seed: number): number {
  const key = `${photo.collectionId}:${photo.id}:${photo.originalName}:${photo.sortOrder}`;
  let hash = (seed ^ 0x811c9dc5) >>> 0;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  hash = Math.imul(hash ^ (hash >>> 16), 2246822507) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function sortPhotos(
  photos: Photo[],
  sortCategory: PhotoGridSortCategory,
  sortDirection: PhotoGridSortDirection,
  randomSeed: number
): Photo[] {
  const nextPhotos = [...photos];

  if (sortCategory === 'random') {
    return nextPhotos
      .map((photo) => ({
        photo,
        sortValue: getSeededPhotoGridRandomSortValue(photo, randomSeed)
      }))
      .sort((left, right) => {
        if (left.sortValue !== right.sortValue) {
          return left.sortValue < right.sortValue ? -1 : 1;
        }

        return tieBreakPhotosForGridSort(left.photo, right.photo);
      })
      .map(({ photo }) => photo);
  }

  return nextPhotos.sort((left, right) => {
    const primaryComparison = comparePhotosForGridSort(left, right, sortCategory);
    const directedComparison = sortDirection === 'asc' ? primaryComparison : -primaryComparison;
    return directedComparison || tieBreakPhotosForGridSort(left, right);
  });
}

function PhotoTagPill({ tag, onRemove }: { tag: PhotoCatalogTag; onRemove?: () => void }): JSX.Element {
  return (
    <span className="photo-tag-pill">
      <span>{tag.label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${tag.label} tag`}>
          ×
        </button>
      ) : null}
    </span>
  );
}

function EmptyPhotoCover(): JSX.Element {
  return (
    <div className="photo-cover-placeholder" aria-hidden="true">
      <span>Photos</span>
    </div>
  );
}

type PhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  photo: Photo;
  source?: PhotoImageSource;
};

function PhotoImage({ photo, alt, onError, source = 'thumbnail', ...imageProps }: PhotoImageProps): JSX.Element {
  const urlCandidates = useMemo(() => getPhotoUrlCandidates(photo, source), [
    photo.id,
    photo.relativePath,
    photo.checksumSha256,
    photo.updatedAt,
    photo.thumbnailRelativePath,
    photo.thumbnailSizeBytes,
    source
  ]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [
    photo.id,
    photo.relativePath,
    photo.checksumSha256,
    photo.updatedAt,
    photo.thumbnailRelativePath,
    photo.thumbnailSizeBytes,
    source
  ]);

  const imageUrl = urlCandidates[candidateIndex] ?? getPhotoUrl(photo, source);
  const imageElementKey =
    source === 'original' && isGifPhoto(photo)
      ? `original-gif-${photo.id}-${getPhotoVersionToken(photo, 'original')}`
      : undefined;

  return (
    <img
      key={imageElementKey}
      {...imageProps}
      src={imageUrl}
      alt={alt ?? ''}
      onError={(event) => {
        onError?.(event);
        setCandidateIndex((currentIndex) =>
          currentIndex < urlCandidates.length - 1 ? currentIndex + 1 : currentIndex
        );
      }}
    />
  );
}

function PhotoCatalogInfoIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v5.7" />
      <path d="M12 7.5h.01" />
    </svg>
  );
}

function PhotoCatalogTagIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.8 5.2h7.4l7 7a1.8 1.8 0 0 1 0 2.5l-4.5 4.5a1.8 1.8 0 0 1-2.5 0l-7-7V5.2Z" />
      <circle cx="8.3" cy="8.4" r="1.2" />
    </svg>
  );
}

function PhotoCatalogTrashIcon(): JSX.Element {
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

type PhotoCatalogModalProps = {
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  disableClose?: boolean;
};

function PhotoCatalogModal({
  title,
  titleId,
  onClose,
  children,
  disableClose = false
}: PhotoCatalogModalProps): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: Event): void {
      if (event instanceof KeyboardEvent && event.key === 'Escape' && !disableClose) {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [disableClose, onClose]);

  const handleBackdropClick = (): void => {
    if (!disableClose) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event: ReactMouseEvent<HTMLDivElement>) => event.stopPropagation()}
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

type PhotoCollectionDetailsModalProps = {
  collection: PhotoCollection;
  onClose: () => void;
  onDelete: (collection: PhotoCollection) => Promise<boolean>;
};

function PhotoCollectionDetailsModal({
  collection,
  onClose,
  onDelete
}: PhotoCollectionDetailsModalProps): JSX.Element {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const coverPhoto = collection.coverPhoto;
  const coverPhotoSummary = coverPhoto
    ? `${coverPhoto.originalName}${coverPhoto.width && coverPhoto.height ? ` · ${coverPhoto.width}×${coverPhoto.height}` : ''}`
    : 'No cover photo available';

  useEffect(() => {
    setIsConfirmingDelete(false);
    setIsDeleting(false);
    setDeleteError('');
  }, [collection.id]);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    setDeleteError('');

    const deleted = await onDelete(collection);
    if (!deleted) {
      setDeleteError('Unable to delete this photo collection. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <PhotoCatalogModal
      title="Collection details"
      titleId="photo-collection-details-title"
      onClose={onClose}
      disableClose={isDeleting}
    >
      <div className="details-modal-layout photo-collection-details-modal">
        <section className="details-summary-panel" aria-label="Photo collection summary">
          <div>
            <h3 title={collection.name}>{collection.name}</h3>
            <p>Photo collection statistics and catalog details.</p>
          </div>
          <div className="details-summary-badges">
            <span className="status-badge status-ready">{pluralize(collection.photoCount, 'photo')}</span>
          </div>
        </section>

        {collection.description ? (
          <section className="photo-collection-details-description" aria-label="Collection description">
            <h3>Description</h3>
            <p>{collection.description}</p>
          </section>
        ) : null}

        <dl className="details-meta-list">
          <div>
            <dt>Photos</dt>
            <dd>{collection.photoCount}</dd>
          </div>
          <div>
            <dt>Total size</dt>
            <dd>{formatBytes(collection.totalSizeBytes)}</dd>
          </div>
          <div>
            <dt>Views</dt>
            <dd>{collection.viewCount}</dd>
          </div>
          <div>
            <dt>Last viewed</dt>
            <dd>{formatDate(collection.lastViewedAt)}</dd>
          </div>
          <div>
            <dt>Date added</dt>
            <dd>{formatDate(collection.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(collection.updatedAt)}</dd>
          </div>
          <div>
            <dt>Cover photo</dt>
            <dd>{coverPhotoSummary}</dd>
          </div>
          <div>
            <dt>Tags</dt>
            <dd>{collection.tags.length}</dd>
          </div>
        </dl>

        <section className="photo-collection-details-tags" aria-label="Collection tags">
          <h3>Tags</h3>
          {collection.tags.length > 0 ? (
            <div className="photo-tag-row">
              {collection.tags.map((tag) => (
                <PhotoTagPill key={tag.id} tag={tag} />
              ))}
            </div>
          ) : (
            <p className="photo-empty-inline">No tags yet.</p>
          )}
        </section>

        <section className="details-danger-zone" aria-labelledby="photo-collection-details-delete-title">
          <div>
            <h3 id="photo-collection-details-delete-title">Delete collection</h3>
            <p>
              Delete removes this photo collection from the catalog and cleans up all photos,
              thumbnails, metadata, and tag associations inside it.
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
              disabled={isDeleting}
            >
              <PhotoCatalogTrashIcon />
              <span>Delete collection</span>
            </button>
          ) : (
            <div className="details-delete-confirmation">
              <p>
                Delete “{collection.name}” and all {pluralize(collection.photoCount, 'photo')} inside it
                permanently from this catalog?
              </p>
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
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="app-button danger"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </PhotoCatalogModal>
  );
}

type PhotoCollectionTagPopoverProps = {
  collection: PhotoCollection;
  popoverId: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  onAddTag: (collectionId: string, label: string) => Promise<PhotoCollection | null>;
  onRemoveTag: (collectionId: string, tagId: string) => Promise<PhotoCollection | null>;
  onSearchTags: (query: string) => Promise<PhotoCatalogTag[]>;
};

function getPhotoTagSuggestionOptionId(collectionId: string, tagId: string): string {
  return `photo-tag-suggestion-${collectionId}-${tagId}`;
}

function PhotoCollectionTagPopover({
  collection,
  popoverId,
  popoverRef,
  onAddTag,
  onRemoveTag,
  onSearchTags
}: PhotoCollectionTagPopoverProps): JSX.Element {
  const [tagInput, setTagInput] = useState('');
  const [suggestions, setSuggestions] = useState<PhotoCatalogTag[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const inputId = `photo-tag-input-${collection.id}`;
  const suggestionListId = `photo-tag-suggestions-${collection.id}`;

  const normalizedExistingTags = useMemo(
    () => new Set(collection.tags.map((tag) => normalizePhotoTagKey(tag.normalizedLabel || tag.label))),
    [collection.tags]
  );

  const visibleSuggestions = useMemo(() => {
    const selectedTagIds = new Set(collection.tags.map((tag) => tag.id));
    return suggestions.filter(
      (tag) => !selectedTagIds.has(tag.id) && !normalizedExistingTags.has(normalizePhotoTagKey(tag.normalizedLabel || tag.label))
    );
  }, [collection.tags, normalizedExistingTags, suggestions]);

  const activeSuggestion =
    highlightedSuggestionIndex >= 0 ? visibleSuggestions[highlightedSuggestionIndex] ?? null : null;
  const activeSuggestionId = activeSuggestion
    ? getPhotoTagSuggestionOptionId(collection.id, activeSuggestion.id)
    : undefined;

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
    const normalizedLabel = normalizePhotoTagLabel(label);
    const normalizedKey = normalizePhotoTagKey(normalizedLabel);

    if (normalizedLabel === '' || normalizedKey === '') {
      setError('Enter a tag name first.');
      focusTagInputSoon();
      return;
    }

    if (normalizedExistingTags.has(normalizedKey)) {
      setError('This collection already has that tag.');
      focusTagInputSoon();
      return;
    }

    setIsBusy(true);
    setError('');
    const updatedCollection = await onAddTag(collection.id, normalizedLabel);
    setIsBusy(false);

    if (!updatedCollection) {
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
    const updatedCollection = await onRemoveTag(collection.id, tagId);
    setIsBusy(false);

    if (!updatedCollection) {
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
      className="tag-management-popover photo-collection-tag-popover"
      ref={popoverRef}
      role="dialog"
      aria-label={`Manage tags for ${collection.name}`}
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
                id={getPhotoTagSuggestionOptionId(collection.id, tag.id)}
                className={`tag-management-suggestion${isHighlighted ? ' is-highlighted' : ''}`}
                key={tag.id}
                role="option"
                aria-selected={isHighlighted}
                disabled={isBusy}
                onMouseDown={(event: ReactMouseEvent<HTMLButtonElement>) => event.preventDefault()}
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
        {collection.tags.length > 0 ? (
          collection.tags.map((tag) => (
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

type PhotoCollectionCardProps = {
  collection: PhotoCollection;
  contextKey?: string;
  thumbnailLoading?: 'eager' | 'lazy';
  onSelect: (collectionId: string) => void;
  onOpenInfo: (collectionId: string) => void;
  onAddTag: (collectionId: string, label: string) => Promise<PhotoCollection | null>;
  onRemoveTag: (collectionId: string, tagId: string) => Promise<PhotoCollection | null>;
  onSearchTags: (query: string) => Promise<PhotoCatalogTag[]>;
};

function PhotoCollectionCard({
  collection,
  contextKey,
  thumbnailLoading,
  onSelect,
  onOpenInfo,
  onAddTag,
  onRemoveTag,
  onSearchTags
}: PhotoCollectionCardProps): JSX.Element {
  const [isTagPopoverOpen, setIsTagPopoverOpen] = useState(false);
  const tagControlRef = useRef<HTMLDivElement | null>(null);
  const tagPopoverRef = useRef<HTMLDivElement | null>(null);
  const coverPhoto = collection.coverPhoto;
  const collectionThumbnailUrl = getPhotoCollectionThumbnailUrl(collection);
  const cardSubtitle = `${pluralize(collection.photoCount, 'photo')} · ${formatBytes(collection.totalSizeBytes)} · ${pluralize(
    collection.viewCount,
    'view'
  )}`;
  const tagPopoverId = `photo-tag-management-popover-${contextKey ? `${contextKey}-` : ''}${collection.id}`;

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
    <article className={`photo-collection-card${isTagPopoverOpen ? ' is-tag-popover-open' : ''}`}>
      <button
        type="button"
        className="photo-collection-card-button"
        onClick={() => onSelect(collection.id)}
        aria-label={`Open ${collection.name}`}
        title={`Open ${collection.name}`}
      >
        <div className="photo-collection-cover">
          {collectionThumbnailUrl ? (
            <img
              className="photo-collection-thumbnail-image"
              src={collectionThumbnailUrl}
              alt=""
              loading={thumbnailLoading ?? 'lazy'}
              decoding="async"
            />
          ) : coverPhoto ? (
            <PhotoImage photo={coverPhoto} source="thumbnail" alt="" loading={thumbnailLoading ?? 'lazy'} />
          ) : (
            <EmptyPhotoCover />
          )}
        </div>
      </button>

      <div className="photo-collection-card-body card-body">
        <div className="card-header-row photo-collection-card-header-row">
          <div className="card-title-block photo-collection-card-title-block">
            <h3 title={collection.name}>{collection.name}</h3>
            <p className="card-subtitle photo-collection-card-subtitle" title={cardSubtitle}>
              {cardSubtitle}
            </p>
          </div>
          <div className="card-title-actions photo-collection-card-actions">
            <div className="tag-popover-anchor" ref={tagControlRef}>
              <button
                type="button"
                className={`card-icon-action${isTagPopoverOpen ? ' is-active' : ''}`}
                onClick={() => setIsTagPopoverOpen((currentValue) => !currentValue)}
                aria-label={`Manage tags for ${collection.name}`}
                aria-expanded={isTagPopoverOpen}
                aria-haspopup="dialog"
                aria-controls={isTagPopoverOpen ? tagPopoverId : undefined}
                title="Manage tags"
              >
                <PhotoCatalogTagIcon />
              </button>
            </div>
            <button
              type="button"
              className="card-icon-action"
              onClick={() => onOpenInfo(collection.id)}
              aria-label={`Show details for ${collection.name}`}
              title="Details"
            >
              <PhotoCatalogInfoIcon />
            </button>
          </div>
        </div>
      </div>

      {isTagPopoverOpen ? (
        <PhotoCollectionTagPopover
          collection={collection}
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


type PhotoHomeStripActionMenuProps = {
  strip: PhotoHomeStrip;
  index: number;
  totalCount: number;
  className?: string;
  onMove: (stripId: string, direction: PhotoHomeStripMoveDirection) => void;
  onEdit: (strip: PhotoHomeStrip) => void;
  onDelete: (strip: PhotoHomeStrip) => void;
};

type PhotoHomeStripSectionProps = {
  view: PhotoHomeStripView;
  index: number;
  totalCount: number;
  prioritizeInitialThumbnails: boolean;
  onMove: (stripId: string, direction: PhotoHomeStripMoveDirection) => void;
  onEdit: (strip: PhotoHomeStrip) => void;
  onDelete: (strip: PhotoHomeStrip) => void;
  onSelectCollection: (collectionId: string) => void;
  onOpenInfo: (collectionId: string) => void;
  onAddTag: (collectionId: string, label: string) => Promise<PhotoCollection | null>;
  onRemoveTag: (collectionId: string, tagId: string) => Promise<PhotoCollection | null>;
  onSearchTags: (query: string) => Promise<PhotoCatalogTag[]>;
};

function PhotoHomeStripMenuIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function PhotoHomeStripActionMenu({
  strip,
  index,
  totalCount,
  className = '',
  onMove,
  onEdit,
  onDelete
}: PhotoHomeStripActionMenuProps): JSX.Element {
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

  const menuClasses = ['home-strip-menu', className, isOpen ? 'is-open' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={menuClasses} ref={menuRef}>
      <button
        type="button"
        className="home-strip-menu-trigger"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Open options for ${strip.name}`}
        title="Strip Options"
      >
        <PhotoHomeStripMenuIcon />
      </button>

      {isOpen ? (
        <div className="home-strip-menu-bubble" role="menu" aria-label={`Options for ${strip.name}`}>
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

function PhotoHomeStripSection({
  view,
  index,
  totalCount,
  prioritizeInitialThumbnails,
  onMove,
  onEdit,
  onDelete,
  onSelectCollection,
  onOpenInfo,
  onAddTag,
  onRemoveTag,
  onSearchTags
}: PhotoHomeStripSectionProps): JSX.Element {
  const { strip, collections } = view;
  const stripTitleId = `photo-home-strip-title-${strip.id}`;
  const stripGridId = `photo-home-strip-grid-${strip.id}`;
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
  const [itemsPerRow, setItemsPerRow] = useState<number>(PHOTO_HOME_STRIP_MIN_ITEMS_PER_ROW);

  useLayoutEffect(() => {
    setVisibleRows(strip.rowCount);
  }, [strip.rowCount, stripLayoutResetKey]);

  useLayoutEffect(() => {
    const gridElement = gridRef.current;

    if (!gridElement) {
      return;
    }

    const updateItemsPerRow = (): void => {
      const nextItemsPerRow = getPhotoHomeStripItemsPerRow(gridElement);
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
  }, [collections.length]);

  const visibleCollectionCount = Math.min(collections.length, visibleRows * itemsPerRow);
  const visibleCollections = collections.slice(0, visibleCollectionCount);
  const remainingCollectionCount = collections.length - visibleCollectionCount;
  const hasMoreCollections = remainingCollectionCount > 0;

  return (
    <section className="home-strip" aria-labelledby={stripTitleId}>
      <div className="home-strip-header">
        <div className="home-strip-heading">
          <h2 id={stripTitleId}>{strip.name}</h2>
        </div>
        <PhotoHomeStripActionMenu
          strip={strip}
          index={index}
          totalCount={totalCount}
          className="home-strip-header-menu"
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>

      {collections.length > 0 ? (
        <>
          <div id={stripGridId} className="home-strip-grid" ref={gridRef}>
            {visibleCollections.map((collection, collectionIndex) => (
              <PhotoCollectionCard
                key={collection.id}
                collection={collection}
                thumbnailLoading={
                  prioritizeInitialThumbnails && collectionIndex < itemsPerRow ? 'eager' : undefined
                }
                contextKey={strip.id}
                onSelect={onSelectCollection}
                onOpenInfo={onOpenInfo}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
                onSearchTags={onSearchTags}
              />
            ))}
          </div>

          {hasMoreCollections ? (
            <div className="home-strip-footer">
              <span className="home-strip-visible-count">
                Showing {visibleCollectionCount} of {collections.length}
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
        <div className="empty-state home-strip-empty">No photo collections match this section yet.</div>
      )}
    </section>
  );
}

function PhotoGridCard({
  photo,
  isFavorite,
  onOpen,
  onToggleFavorite,
  contextLabel
}: {
  photo: Photo;
  isFavorite: boolean;
  onOpen: (photoId: string) => void;
  onToggleFavorite: (photo: Photo) => void;
  contextLabel?: string;
}): JSX.Element {
  const [isFavoriteControlSuppressed, setIsFavoriteControlSuppressed] = useState(false);
  const [isOriginalGifPreviewActive, setIsOriginalGifPreviewActive] = useState(false);
  const canUseOriginalGifPreview = shouldUseOriginalGifHoverPreview(photo);

  useEffect(() => {
    if (isFavorite) {
      setIsFavoriteControlSuppressed(false);
    }
  }, [isFavorite]);

  useEffect(() => {
    setIsOriginalGifPreviewActive(false);
  }, [photo.id]);

  const handleFavoriteClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (isFavorite && event.detail > 0) {
      event.currentTarget.blur();
      setIsFavoriteControlSuppressed(true);
    } else if (!isFavorite) {
      setIsFavoriteControlSuppressed(false);
    }

    onToggleFavorite(photo);
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLElement>): void => {
    if (canUseOriginalGifPreview && (event.pointerType === 'mouse' || event.pointerType === 'pen')) {
      setIsOriginalGifPreviewActive(true);
    }
  };

  const handlePointerLeave = (): void => {
    setIsFavoriteControlSuppressed(false);
    setIsOriginalGifPreviewActive(false);
  };

  const handleFocus = (): void => {
    if (canUseOriginalGifPreview) {
      setIsOriginalGifPreviewActive(true);
    }
  };

  const handleBlur = (event: ReactFocusEvent<HTMLElement>): void => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setIsOriginalGifPreviewActive(false);
    }
  };

  const showOriginalGifPreview = canUseOriginalGifPreview && isOriginalGifPreviewActive;

  return (
    <article
      className={`photo-grid-card${isFavorite ? ' is-favorite' : ''}${
        isFavoriteControlSuppressed ? ' is-favorite-control-suppressed' : ''
      }`}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="photo-grid-image-wrap">
        <button
          type="button"
          className="photo-grid-card-button"
          onClick={() => onOpen(photo.id)}
          aria-label={`Open ${photo.originalName}`}
        >
          <PhotoImage className="photo-grid-image" photo={photo} source="thumbnail" alt={photo.originalName} loading="lazy" />
          {showOriginalGifPreview ? (
            <PhotoImage
              key={`original-gif-preview-${photo.id}`}
              className="photo-grid-image photo-grid-image-original-gif-preview"
              photo={photo}
              source="original"
              alt=""
              loading="eager"
              decoding="async"
              aria-hidden="true"
            />
          ) : null}
        </button>
        {contextLabel ? (
          <div className="photo-grid-context-label" title={contextLabel}>
            {contextLabel}
          </div>
        ) : null}
        <div className="photo-grid-controls">
          <button
            type="button"
            className={`photo-grid-favorite-button${isFavorite ? ' is-favorite' : ''}`}
            onClick={handleFavoriteClick}
            aria-pressed={isFavorite}
            aria-label={`${isFavorite ? 'Remove' : 'Mark'} ${photo.originalName} as favorite`}
            title={isFavorite ? 'Remove favorite' : 'Mark as favorite'}
          >
            <span aria-hidden="true">♥</span>
          </button>
        </div>
      </div>
    </article>
  );
}

function PhotoCatalogNotice({ notice }: { notice: PhotoNotice | null }): JSX.Element | null {
  if (!notice) {
    return null;
  }

  return <div className={`photo-catalog-notice is-${notice.tone}`}>{notice.text}</div>;
}


export function PhotoCatalogView({
  collections,
  selectedCollectionId,
  viewerPhotoId,
  isActive,
  attemptFullscreenOnOpen,
  photoFavoritesBrowseRequestId = 0,
  homeStrips = [],
  isHomeViewActive = false,
  onReturnHome,
  onMoveHomeStrip = () => undefined,
  onEditHomeStrip = () => undefined,
  onDeleteHomeStrip = () => undefined,
  onSelectCollection,
  onBackToCollections,
  onOpenPhoto,
  onClosePhotoViewer,
  onOpenImport,
  onRefresh,
  filters,
  onCollectionUpdated,
  onCollectionDeleted,
  onTagsChanged,
  onUnauthorized
}: PhotoCatalogViewProps): JSX.Element {
  const [detail, setDetail] = useState<PhotoCollectionDetailPayload | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [notice, setNotice] = useState<PhotoNotice | null>(null);
  const [photoSearch, setPhotoSearch] = useState('');
  const [photoGridSortCategory, setPhotoGridSortCategory] = useState<PhotoGridSortCategory>('name');
  const [photoGridSortDirection, setPhotoGridSortDirection] = useState<PhotoGridSortDirection>('asc');
  const [photoGridRandomSeed, setPhotoGridRandomSeed] = useState(() => createPhotoGridRandomSeed());
  const [isPhotoFavoritesOnly, setIsPhotoFavoritesOnly] = useState(false);
  const [favoritePhotoIdsByCollection, setFavoritePhotoIdsByCollection] = useState<PhotoFavoriteState>(() =>
    createPhotoFavoriteStateFromCollections(collections)
  );
  const [isFavoriteBrowserOpen, setIsFavoriteBrowserOpen] = useState(false);
  const [favoriteBrowseTagId, setFavoriteBrowseTagId] = useState<string | null>(null);
  const [favoriteCollectionDetailsById, setFavoriteCollectionDetailsById] = useState<FavoriteCollectionDetailsState>({});
  const [isFavoriteBrowseLoading, setIsFavoriteBrowseLoading] = useState(false);
  const [favoriteBrowseError, setFavoriteBrowseError] = useState<string | null>(null);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [isTagBusy, setIsTagBusy] = useState(false);
  const viewerOverlayRef = useRef<HTMLDivElement | null>(null);
  const photoViewerHeaderRef = useRef<HTMLDivElement | null>(null);
  const photoViewerStageRef = useRef<HTMLDivElement | null>(null);
  const photoViewerCurrentFrameRef = useRef<HTMLDivElement | null>(null);
  const photoViewerControlsHideTimerRef = useRef<number | null>(null);
  const photoViewerSlideshowTimerRef = useRef<number | null>(null);
  const photoViewerTransitionTimerRef = useRef<number | null>(null);
  const photoViewerTransitionSequenceRef = useRef(0);
  const photoViewerCloseInProgressRef = useRef(false);
  const preserveControlsVisibilityForNextPhotoChangeRef = useRef(false);
  const photoViewerPendingNavigationOffsetRef = useRef<number | null>(null);
  const photoViewerDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPan: PhotoViewerPan;
  } | null>(null);
  const photoThumbnailCropDragRef = useRef<PhotoThumbnailCropDragState | null>(null);
  const photoThumbnailCropPreviousViewRef = useRef<PhotoThumbnailCropPreviousViewState | null>(null);
  const [arePhotoViewerControlsVisible, setArePhotoViewerControlsVisible] = useState(true);
  const [isPhotoViewerSlideshowActive, setIsPhotoViewerSlideshowActive] = useState(false);
  const [photoViewerRandomizedSlideshowPhotoIds, setPhotoViewerRandomizedSlideshowPhotoIds] = useState<string[] | null>(null);
  const [photoViewerSlideshowDelayMs, setPhotoViewerSlideshowDelayMs] = useState(
    PHOTO_VIEWER_DEFAULT_SLIDESHOW_DELAY_MS
  );
  const [photoViewerStandardSlideshowMode, setPhotoViewerStandardSlideshowMode] =
    useState<PhotoViewerStandardSlideshowMode>('cut');
  const [photoViewerFilmStripSlideshowMode, setPhotoViewerFilmStripSlideshowMode] =
    useState<PhotoViewerFilmStripSlideshowMode>('scroll');
  const [photoViewerLayoutMode, setPhotoViewerLayoutMode] = useState<PhotoViewerLayoutMode>(() =>
    readPhotoViewerLayoutModeFromSession()
  );
  const [photoViewerFilmStripVirtualCenter, setPhotoViewerFilmStripVirtualCenter] =
    useState<PhotoViewerFilmStripVirtualCenter | null>(null);
  const [photoViewerTransitionState, setPhotoViewerTransitionState] = useState<PhotoViewerTransitionState | null>(null);
  const [photoViewerFitMode, setPhotoViewerFitMode] = useState<PhotoViewerFitMode>('fit');
  const [photoViewerZoom, setPhotoViewerZoom] = useState(1);
  const [photoViewerPan, setPhotoViewerPan] = useState<PhotoViewerPan>({
    x: 0,
    y: 0
  });
  const [photoViewerStageSize, setPhotoViewerStageSize] = useState<PhotoViewerSize>({
    width: 0,
    height: 0
  });
  const [photoViewerNaturalSize, setPhotoViewerNaturalSize] = useState<PhotoViewerSize | null>(null);
  const [isPhotoViewerPanning, setIsPhotoViewerPanning] = useState(false);
  const [photoThumbnailCropSelection, setPhotoThumbnailCropSelection] =
    useState<PhotoThumbnailCropSelectionState | null>(null);
  const [isCollectionThumbnailBusy, setIsCollectionThumbnailBusy] = useState(false);
  const [infoCollectionId, setInfoCollectionId] = useState<string | null>(null);
  const [photoHomeStripRandomSeed, setPhotoHomeStripRandomSeed] = useState(() => createPhotoCollectionRandomSeed());

  useEffect(() => {
    setFavoritePhotoIdsByCollection(createPhotoFavoriteStateFromCollections(collections));
  }, [collections]);

  useEffect(() => {
    if (selectedCollectionId) {
      setInfoCollectionId(null);
      setIsFavoriteBrowserOpen(false);
      setFavoriteBrowseTagId(null);
      setFavoriteBrowseError(null);
    }
  }, [selectedCollectionId]);

  useEffect(() => {
    if (photoFavoritesBrowseRequestId <= 0) {
      return;
    }

    setInfoCollectionId(null);
    setIsFavoriteBrowserOpen(true);
    setFavoriteBrowseTagId(null);
    setFavoriteBrowseError(null);
    setPhotoSearch('');
    setNotice(null);
    onClosePhotoViewer();
  }, [photoFavoritesBrowseRequestId]);

  useEffect(() => {
    if (!selectedCollectionId) {
      setDetail(null);
      setPhotoSearch('');
      setNotice(null);
      return;
    }

    let cancelled = false;
    setIsDetailLoading(true);
    setNotice(null);

    fetchJson(`/api/photos/collections/${encodeURIComponent(selectedCollectionId)}`, undefined, onUnauthorized)
      .then((payload) => {
        const nextDetail = parsePhotoCollectionDetailPayload(payload);
        if (!nextDetail) {
          throw new Error('The photo collection response was invalid.');
        }

        if (!cancelled) {
          setDetail(nextDetail);
          setFavoritePhotoIdsByCollection((currentFavorites) =>
            setFavoritePhotoIdsForCollection(
              currentFavorites,
              nextDetail.collection.id,
              nextDetail.collection.favoritePhotoIds.length > 0
                ? nextDetail.collection.favoritePhotoIds
                : nextDetail.photos.filter((photo) => photo.isFavorite).map((photo) => photo.id)
            )
          );
          onCollectionUpdated(nextDetail.collection);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Photo collection failed to load.' });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsDetailLoading(false);
        }
      });

    fetchJson(`/api/photos/collections/${encodeURIComponent(selectedCollectionId)}/views`, { method: 'POST' }, onUnauthorized)
      .then((payload) => {
        const updatedCollection = parsePhotoCollectionUpdatePayload(payload);
        if (updatedCollection && !cancelled) {
          onCollectionUpdated(updatedCollection);
          setDetail((current) => (current ? { ...current, collection: updatedCollection } : current));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedCollectionId]);

  useEffect(() => {
    if (!selectedCollectionId) {
      return;
    }

    if (!collections.some((collection) => collection.id === selectedCollectionId)) {
      onBackToCollections();
    }
  }, [collections, selectedCollectionId]);

  useLayoutEffect(() => {
    if (!viewerPhotoId) {
      return;
    }

    resetPhotoViewerViewport();
  }, [viewerPhotoId]);

  useEffect(() => {
    if (!viewerPhotoId) {
      clearPhotoViewerControlsHideTimer();
      clearPhotoViewerSlideshowTimer();
      clearPhotoViewerTransitionTimer();
      photoThumbnailCropDragRef.current = null;
      setPhotoViewerTransitionState(null);
      photoViewerCloseInProgressRef.current = false;
      preserveControlsVisibilityForNextPhotoChangeRef.current = false;
      photoViewerPendingNavigationOffsetRef.current = null;
      photoViewerDragRef.current = null;
      photoThumbnailCropDragRef.current = null;
      restorePhotoThumbnailCropPreviousView();
      photoThumbnailCropPreviousViewRef.current = null;
      setPhotoThumbnailCropSelection(null);
      setPhotoViewerFilmStripVirtualCenter(null);
      setPhotoViewerFitMode('fit');
      setPhotoViewerRandomizedSlideshowPhotoIds(null);
      setIsPhotoViewerSlideshowActive(false);
      setIsPhotoViewerPanning(false);
      return;
    }

    photoViewerCloseInProgressRef.current = false;
    photoThumbnailCropDragRef.current = null;
    photoThumbnailCropPreviousViewRef.current = null;
    setPhotoThumbnailCropSelection((currentSelection) =>
      currentSelection?.photoId === viewerPhotoId ? currentSelection : null
    );
    const shouldPreserveControlsVisibility = preserveControlsVisibilityForNextPhotoChangeRef.current;
    preserveControlsVisibilityForNextPhotoChangeRef.current = false;

    if (!shouldPreserveControlsVisibility) {
      setArePhotoViewerControlsVisible(true);
      viewerOverlayRef.current?.focus();
      schedulePhotoViewerControlsHide();
    }

    return () => {
      clearPhotoViewerSlideshowTimer();
      photoViewerDragRef.current = null;
      photoThumbnailCropDragRef.current = null;
      setIsPhotoViewerPanning(false);
    };
  }, [viewerPhotoId]);

  useEffect(() => {
    return () => {
      clearPhotoViewerControlsHideTimer();
      clearPhotoViewerSlideshowTimer();
      clearPhotoViewerTransitionTimer();
    };
  }, []);

  useEffect(() => {
    writePhotoViewerLayoutModeToSession(photoViewerLayoutMode);
  }, [photoViewerLayoutMode]);

  const filteredCollections = useMemo(
    () => filterAndSortPhotoCollections(collections, filters),
    [collections, filters]
  );

  useEffect(() => {
    setPhotoHomeStripRandomSeed((currentSeed) => createNextPhotoCollectionRandomSeed(currentSeed));
  }, [collections, homeStrips]);

  const homeStripViews = useMemo<PhotoHomeStripView[]>(
    () =>
      homeStrips.map((strip) => ({
        strip,
        collections: getPhotoHomeStripCollections(strip, collections, photoHomeStripRandomSeed)
      })),
    [collections, homeStrips, photoHomeStripRandomSeed]
  );

  const infoCollection = useMemo(() => {
    if (!infoCollectionId) {
      return null;
    }

    return (
      collections.find((collection) => collection.id === infoCollectionId) ??
      (detail?.collection.id === infoCollectionId ? detail.collection : null)
    );
  }, [collections, detail, infoCollectionId]);

  const isFavoriteBrowserActive = !selectedCollectionId && isFavoriteBrowserOpen;
  const isCollectionHomeViewActive = !selectedCollectionId && !isFavoriteBrowserActive && isHomeViewActive;

  const photoFavoriteOverview = useMemo(
    () => createPhotoFavoriteOverview(collections, favoritePhotoIdsByCollection),
    [collections, favoritePhotoIdsByCollection]
  );

  const favoriteBrowseTag = useMemo<PhotoCatalogTag | null>(() => {
    if (!favoriteBrowseTagId) {
      return null;
    }

    const favoriteTagSummary = photoFavoriteOverview.tags.find((summary) => summary.tag.id === favoriteBrowseTagId);
    if (favoriteTagSummary) {
      return favoriteTagSummary.tag;
    }

    for (const collection of collections) {
      const tag = collection.tags.find((candidate) => candidate.id === favoriteBrowseTagId);
      if (tag) {
        return tag;
      }
    }

    return null;
  }, [collections, favoriteBrowseTagId, photoFavoriteOverview.tags]);

  const favoriteBrowseCollections = useMemo(
    () =>
      collections.filter(
        (collection) =>
          getFavoritePhotoCountForCollection(favoritePhotoIdsByCollection, collection.id) > 0 &&
          doesPhotoCollectionHaveTag(collection, favoriteBrowseTagId)
      ),
    [collections, favoriteBrowseTagId, favoritePhotoIdsByCollection]
  );

  const favoriteBrowseCollectionKey = favoriteBrowseCollections.map((collection) => collection.id).join('|');

  const favoriteBrowseMissingCollectionIds = useMemo(
    () =>
      isFavoriteBrowserActive
        ? favoriteBrowseCollections
            .filter((collection) => !favoriteCollectionDetailsById[collection.id])
            .map((collection) => collection.id)
        : [],
    [favoriteBrowseCollectionKey, favoriteCollectionDetailsById, isFavoriteBrowserActive]
  );

  const favoriteBrowseMissingCollectionKey = favoriteBrowseMissingCollectionIds.join('|');

  const favoriteBrowseKnownFavoriteCount = useMemo(
    () =>
      favoriteBrowseCollections.reduce(
        (total, collection) => total + getFavoritePhotoCountForCollection(favoritePhotoIdsByCollection, collection.id),
        0
      ),
    [favoriteBrowseCollections, favoritePhotoIdsByCollection]
  );

  const favoriteBrowseEntries = useMemo(() => {
    if (!isFavoriteBrowserActive) {
      return [];
    }

    const normalizedSearch = photoSearch.trim().toLowerCase();
    const entries: FavoritePhotoEntry[] = [];

    for (const collection of favoriteBrowseCollections) {
      const collectionDetail = favoriteCollectionDetailsById[collection.id];
      if (!collectionDetail) {
        continue;
      }

      const favoritePhotoIds = new Set(getFavoritePhotoIdsForCollection(favoritePhotoIdsByCollection, collection.id));
      for (const photo of collectionDetail.photos) {
        if (!favoritePhotoIds.has(photo.id)) {
          continue;
        }

        const entry = { photo, collection };
        if (doesFavoritePhotoEntryMatchSearch(entry, normalizedSearch)) {
          entries.push(entry);
        }
      }
    }

    return sortFavoritePhotoEntries(entries, photoGridSortCategory, photoGridSortDirection, photoGridRandomSeed);
  }, [
    favoriteBrowseCollections,
    favoriteCollectionDetailsById,
    favoritePhotoIdsByCollection,
    isFavoriteBrowserActive,
    photoGridRandomSeed,
    photoGridSortCategory,
    photoGridSortDirection,
    photoSearch
  ]);

  const favoriteBrowsePhotos = useMemo(() => favoriteBrowseEntries.map((entry) => entry.photo), [favoriteBrowseEntries]);

  const favoriteBrowseLoadedPhotoById = useMemo(() => {
    const photosById = new Map<string, Photo>();
    if (!isFavoriteBrowserActive) {
      return photosById;
    }

    for (const collection of favoriteBrowseCollections) {
      const collectionDetail = favoriteCollectionDetailsById[collection.id];
      if (!collectionDetail) {
        continue;
      }

      for (const photo of collectionDetail.photos) {
        photosById.set(photo.id, photo);
      }
    }

    return photosById;
  }, [favoriteBrowseCollections, favoriteCollectionDetailsById, isFavoriteBrowserActive]);

  useEffect(() => {
    if (!isFavoriteBrowserActive) {
      setIsFavoriteBrowseLoading(false);
      return;
    }

    if (favoriteBrowseMissingCollectionIds.length === 0) {
      setIsFavoriteBrowseLoading(false);
      return;
    }

    let cancelled = false;
    setIsFavoriteBrowseLoading(true);
    setFavoriteBrowseError(null);

    Promise.all(
      favoriteBrowseMissingCollectionIds.map(async (collectionId) => {
        try {
          const payload = await fetchJson(
            `/api/photos/collections/${encodeURIComponent(collectionId)}`,
            undefined,
            onUnauthorized
          );
          const collectionDetail = parsePhotoCollectionDetailPayload(payload);
          if (!collectionDetail) {
            throw new Error('The photo collection response was invalid.');
          }

          return { collectionId, collectionDetail };
        } catch {
          return { collectionId, collectionDetail: null };
        }
      })
    )
      .then((results) => {
        if (cancelled) {
          return;
        }

        const loadedDetails = results.filter((result) => result.collectionDetail !== null);
        if (loadedDetails.length > 0) {
          setFavoriteCollectionDetailsById((currentDetails) => {
            const nextDetails = { ...currentDetails };
            for (const result of loadedDetails) {
              if (result.collectionDetail) {
                nextDetails[result.collectionId] = result.collectionDetail;
              }
            }
            return nextDetails;
          });
        }

        const failureCount = results.length - loadedDetails.length;
        if (failureCount > 0) {
          setFavoriteBrowseError(
            `${failureCount} favorite ${failureCount === 1 ? 'collection' : 'collections'} could not be loaded.`
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsFavoriteBrowseLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [favoriteBrowseMissingCollectionKey, isFavoriteBrowserActive, onUnauthorized]);

  const selectedFavoritePhotoIds = useMemo(() => {
    if (!selectedCollectionId) {
      return new Set<string>();
    }

    return new Set(favoritePhotoIdsByCollection[selectedCollectionId] ?? []);
  }, [favoritePhotoIdsByCollection, selectedCollectionId]);

  function isFavoritePhoto(photo: Photo): boolean {
    return (favoritePhotoIdsByCollection[photo.collectionId] ?? []).includes(photo.id);
  }

  const visiblePhotos = useMemo(() => {
    if (!detail) {
      return [];
    }

    const normalizedSearch = photoSearch.trim().toLowerCase();
    return sortPhotos(
      detail.photos.filter((photo) => {
        if (isPhotoFavoritesOnly && !selectedFavoritePhotoIds.has(photo.id)) {
          return false;
        }

        if (normalizedSearch === '') {
          return true;
        }

        return photo.originalName.toLowerCase().includes(normalizedSearch);
      }),
      photoGridSortCategory,
      photoGridSortDirection,
      photoGridRandomSeed
    );
  }, [
    detail,
    isPhotoFavoritesOnly,
    photoGridRandomSeed,
    photoGridSortCategory,
    photoGridSortDirection,
    photoSearch,
    selectedFavoritePhotoIds
  ]);

  const viewerPhoto = useMemo(() => {
    if (!viewerPhotoId) {
      return null;
    }

    const detailPhoto = detail?.photos.find((photo) => photo.id === viewerPhotoId) ?? null;
    if (detailPhoto) {
      return detailPhoto;
    }

    return isFavoriteBrowserActive ? favoriteBrowseLoadedPhotoById.get(viewerPhotoId) ?? null : null;
  }, [detail, favoriteBrowseLoadedPhotoById, isFavoriteBrowserActive, viewerPhotoId]);

  const photoViewerRandomizedSlideshowPhotos = useMemo<Photo[] | null>(() => {
    if (photoViewerRandomizedSlideshowPhotoIds === null) {
      return null;
    }

    const visiblePhotoById = new Map(visiblePhotos.map((photo) => [photo.id, photo]));
    return uniqueStrings(photoViewerRandomizedSlideshowPhotoIds)
      .map((photoId) => visiblePhotoById.get(photoId))
      .filter((photo): photo is Photo => photo !== undefined);
  }, [photoViewerRandomizedSlideshowPhotoIds, visiblePhotos]);

  useEffect(() => {
    if (!viewerPhotoId || !viewerPhoto) {
      return;
    }

    let cancelled = false;
    fetchJson(`/api/photos/${encodeURIComponent(viewerPhoto.id)}/views`, { method: 'POST' }, onUnauthorized)
      .then((payload) => {
        const updatedPhoto = parsePhotoUpdatePayload(payload);
        if (!updatedPhoto || cancelled) {
          return;
        }

        setDetail((current) => {
          if (!current || current.collection.id !== updatedPhoto.collectionId) {
            return current;
          }

          return {
            ...current,
            photos: current.photos.map((photo) => (photo.id === updatedPhoto.id ? updatedPhoto : photo))
          };
        });

        setFavoriteCollectionDetailsById((currentDetails) => {
          const currentDetail = currentDetails[updatedPhoto.collectionId];
          if (!currentDetail || !currentDetail.photos.some((photo) => photo.id === updatedPhoto.id)) {
            return currentDetails;
          }

          return {
            ...currentDetails,
            [updatedPhoto.collectionId]: {
              ...currentDetail,
              photos: currentDetail.photos.map((photo) => (photo.id === updatedPhoto.id ? updatedPhoto : photo))
            }
          };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [onUnauthorized, viewerPhoto?.id, viewerPhotoId]);

  const viewerOrderedPhotos = isFavoriteBrowserActive
    ? favoriteBrowsePhotos.length > 0
      ? favoriteBrowsePhotos
      : viewerPhoto
        ? [viewerPhoto]
        : []
    : photoViewerRandomizedSlideshowPhotos !== null
      ? photoViewerRandomizedSlideshowPhotos
      : visiblePhotos.length > 0
        ? visiblePhotos
        : detail?.photos ?? [];
  const viewerOrderedPhotoIds = viewerOrderedPhotos.map((photo) => photo.id).join('|');
  const photoViewerSlideDurationLabel = `${formatPhotoViewerSlideDuration(photoViewerSlideshowDelayMs)} / slide`;
  const photoViewerSlideDurationDescription = describePhotoViewerSlideDuration(photoViewerSlideshowDelayMs);
  const isPhotoViewerFilmStripViewMode = photoViewerLayoutMode === 'film-strip';
  const photoViewerSlideshowModeOptions = isPhotoViewerFilmStripViewMode
    ? PHOTO_VIEWER_FILM_STRIP_SLIDESHOW_MODE_OPTIONS
    : PHOTO_VIEWER_STANDARD_SLIDESHOW_MODE_OPTIONS;
  const photoViewerSlideshowMode = isPhotoViewerFilmStripViewMode
    ? photoViewerFilmStripSlideshowMode
    : photoViewerStandardSlideshowMode;
  const photoViewerSlideshowModeOption = isPhotoViewerFilmStripViewMode
    ? getPhotoViewerFilmStripSlideshowModeOption(photoViewerFilmStripSlideshowMode)
    : getPhotoViewerStandardSlideshowModeOption(photoViewerStandardSlideshowMode);
  const photoViewerSlideshowModeDescription = photoViewerSlideshowModeOption.description;
  const photoViewerLayoutModeOption = getPhotoViewerLayoutModeOption(photoViewerLayoutMode);
  const photoViewerLayoutModeDescription = photoViewerLayoutModeOption.description;
  const canPhotoViewerSlideshowAdvance = viewerOrderedPhotos.length > 1;
  const viewerPhotoIndex = viewerPhoto ? viewerOrderedPhotos.findIndex((photo) => photo.id === viewerPhoto.id) : -1;
  const isPhotoViewerFilmStripLayout =
    isPhotoViewerFilmStripViewMode && viewerPhotoIndex >= 0 && viewerOrderedPhotos.length > 1;
  const isPhotoViewerFilmStripKenBurnsActive =
    isPhotoViewerFilmStripLayout &&
    viewerPhoto !== null &&
    isPhotoViewerSlideshowActive &&
    canPhotoViewerSlideshowAdvance &&
    photoViewerFilmStripSlideshowMode === 'ken-burns';

  useEffect(() => {
    if (!viewerPhoto || viewerPhotoIndex < 0 || viewerOrderedPhotos.length === 0) {
      photoViewerPendingNavigationOffsetRef.current = null;
      setPhotoViewerFilmStripVirtualCenter(null);
      return;
    }

    setPhotoViewerFilmStripVirtualCenter((currentCenter) => {
      const pendingOffset = photoViewerPendingNavigationOffsetRef.current;
      photoViewerPendingNavigationOffsetRef.current = null;

      if (
        currentCenter !== null &&
        pendingOffset !== null &&
        currentCenter.orderedPhotoIds === viewerOrderedPhotoIds &&
        currentCenter.photoId !== viewerPhoto.id
      ) {
        return {
          photoId: viewerPhoto.id,
          orderedPhotoIds: viewerOrderedPhotoIds,
          virtualIndex: currentCenter.virtualIndex + pendingOffset
        };
      }

      if (
        currentCenter !== null &&
        currentCenter.photoId === viewerPhoto.id &&
        currentCenter.orderedPhotoIds === viewerOrderedPhotoIds
      ) {
        return currentCenter;
      }

      return {
        photoId: viewerPhoto.id,
        orderedPhotoIds: viewerOrderedPhotoIds,
        virtualIndex: viewerPhotoIndex
      };
    });
  }, [viewerOrderedPhotoIds, viewerOrderedPhotos.length, viewerPhoto?.id, viewerPhotoIndex]);

  useEffect(() => {
    if (!viewerPhoto) {
      return;
    }

    let previousFullscreenElement = document.fullscreenElement;

    const handleFullscreenChange = (): void => {
      const overlayElement = viewerOverlayRef.current;
      const currentFullscreenElement = document.fullscreenElement;
      const photoViewerWasFullscreen = overlayElement !== null && previousFullscreenElement === overlayElement;
      const photoViewerIsFullscreen = overlayElement !== null && currentFullscreenElement === overlayElement;

      previousFullscreenElement = currentFullscreenElement;

      if (photoViewerIsFullscreen || !photoViewerWasFullscreen) {
        return;
      }

      clearPhotoViewerControlsHideTimer();
      clearPhotoViewerSlideshowTimer();
      clearPhotoViewerTransitionTimer();
      setPhotoViewerTransitionState(null);
      photoViewerDragRef.current = null;
      photoThumbnailCropDragRef.current = null;
      restorePhotoThumbnailCropPreviousView();
      photoThumbnailCropPreviousViewRef.current = null;
      setPhotoThumbnailCropSelection(null);
      setIsPhotoViewerSlideshowActive(false);
      setIsPhotoViewerPanning(false);

      if (photoViewerCloseInProgressRef.current) {
        return;
      }

      photoViewerCloseInProgressRef.current = true;
      onClosePhotoViewer();
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [onClosePhotoViewer, viewerPhoto?.id]);

  useEffect(() => {
    if (!viewerPhoto || !attemptFullscreenOnOpen) {
      return;
    }

    const overlayElement = viewerOverlayRef.current;
    if (!overlayElement || document.fullscreenElement !== null) {
      return;
    }

    void overlayElement.requestFullscreen?.().catch(() => {
      // Fullscreen is best-effort only, matching the video viewer behavior.
    });
  }, [attemptFullscreenOnOpen, viewerPhoto?.id]);

  const isViewerPhotoFavorite = viewerPhoto !== null && isFavoritePhoto(viewerPhoto);
  const viewerPhotoCollection = viewerPhoto
    ? collections.find((collection) => collection.id === viewerPhoto.collectionId) ??
      (detail?.collection.id === viewerPhoto.collectionId ? detail.collection : null)
    : null;
  const isCollectionThumbnailActionAvailable =
    viewerPhoto !== null && detail !== null && detail.collection.id === viewerPhoto.collectionId;
  const activePhotoThumbnailCropSelection =
    photoThumbnailCropSelection !== null && photoThumbnailCropSelection.photoId === viewerPhoto?.id
      ? photoThumbnailCropSelection
      : null;
  const isPhotoThumbnailCropModeActive = activePhotoThumbnailCropSelection !== null;
  const isPhotoGridRandomSortActive = photoGridSortCategory === 'random';
  const photoGridSortDirectionLabel = photoGridSortDirection === 'asc' ? 'ascending' : 'descending';
  const emptyPhotoStateTitle = isPhotoFavoritesOnly ? 'No favorite photos' : 'No matching photos';
  const emptyPhotoStateMessage = isPhotoFavoritesOnly
    ? 'Turn off Favorites only or mark photos in this collection as favorites.'
    : 'Try a different filename search or add photos to this collection.';

  const photoViewerIntrinsicSize = useMemo<PhotoViewerSize | null>(() => {
    const width = normalizePhotoViewerDimension(photoViewerNaturalSize?.width ?? viewerPhoto?.width);
    const height = normalizePhotoViewerDimension(photoViewerNaturalSize?.height ?? viewerPhoto?.height);

    return width !== null && height !== null ? { width, height } : null;
  }, [photoViewerNaturalSize?.height, photoViewerNaturalSize?.width, viewerPhoto?.height, viewerPhoto?.width]);

  const photoViewerPrimaryStageSize = photoViewerStageSize;

  const photoViewerFilmStripVirtualIndex =
    photoViewerFilmStripVirtualCenter !== null &&
    photoViewerFilmStripVirtualCenter.photoId === viewerPhoto?.id &&
    photoViewerFilmStripVirtualCenter.orderedPhotoIds === viewerOrderedPhotoIds
      ? photoViewerFilmStripVirtualCenter.virtualIndex
      : viewerPhotoIndex;

  const photoViewerEffectiveFitMode = isPhotoViewerFilmStripKenBurnsActive ? 'fit' : photoViewerFitMode;
  const photoViewerEffectiveZoom = isPhotoViewerFilmStripKenBurnsActive ? 1 : photoViewerZoom;

  const photoViewerRenderedSize = useMemo(
    () =>
      calculatePhotoViewerRenderedSize(
        photoViewerIntrinsicSize,
        photoViewerPrimaryStageSize,
        photoViewerEffectiveFitMode,
        photoViewerEffectiveZoom
      ),
    [photoViewerEffectiveFitMode, photoViewerEffectiveZoom, photoViewerIntrinsicSize, photoViewerPrimaryStageSize]
  );

  const photoViewerFilmStripCurrentFrameSize = photoViewerRenderedSize ?? photoViewerPrimaryStageSize;

  const photoViewerFilmStripFrames = useMemo<PhotoViewerFilmStripFrame[]>(() => {
    if (!isPhotoViewerFilmStripLayout || !Number.isFinite(photoViewerFilmStripVirtualIndex)) {
      return [];
    }

    return buildPhotoViewerFilmStripFrames(
      viewerOrderedPhotos,
      photoViewerFilmStripVirtualIndex,
      photoViewerFilmStripCurrentFrameSize,
      photoViewerStageSize
    );
  }, [
    isPhotoViewerFilmStripLayout,
    photoViewerFilmStripCurrentFrameSize,
    photoViewerFilmStripVirtualIndex,
    photoViewerStageSize,
    viewerOrderedPhotos
  ]);

  const photoViewerPanLimit = useMemo(
    () => calculatePhotoViewerPanLimit(photoViewerRenderedSize, photoViewerPrimaryStageSize),
    [photoViewerRenderedSize, photoViewerPrimaryStageSize]
  );

  const photoViewerPanOffset = useMemo(
    () => clampPhotoViewerPan(photoViewerPan, photoViewerPanLimit),
    [photoViewerPan, photoViewerPanLimit]
  );

  const isPhotoViewerPanAvailable = photoViewerPanLimit.x > 0 || photoViewerPanLimit.y > 0;

  const photoViewerImageStyle = useMemo<CSSProperties>(() => {
    const transform = photoViewerRenderedSize
      ? `translate3d(${photoViewerPanOffset.x}px, ${photoViewerPanOffset.y}px, 0)`
      : `translate3d(${photoViewerPanOffset.x}px, ${photoViewerPanOffset.y}px, 0) scale(${photoViewerEffectiveZoom})`;

    return {
      width: photoViewerRenderedSize ? `${photoViewerRenderedSize.width}px` : '100%',
      height: photoViewerRenderedSize ? `${photoViewerRenderedSize.height}px` : '100%',
      objectFit: photoViewerRenderedSize ? 'fill' : photoViewerEffectiveFitMode === 'fit' ? 'contain' : 'cover',
      transform,
      transformOrigin: 'center center',
      cursor: isPhotoThumbnailCropModeActive
        ? 'default'
        : isPhotoViewerPanning
          ? 'grabbing'
          : isPhotoViewerPanAvailable
            ? 'grab'
            : 'default',
      touchAction: isPhotoThumbnailCropModeActive ? 'none' : isPhotoViewerPanAvailable ? 'none' : 'auto',
      willChange: 'transform, width, height'
    };
  }, [
    isPhotoThumbnailCropModeActive,
    isPhotoViewerPanAvailable,
    isPhotoViewerPanning,
    photoViewerEffectiveFitMode,
    photoViewerEffectiveZoom,
    photoViewerPanOffset.x,
    photoViewerPanOffset.y,
    photoViewerRenderedSize
  ]);

  const photoThumbnailCropImageRect = useMemo(
    () => calculatePhotoViewerImageRect(photoViewerRenderedSize, photoViewerPrimaryStageSize, photoViewerPanOffset),
    [photoViewerPanOffset, photoViewerPrimaryStageSize, photoViewerRenderedSize]
  );

  const photoThumbnailCropImageBoundsStyle = useMemo<CSSProperties | null>(() => {
    if (!photoThumbnailCropImageRect) {
      return null;
    }

    return {
      left: `${photoThumbnailCropImageRect.left}px`,
      top: `${photoThumbnailCropImageRect.top}px`,
      width: `${photoThumbnailCropImageRect.width}px`,
      height: `${photoThumbnailCropImageRect.height}px`
    };
  }, [photoThumbnailCropImageRect]);

  const photoThumbnailCropBoxStyle = useMemo<CSSProperties | null>(() => {
    if (!activePhotoThumbnailCropSelection || !photoViewerIntrinsicSize || !photoThumbnailCropImageRect) {
      return null;
    }

    const crop = clampPhotoThumbnailCropBox(activePhotoThumbnailCropSelection.crop, photoViewerIntrinsicSize);
    const scaleX = photoThumbnailCropImageRect.width / photoViewerIntrinsicSize.width;
    const scaleY = photoThumbnailCropImageRect.height / photoViewerIntrinsicSize.height;

    return {
      left: `${photoThumbnailCropImageRect.left + crop.x * scaleX}px`,
      top: `${photoThumbnailCropImageRect.top + crop.y * scaleY}px`,
      width: `${crop.width * scaleX}px`,
      height: `${crop.height * scaleY}px`
    };
  }, [activePhotoThumbnailCropSelection, photoThumbnailCropImageRect, photoViewerIntrinsicSize]);

  const photoViewerFrameStyle = useMemo<CSSProperties>(
    () =>
      ({
        '--photo-viewer-transition-duration': `${PHOTO_VIEWER_TRANSITION_DURATION_MS}ms`,
        '--photo-viewer-ken-burns-duration': `${Math.max(
          photoViewerSlideshowDelayMs,
          PHOTO_VIEWER_TRANSITION_DURATION_MS
        )}ms`
      }) as CSSProperties,
    [photoViewerSlideshowDelayMs]
  );

  useEffect(() => {
    if (!viewerPhoto) {
      setPhotoViewerStageSize({
        width: 0,
        height: 0
      });
      return;
    }

    const stageElement = photoViewerStageRef.current;
    if (!stageElement) {
      setPhotoViewerStageSize({
        width: 0,
        height: 0
      });
      return;
    }

    const updateStageSize = (): void => {
      const rect = stageElement.getBoundingClientRect();
      const nextWidth = rect.width;
      const nextHeight = rect.height;

      setPhotoViewerStageSize((currentValue) => {
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
  }, [viewerPhoto?.id]);

  useEffect(() => {
    setPhotoViewerPan((currentValue) => {
      const nextValue = clampPhotoViewerPan(currentValue, photoViewerPanLimit);
      if (currentValue.x === nextValue.x && currentValue.y === nextValue.y) {
        return currentValue;
      }

      return nextValue;
    });
  }, [photoViewerPanLimit]);

  function clearPhotoViewerControlsHideTimer(): void {
    if (photoViewerControlsHideTimerRef.current !== null) {
      window.clearTimeout(photoViewerControlsHideTimerRef.current);
      photoViewerControlsHideTimerRef.current = null;
    }
  }

  function clearPhotoViewerSlideshowTimer(): void {
    if (photoViewerSlideshowTimerRef.current !== null) {
      window.clearTimeout(photoViewerSlideshowTimerRef.current);
      photoViewerSlideshowTimerRef.current = null;
    }
  }

  function clearPhotoViewerTransitionTimer(): void {
    if (photoViewerTransitionTimerRef.current !== null) {
      window.clearTimeout(photoViewerTransitionTimerRef.current);
      photoViewerTransitionTimerRef.current = null;
    }
  }

  function schedulePhotoViewerControlsHide(): void {
    clearPhotoViewerControlsHideTimer();
    if (isPhotoThumbnailCropModeActive) {
      setArePhotoViewerControlsVisible(true);
      return;
    }

    photoViewerControlsHideTimerRef.current = window.setTimeout(() => {
      const activeElement = document.activeElement;
      const isFocusWithinHeader =
        activeElement !== null && photoViewerHeaderRef.current?.contains(activeElement) === true;

      if (isFocusWithinHeader) {
        schedulePhotoViewerControlsHide();
        return;
      }

      setArePhotoViewerControlsVisible(false);
    }, PHOTO_VIEWER_CONTROLS_AUTO_HIDE_DELAY_MS);
  }

  function notePhotoViewerActivity(): void {
    setArePhotoViewerControlsVisible((currentValue) => (currentValue ? currentValue : true));
    if (!isPhotoThumbnailCropModeActive) {
      schedulePhotoViewerControlsHide();
    }
  }

  function focusPhotoViewerOverlay(): void {
    const overlayElement = viewerOverlayRef.current;
    if (overlayElement === null || typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      if (viewerOverlayRef.current === overlayElement) {
        overlayElement.focus({ preventScroll: true });
      }
    });
  }

  function applyPhotoViewerLayoutMode(nextMode: PhotoViewerLayoutMode): void {
    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    clearPhotoViewerTransitionTimer();
    setPhotoViewerTransitionState(null);
    setPhotoViewerLayoutMode(nextMode);
    focusPhotoViewerOverlay();
  }

  function cyclePhotoViewerViewMode(): void {
    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    notePhotoViewerActivity();
    clearPhotoViewerTransitionTimer();
    setPhotoViewerTransitionState(null);
    setPhotoViewerLayoutMode((currentMode) => getNextPhotoViewerLayoutMode(currentMode));
    focusPhotoViewerOverlay();
  }

  function requestClosePhotoViewer(): void {
    if (photoViewerCloseInProgressRef.current) {
      return;
    }

    photoViewerCloseInProgressRef.current = true;
    clearPhotoViewerControlsHideTimer();
    clearPhotoViewerSlideshowTimer();
    clearPhotoViewerTransitionTimer();
    setPhotoViewerTransitionState(null);
    photoViewerDragRef.current = null;
    photoThumbnailCropDragRef.current = null;
    restorePhotoThumbnailCropPreviousView();
    photoThumbnailCropPreviousViewRef.current = null;
    setPhotoThumbnailCropSelection(null);
    setIsPhotoViewerSlideshowActive(false);
    setIsPhotoViewerPanning(false);

    const overlayElement = viewerOverlayRef.current;
    onClosePhotoViewer();

    if (overlayElement !== null && document.fullscreenElement === overlayElement) {
      void document.exitFullscreen().catch(() => {
        // Fullscreen exit is best-effort only.
      });
    }
  }

  function resetPhotoViewerViewport(): void {
    photoViewerDragRef.current = null;
    setIsPhotoViewerPanning(false);
    setPhotoViewerZoom(1);
    setPhotoViewerPan({
      x: 0,
      y: 0
    });
    setPhotoViewerNaturalSize(null);
  }

  function togglePhotoViewerFitMode(): void {
    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    notePhotoViewerActivity();
    setPhotoViewerFitMode((currentValue) => (currentValue === 'fit' ? 'fill' : 'fit'));
  }

  function togglePhotoViewerSlideshow(): void {
    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    notePhotoViewerActivity();
    if (!canPhotoViewerSlideshowAdvance) {
      clearPhotoViewerSlideshowTimer();
      setIsPhotoViewerSlideshowActive(false);
      return;
    }

    setIsPhotoViewerSlideshowActive((currentValue) => !currentValue);
  }

  function showPreviousViewerPhoto(): void {
    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    notePhotoViewerActivity();
    openViewerPhotoAtOffset(-1, { useSlideshowTransition: isPhotoViewerSlideshowActive });
  }

  function showNextViewerPhoto(): void {
    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    notePhotoViewerActivity();
    openViewerPhotoAtOffset(1, { useSlideshowTransition: isPhotoViewerSlideshowActive });
  }

  function stopPhotoViewerSideNavActivityPropagation(event: SyntheticEvent<HTMLButtonElement>): void {
    event.stopPropagation();
  }

  function preventPhotoViewerSideNavMouseActivity(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePhotoViewerSideNavClick(offset: number, event: ReactMouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    openViewerPhotoAtOffset(offset, {
      preserveControlsVisibility: true,
      useSlideshowTransition: isPhotoViewerSlideshowActive
    });
  }

  function handlePhotoViewerSlideshowDelayChange(event: ChangeEvent<HTMLSelectElement>): void {
    notePhotoViewerActivity();
    const nextDelayMs = Number(event.currentTarget.value);
    if (!PHOTO_VIEWER_SLIDESHOW_DELAY_OPTIONS_MS.includes(nextDelayMs)) {
      return;
    }

    setPhotoViewerSlideshowDelayMs(clampPhotoViewerSlideshowDelayMs(nextDelayMs));
  }

  function adjustPhotoViewerSlideshowDelay(deltaMs: number): void {
    setPhotoViewerSlideshowDelayMs((currentDelayMs) =>
      clampPhotoViewerSlideshowDelayMs(currentDelayMs + deltaMs)
    );
  }

  function handlePhotoViewerSlideshowModeChange(event: ChangeEvent<HTMLSelectElement>): void {
    notePhotoViewerActivity();
    const nextMode = event.currentTarget.value;

    if (isPhotoViewerFilmStripViewMode) {
      if (!isPhotoViewerFilmStripSlideshowMode(nextMode)) {
        return;
      }

      clearPhotoViewerTransitionTimer();
      setPhotoViewerTransitionState(null);
      setPhotoViewerFilmStripSlideshowMode(nextMode);
      return;
    }

    if (!isPhotoViewerStandardSlideshowMode(nextMode)) {
      return;
    }

    clearPhotoViewerTransitionTimer();
    setPhotoViewerTransitionState(null);
    setPhotoViewerStandardSlideshowMode(nextMode);
  }

  function handlePhotoViewerLayoutModeChange(event: ChangeEvent<HTMLSelectElement>): void {
    if (isPhotoThumbnailCropModeActive) {
      event.currentTarget.value = photoViewerLayoutMode;
      return;
    }

    notePhotoViewerActivity();
    event.currentTarget.blur();
    const nextMode = event.currentTarget.value;
    if (!isPhotoViewerLayoutMode(nextMode)) {
      return;
    }

    applyPhotoViewerLayoutMode(nextMode);
  }

  function restorePhotoThumbnailCropPreviousView(): void {
    const previousView = photoThumbnailCropPreviousViewRef.current;
    photoThumbnailCropPreviousViewRef.current = null;

    if (!previousView) {
      return;
    }

    setPhotoViewerLayoutMode(previousView.layoutMode);
    setPhotoViewerFitMode(previousView.fitMode);
    setPhotoViewerZoom(previousView.zoom);
    setPhotoViewerPan(previousView.pan);
    setIsPhotoViewerSlideshowActive(previousView.wasSlideshowActive && canPhotoViewerSlideshowAdvance);
  }

  function exitPhotoThumbnailCropSelection(options: { restoreView?: boolean } = {}): void {
    photoThumbnailCropDragRef.current = null;
    setPhotoThumbnailCropSelection(null);
    setIsPhotoViewerPanning(false);
    setArePhotoViewerControlsVisible(true);

    if (options.restoreView !== false) {
      restorePhotoThumbnailCropPreviousView();
    } else {
      photoThumbnailCropPreviousViewRef.current = null;
    }

    focusPhotoViewerOverlay();
  }

  function beginPhotoThumbnailCropSelection(): void {
    if (!detail || !viewerPhoto || isCollectionThumbnailBusy) {
      return;
    }

    if (!photoViewerNaturalSize) {
      setNotice({ tone: 'error', text: 'The full-resolution photo is still loading and cannot be cropped yet.' });
      return;
    }

    notePhotoViewerActivity();
    setNotice(null);
    clearPhotoViewerControlsHideTimer();
    clearPhotoViewerSlideshowTimer();
    clearPhotoViewerTransitionTimer();
    photoViewerDragRef.current = null;
    photoThumbnailCropDragRef.current = null;
    setPhotoViewerTransitionState(null);
    setIsPhotoViewerPanning(false);

    photoThumbnailCropPreviousViewRef.current = {
      layoutMode: photoViewerLayoutMode,
      fitMode: photoViewerFitMode,
      zoom: photoViewerZoom,
      pan: photoViewerPanOffset,
      wasSlideshowActive: isPhotoViewerSlideshowActive
    };

    setIsPhotoViewerSlideshowActive(false);
    setPhotoViewerLayoutMode('standard');
    setPhotoViewerFitMode('fit');
    setPhotoViewerZoom(1);
    setPhotoViewerPan({ x: 0, y: 0 });
    setArePhotoViewerControlsVisible(true);
    setPhotoThumbnailCropSelection({
      photoId: viewerPhoto.id,
      crop: createInitialPhotoThumbnailCropBox(photoViewerNaturalSize)
    });
    focusPhotoViewerOverlay();
  }

  async function confirmPhotoThumbnailCropSelection(): Promise<void> {
    const cropSourceSize = photoViewerNaturalSize ?? photoViewerIntrinsicSize;
    if (!detail || !viewerPhoto || !activePhotoThumbnailCropSelection || !cropSourceSize || isCollectionThumbnailBusy) {
      return;
    }

    const crop = createPhotoThumbnailCropRequest(activePhotoThumbnailCropSelection.crop, cropSourceSize);
    notePhotoViewerActivity();
    setIsCollectionThumbnailBusy(true);
    setNotice(null);

    try {
      const payload = await fetchJson(
        `/api/photos/collections/${encodeURIComponent(detail.collection.id)}/thumbnail`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            photoId: viewerPhoto.id,
            crop
          })
        },
        onUnauthorized
      );
      const updatedCollection = parsePhotoCollectionUpdatePayload(payload);
      if (!updatedCollection) {
        throw new Error('Collection thumbnail response was invalid.');
      }

      setDetail((current) =>
        current && current.collection.id === updatedCollection.id
          ? { ...current, collection: updatedCollection }
          : current
      );
      onCollectionUpdated(updatedCollection);
      exitPhotoThumbnailCropSelection();
      setNotice({ tone: 'success', text: `Set the selected crop of “${viewerPhoto.originalName}” as the collection thumbnail.` });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Collection thumbnail could not be updated.'
      });
    } finally {
      setIsCollectionThumbnailBusy(false);
    }
  }

  async function handleSetCollectionThumbnail(): Promise<void> {
    if (isPhotoThumbnailCropModeActive) {
      await confirmPhotoThumbnailCropSelection();
      return;
    }

    beginPhotoThumbnailCropSelection();
  }

  function handlePhotoViewerImageLoad(event: SyntheticEvent<HTMLImageElement>): void {
    const imageElement = event.currentTarget;
    const naturalWidth = normalizePhotoViewerDimension(imageElement.naturalWidth);
    const naturalHeight = normalizePhotoViewerDimension(imageElement.naturalHeight);

    if (naturalWidth === null || naturalHeight === null) {
      return;
    }

    setPhotoViewerNaturalSize((currentValue) => {
      if (currentValue?.width === naturalWidth && currentValue.height === naturalHeight) {
        return currentValue;
      }

      return {
        width: naturalWidth,
        height: naturalHeight
      };
    });
  }

  function handlePhotoViewerWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    notePhotoViewerActivity();
    event.preventDefault();

    if (isPhotoThumbnailCropModeActive) {
      return;
    }

    const stageElement = photoViewerStageRef.current;
    const stageRect = stageElement?.getBoundingClientRect() ?? null;
    const pointerX = stageRect ? event.clientX - stageRect.left - stageRect.width / 2 : 0;
    const pointerY = stageRect ? event.clientY - stageRect.top - stageRect.height / 2 : 0;

    setPhotoViewerZoom((currentZoom) => {
      const nextZoom = getPhotoViewerWheelZoom(
        currentZoom,
        event.deltaY,
        event.deltaMode,
        photoViewerStageSize.height
      );

      if (nextZoom === currentZoom) {
        return currentZoom;
      }

      setPhotoViewerPan((currentPan) => {
        const zoomRatio = currentZoom > 0 ? nextZoom / currentZoom : 1;
        const nextRenderedSize = calculatePhotoViewerRenderedSize(
          photoViewerIntrinsicSize,
          photoViewerStageSize,
          photoViewerFitMode,
          nextZoom
        );
        const nextPanLimit = calculatePhotoViewerPanLimit(nextRenderedSize, photoViewerStageSize);
        const anchoredPan = {
          x: pointerX - (pointerX - currentPan.x) * zoomRatio,
          y: pointerY - (pointerY - currentPan.y) * zoomRatio
        };

        return clampPhotoViewerPan(anchoredPan, nextPanLimit);
      });

      return nextZoom;
    });
  }

  function handlePhotoViewerImagePointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    notePhotoViewerActivity();
    if (isPhotoThumbnailCropModeActive || event.button !== 0 || !isPhotoViewerPanAvailable) {
      return;
    }

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a best-effort enhancement for smooth drag panning.
    }

    photoViewerDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: photoViewerPanOffset
    };
    setIsPhotoViewerPanning(true);
  }

  function handlePhotoViewerImagePointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    const dragState = photoViewerDragRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    notePhotoViewerActivity();
    event.preventDefault();
    const deltaX = event.clientX - dragState.startClientX;
    const deltaY = event.clientY - dragState.startClientY;

    setPhotoViewerPan(
      clampPhotoViewerPan(
        {
          x: dragState.startPan.x + deltaX,
          y: dragState.startPan.y + deltaY
        },
        photoViewerPanLimit
      )
    );
  }

  function handlePhotoViewerImagePointerUp(event: ReactPointerEvent<HTMLImageElement>): void {
    const dragState = photoViewerDragRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    notePhotoViewerActivity();
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    photoViewerDragRef.current = null;
    setIsPhotoViewerPanning(false);
  }

  function updatePhotoThumbnailCropSelection(updater: (crop: PhotoThumbnailCropBox) => PhotoThumbnailCropBox): void {
    if (!viewerPhoto || !photoViewerIntrinsicSize) {
      return;
    }

    setPhotoThumbnailCropSelection((currentSelection) => {
      if (!currentSelection || currentSelection.photoId !== viewerPhoto.id) {
        return currentSelection;
      }

      return {
        ...currentSelection,
        crop: clampPhotoThumbnailCropBox(updater(currentSelection.crop), photoViewerIntrinsicSize)
      };
    });
  }

  function nudgePhotoThumbnailCropSelection(deltaX: number, deltaY: number): void {
    updatePhotoThumbnailCropSelection((crop) => ({
      ...crop,
      x: crop.x + deltaX,
      y: crop.y + deltaY
    }));
  }

  function handlePhotoThumbnailCropBoxPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !activePhotoThumbnailCropSelection) {
      return;
    }

    notePhotoViewerActivity();
    event.preventDefault();
    event.stopPropagation();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works while the pointer remains over the overlay.
    }

    photoThumbnailCropDragRef.current = {
      pointerId: event.pointerId,
      action: 'move',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: activePhotoThumbnailCropSelection.crop
    };
  }

  function handlePhotoThumbnailCropHandlePointerDown(
    handle: PhotoThumbnailCropResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>
  ): void {
    if (event.button !== 0 || !activePhotoThumbnailCropSelection) {
      return;
    }

    notePhotoViewerActivity();
    event.preventDefault();
    event.stopPropagation();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works while the pointer remains over the overlay.
    }

    photoThumbnailCropDragRef.current = {
      pointerId: event.pointerId,
      action: 'resize',
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCrop: activePhotoThumbnailCropSelection.crop
    };
  }

  function handlePhotoThumbnailCropPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const dragState = photoThumbnailCropDragRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId || !photoViewerIntrinsicSize || !photoThumbnailCropImageRect) {
      return;
    }

    const scaleX = photoThumbnailCropImageRect.width / photoViewerIntrinsicSize.width;
    const scaleY = photoThumbnailCropImageRect.height / photoViewerIntrinsicSize.height;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
      return;
    }

    notePhotoViewerActivity();
    event.preventDefault();
    event.stopPropagation();

    const deltaX = (event.clientX - dragState.startClientX) / scaleX;
    const deltaY = (event.clientY - dragState.startClientY) / scaleY;

    updatePhotoThumbnailCropSelection(() =>
      dragState.action === 'move'
        ? {
            ...dragState.startCrop,
            x: dragState.startCrop.x + deltaX,
            y: dragState.startCrop.y + deltaY
          }
        : resizePhotoThumbnailCropBox(dragState, deltaX, deltaY, photoViewerIntrinsicSize)
    );
  }

  function handlePhotoThumbnailCropPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const dragState = photoThumbnailCropDragRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    notePhotoViewerActivity();
    event.preventDefault();
    event.stopPropagation();

    const pointerTarget = event.target;
    if (pointerTarget instanceof HTMLElement) {
      try {
        pointerTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
    }

    photoThumbnailCropDragRef.current = null;
  }

  function applyPhotoFavoriteUpdate(updatedPhoto: Photo, updatedCollection: PhotoCollection | null = null): void {
    setFavoritePhotoIdsByCollection((currentFavorites) => setPhotoFavoriteInState(currentFavorites, updatedPhoto));

    setDetail((currentDetail) => {
      if (!currentDetail || currentDetail.collection.id !== updatedPhoto.collectionId) {
        return currentDetail;
      }

      const updatedDetail = updatePhotoInCollectionDetail(currentDetail, updatedPhoto);
      return updatedCollection && updatedCollection.id === updatedDetail.collection.id
        ? { ...updatedDetail, collection: updatedCollection }
        : updatedDetail;
    });

    setFavoriteCollectionDetailsById((currentDetails) => {
      const currentDetail = currentDetails[updatedPhoto.collectionId];
      if (!currentDetail) {
        return currentDetails;
      }

      const updatedDetail = updatePhotoInCollectionDetail(currentDetail, updatedPhoto);
      return {
        ...currentDetails,
        [updatedPhoto.collectionId]: updatedCollection && updatedCollection.id === updatedPhoto.collectionId
          ? { ...updatedDetail, collection: updatedCollection }
          : updatedDetail
      };
    });

    if (updatedCollection) {
      onCollectionUpdated(updatedCollection);
    }
  }

  const handleTogglePhotoFavorite = (photo: Photo): void => {
    const wasFavorite = isFavoritePhoto(photo);
    const nextFavoritePhoto = { ...photo, isFavorite: !wasFavorite };

    setNotice(null);
    applyPhotoFavoriteUpdate(nextFavoritePhoto);

    void fetchJson(
      `/api/photos/${encodeURIComponent(photo.id)}/favorite`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite: nextFavoritePhoto.isFavorite })
      },
      onUnauthorized
    )
      .then((payload) => {
        const parsedPayload = parsePhotoFavoriteUpdatePayload(payload);
        if (!parsedPayload) {
          throw new Error('The photo favorite response was invalid.');
        }

        applyPhotoFavoriteUpdate(parsedPayload.photo, parsedPayload.collection);
      })
      .catch((error: unknown) => {
        applyPhotoFavoriteUpdate({ ...photo, isFavorite: wasFavorite });
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Favorite could not be saved.' });
      });
  };

  const handleToggleViewerPhotoFavorite = (): void => {
    if (!viewerPhoto) {
      return;
    }

    notePhotoViewerActivity();
    handleTogglePhotoFavorite(viewerPhoto);
  };


  function handlePhotoGridSortCategoryChange(nextSortCategory: PhotoGridSortCategory): void {
    const wasRandomSortActive = photoGridSortCategory === 'random';
    setPhotoGridSortCategory(nextSortCategory);

    if (nextSortCategory === 'random' && !wasRandomSortActive) {
      setPhotoGridRandomSeed((currentSeed) => createNextPhotoGridRandomSeed(currentSeed));
    }
  }

  function reshufflePhotoGridSort(): void {
    setPhotoGridRandomSeed((currentSeed) => createNextPhotoGridRandomSeed(currentSeed));
  }

  function openPhotoGridPhoto(photoId: string): void {
    setPhotoViewerRandomizedSlideshowPhotoIds(null);
    setIsPhotoViewerSlideshowActive(false);
    onOpenPhoto(photoId);
  }

  function startRandomizedPhotoGridSlideshow(): void {
    if (visiblePhotos.length === 0) {
      return;
    }

    const shuffledPhotos = sortPhotos(visiblePhotos, 'random', 'asc', createPhotoGridRandomSeed());
    const firstPhoto = shuffledPhotos[0];
    if (!firstPhoto) {
      return;
    }

    clearPhotoViewerTransitionTimer();
    setPhotoViewerTransitionState(null);
    photoViewerPendingNavigationOffsetRef.current = null;
    setPhotoViewerFilmStripVirtualCenter(null);
    setPhotoViewerRandomizedSlideshowPhotoIds(shuffledPhotos.map((photo) => photo.id));
    setIsPhotoViewerSlideshowActive(shuffledPhotos.length > 1);
    onOpenPhoto(firstPhoto.id);
  }

  function openFavoriteBrowser(tagId: string | null = null, options: { resetSearch?: boolean } = {}): void {
    setFavoriteBrowseTagId(tagId);
    setIsFavoriteBrowserOpen(true);
    if (options.resetSearch === true) {
      setPhotoSearch('');
    }
    setNotice(null);
    setFavoriteBrowseError(null);
    onClosePhotoViewer();
  }

  function closeFavoriteBrowser(): void {
    setIsFavoriteBrowserOpen(false);
    setFavoriteBrowseTagId(null);
    setPhotoSearch('');
    setFavoriteBrowseError(null);
    onClosePhotoViewer();
  }

  async function searchPhotoCollectionTags(query: string): Promise<PhotoCatalogTag[]> {
    try {
      const searchParameters = new URLSearchParams({
        search: query,
        limit: '10'
      });
      const payload = await fetchJson(`/api/photos/tags?${searchParameters.toString()}`, undefined, onUnauthorized);
      return parsePhotoCatalogTagsPayload(payload);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Tags could not be loaded.' });
      return [];
    }
  }

  async function requestAddCollectionTag(collectionId: string, label: string): Promise<PhotoCollection | null> {
    setNotice(null);
    try {
      const payload = await fetchJson(
        `/api/photos/collections/${encodeURIComponent(collectionId)}/tags`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label })
        },
        onUnauthorized
      );
      const updatedCollection = parsePhotoCollectionUpdatePayload(payload);
      if (!updatedCollection) {
        throw new Error('Tag update response was invalid.');
      }

      setDetail((current) =>
        current && current.collection.id === updatedCollection.id
          ? { ...current, collection: updatedCollection }
          : current
      );
      onCollectionUpdated(updatedCollection);
      await onTagsChanged?.();
      return updatedCollection;
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Tag could not be added.' });
      return null;
    }
  }

  async function requestRemoveCollectionTag(collectionId: string, tagId: string): Promise<PhotoCollection | null> {
    setNotice(null);
    try {
      const payload = await fetchJson(
        `/api/photos/collections/${encodeURIComponent(collectionId)}/tags/${encodeURIComponent(tagId)}`,
        { method: 'DELETE' },
        onUnauthorized
      );
      const updatedCollection = parsePhotoCollectionUpdatePayload(payload);
      if (!updatedCollection) {
        throw new Error('Tag update response was invalid.');
      }

      setDetail((current) =>
        current && current.collection.id === updatedCollection.id
          ? { ...current, collection: updatedCollection }
          : current
      );
      onCollectionUpdated(updatedCollection);
      await onTagsChanged?.();
      return updatedCollection;
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Tag could not be removed.' });
      return null;
    }
  }

  const handleAddTag = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!detail || newTagLabel.trim() === '') {
      return;
    }

    setIsTagBusy(true);
    try {
      const updatedCollection = await requestAddCollectionTag(detail.collection.id, newTagLabel.trim());
      if (updatedCollection) {
        setNewTagLabel('');
      }
    } finally {
      setIsTagBusy(false);
    }
  };

  const handleRemoveTag = async (tagId: string): Promise<void> => {
    if (!detail) {
      return;
    }

    setIsTagBusy(true);
    try {
      await requestRemoveCollectionTag(detail.collection.id, tagId);
    } finally {
      setIsTagBusy(false);
    }
  };

  const requestDeleteCollection = async (collection: PhotoCollection): Promise<boolean> => {
    setNotice(null);
    try {
      await fetchJson(`/api/photos/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' }, onUnauthorized);
      setFavoritePhotoIdsByCollection((currentFavorites) => {
        if (!currentFavorites[collection.id]) {
          return currentFavorites;
        }

        const nextFavorites = { ...currentFavorites };
        delete nextFavorites[collection.id];
        return nextFavorites;
      });
      setFavoriteCollectionDetailsById((currentDetails) => {
        if (!currentDetails[collection.id]) {
          return currentDetails;
        }

        const nextDetails = { ...currentDetails };
        delete nextDetails[collection.id];
        return nextDetails;
      });
      setDetail((currentDetail) => (currentDetail?.collection.id === collection.id ? null : currentDetail));
      onCollectionDeleted(collection.id);
      setInfoCollectionId((currentCollectionId) => (currentCollectionId === collection.id ? null : currentCollectionId));
      if (selectedCollectionId === collection.id) {
        onBackToCollections();
      }
      return true;
    } catch (error) {
      console.warn('photo.collection.delete.failed', {
        collectionId: collection.id,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  };

  function openViewerPhotoAtOffset(
    offset: number,
    options: { preserveControlsVisibility?: boolean; useSlideshowTransition?: boolean } = {}
  ): void {
    if (isPhotoThumbnailCropModeActive || !viewerPhoto || viewerOrderedPhotos.length === 0) {
      return;
    }

    const currentIndex = viewerOrderedPhotos.findIndex((photo) => photo.id === viewerPhoto.id);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + offset + viewerOrderedPhotos.length) % viewerOrderedPhotos.length;
    const nextPhoto = viewerOrderedPhotos[nextIndex];
    if (nextPhoto) {
      const isChangingPhoto = nextPhoto.id !== viewerPhoto.id;
      if (options.preserveControlsVisibility === true && isChangingPhoto) {
        preserveControlsVisibilityForNextPhotoChangeRef.current = true;
      }

      if (isChangingPhoto) {
        photoViewerPendingNavigationOffsetRef.current = offset;
        setPhotoViewerFilmStripVirtualCenter((currentCenter) =>
          currentCenter !== null &&
          currentCenter.photoId === viewerPhoto.id &&
          currentCenter.orderedPhotoIds === viewerOrderedPhotoIds
            ? {
                photoId: nextPhoto.id,
                orderedPhotoIds: viewerOrderedPhotoIds,
                virtualIndex: currentCenter.virtualIndex + offset
              }
            : {
                photoId: nextPhoto.id,
                orderedPhotoIds: viewerOrderedPhotoIds,
                virtualIndex: currentIndex === -1 ? nextIndex : currentIndex + offset
              }
        );
      }

      if (
        isChangingPhoto &&
        !isPhotoViewerFilmStripViewMode &&
        options.useSlideshowTransition === true &&
        photoViewerStandardSlideshowMode !== 'cut'
      ) {
        clearPhotoViewerTransitionTimer();
        photoViewerTransitionSequenceRef.current += 1;
        const outgoingFrameStyle =
          photoViewerStandardSlideshowMode === 'ken-burns'
            ? capturePhotoViewerFrameTransformStyle(photoViewerCurrentFrameRef.current)
            : {};
        setPhotoViewerTransitionState({
          id: photoViewerTransitionSequenceRef.current,
          incomingPhotoId: nextPhoto.id,
          outgoingPhoto: viewerPhoto,
          outgoingFrameStyle,
          outgoingImageStyle: photoViewerImageStyle,
          direction: offset < 0 ? 'previous' : 'next',
          mode: photoViewerStandardSlideshowMode
        });
      } else if (isChangingPhoto) {
        clearPhotoViewerTransitionTimer();
        setPhotoViewerTransitionState(null);
      }

      onOpenPhoto(nextPhoto.id);
    }
  }

  useEffect(() => {
    clearPhotoViewerSlideshowTimer();

    if (!isPhotoViewerSlideshowActive) {
      return;
    }

    if (!viewerPhoto || !canPhotoViewerSlideshowAdvance) {
      setIsPhotoViewerSlideshowActive(false);
      return;
    }

    photoViewerSlideshowTimerRef.current = window.setTimeout(() => {
      openViewerPhotoAtOffset(1, { preserveControlsVisibility: true, useSlideshowTransition: true });
    }, photoViewerSlideshowDelayMs);

    return () => {
      clearPhotoViewerSlideshowTimer();
    };
  }, [
    canPhotoViewerSlideshowAdvance,
    isPhotoViewerFilmStripLayout,
    isPhotoViewerSlideshowActive,
    photoViewerSlideshowDelayMs,
    photoViewerSlideshowMode,
    viewerPhoto?.id,
    viewerOrderedPhotoIds
  ]);

  useEffect(() => {
    if (photoViewerTransitionState === null) {
      return;
    }

    clearPhotoViewerTransitionTimer();
    photoViewerTransitionTimerRef.current = window.setTimeout(() => {
      photoViewerTransitionTimerRef.current = null;
      setPhotoViewerTransitionState((currentState) =>
        currentState?.id === photoViewerTransitionState.id ? null : currentState
      );
    }, PHOTO_VIEWER_TRANSITION_DURATION_MS + 120);

    return () => {
      clearPhotoViewerTransitionTimer();
    };
  }, [photoViewerTransitionState?.id]);

  const handleViewerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    notePhotoViewerActivity();

    if (isPhotoViewerSlideDurationSelectTarget(event.target)) {
      return;
    }

    const lowerKey = event.key.toLowerCase();
    const hasShortcutModifier = event.altKey || event.ctrlKey || event.metaKey;
    const isSpaceKey = !hasShortcutModifier && (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space');
    const isFavoriteKey = !hasShortcutModifier && (lowerKey === 'l' || event.code === 'KeyL');
    const isFitModeKey = !hasShortcutModifier && (lowerKey === 'f' || event.code === 'KeyF');
    const isThumbnailKey = !hasShortcutModifier && (lowerKey === 't' || event.code === 'KeyT');
    const isViewModeKey = !hasShortcutModifier && (lowerKey === 'v' || event.code === 'KeyV');
    const isCancelCropKey = !hasShortcutModifier && (event.key === 'Escape' || lowerKey === 'c' || event.code === 'KeyC');
    const isCloseKey = !hasShortcutModifier && (lowerKey === 'x' || event.code === 'KeyX');

    if (isPhotoThumbnailCropModeActive) {
      if (isThumbnailKey) {
        event.preventDefault();
        if (!event.repeat) {
          void confirmPhotoThumbnailCropSelection();
        }
        return;
      }

      if (isCancelCropKey) {
        event.preventDefault();
        if (!event.repeat) {
          exitPhotoThumbnailCropSelection();
        }
        return;
      }

      if (isCloseKey) {
        event.preventDefault();
        requestClosePhotoViewer();
        return;
      }

      if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        if (!event.repeat) {
          const nudgeAmount = event.shiftKey
            ? PHOTO_COLLECTION_THUMBNAIL_CROP_KEYBOARD_NUDGE_PX * 4
            : PHOTO_COLLECTION_THUMBNAIL_CROP_KEYBOARD_NUDGE_PX;
          if (event.key === 'ArrowLeft') {
            nudgePhotoThumbnailCropSelection(-nudgeAmount, 0);
          } else if (event.key === 'ArrowRight') {
            nudgePhotoThumbnailCropSelection(nudgeAmount, 0);
          } else if (event.key === 'ArrowUp') {
            nudgePhotoThumbnailCropSelection(0, -nudgeAmount);
          } else if (event.key === 'ArrowDown') {
            nudgePhotoThumbnailCropSelection(0, nudgeAmount);
          }
        }
        return;
      }

      if (isSpaceKey || isFavoriteKey || isFitModeKey || isViewModeKey) {
        event.preventDefault();
        return;
      }

      return;
    }

    if (event.shiftKey && event.key.startsWith('Arrow')) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      openViewerPhotoAtOffset(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      openViewerPhotoAtOffset(1);
      return;
    }

    if (!event.shiftKey && !hasShortcutModifier && event.key === 'ArrowUp') {
      event.preventDefault();
      adjustPhotoViewerSlideshowDelay(-PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS);
      return;
    }

    if (!event.shiftKey && !hasShortcutModifier && event.key === 'ArrowDown') {
      event.preventDefault();
      adjustPhotoViewerSlideshowDelay(PHOTO_VIEWER_SLIDESHOW_DELAY_STEP_MS);
      return;
    }

    if (isSpaceKey && !isKeyboardEventFromInteractiveElement(event.target)) {
      event.preventDefault();
      if (!event.repeat) {
        togglePhotoViewerSlideshow();
      }
      return;
    }

    if (isFavoriteKey) {
      event.preventDefault();
      if (!event.repeat) {
        handleToggleViewerPhotoFavorite();
      }
      return;
    }

    if (isFitModeKey) {
      event.preventDefault();
      if (!event.repeat) {
        togglePhotoViewerFitMode();
      }
      return;
    }

    if (isThumbnailKey && isCollectionThumbnailActionAvailable) {
      event.preventDefault();
      if (!event.repeat) {
        void handleSetCollectionThumbnail();
      }
      return;
    }

    if (isViewModeKey) {
      event.preventDefault();
      if (!event.repeat) {
        cyclePhotoViewerViewMode();
      }
      return;
    }

    if (lowerKey === 'c' || lowerKey === 'x') {
      event.preventDefault();
      requestClosePhotoViewer();
    }
  };

  const activePhotoViewerTransitionState =
    !isPhotoViewerFilmStripViewMode &&
    photoViewerTransitionState !== null &&
    viewerPhoto !== null &&
    photoViewerTransitionState.incomingPhotoId === viewerPhoto.id
      ? photoViewerTransitionState
      : null;
  const isPhotoViewerTransitionActive = activePhotoViewerTransitionState !== null;
  const activePhotoViewerTransitionMode = activePhotoViewerTransitionState?.mode ?? null;
  const activePhotoViewerTransitionDirection = activePhotoViewerTransitionState?.direction ?? null;
  const isPhotoViewerKenBurnsActive =
    !isPhotoViewerFilmStripViewMode &&
    viewerPhoto !== null &&
    isPhotoViewerSlideshowActive &&
    canPhotoViewerSlideshowAdvance &&
    photoViewerStandardSlideshowMode === 'ken-burns';
  const photoViewerKenBurnsVariant = viewerPhoto
    ? getPhotoViewerKenBurnsVariant(viewerPhoto)
    : PHOTO_VIEWER_KEN_BURNS_VARIANTS[0];
  const photoViewerFilmStripKenBurnsVariant = viewerPhoto
    ? getPhotoViewerFilmStripKenBurnsVariant(viewerPhoto)
    : PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_VARIANTS[0];
  const photoViewerFilmStripCurrentFrameStyle = {
    ...photoViewerFrameStyle,
    '--photo-viewer-film-strip-ken-burns-duration': `${
      viewerPhoto
        ? getPhotoViewerFilmStripKenBurnsDurationMs(viewerPhoto, photoViewerSlideshowDelayMs)
        : PHOTO_VIEWER_FILM_STRIP_KEN_BURNS_MIN_DURATION_MS
    }ms`
  } as CSSProperties;
  const photoViewerCurrentFrameClassName = joinClassNames(
    'photo-viewer-frame',
    'is-current',
    isPhotoViewerTransitionActive && 'is-transition-in',
    activePhotoViewerTransitionMode && `is-transition-mode-${activePhotoViewerTransitionMode}`,
    activePhotoViewerTransitionDirection && `is-direction-${activePhotoViewerTransitionDirection}`,
    isPhotoViewerKenBurnsActive && 'is-ken-burns-active',
    isPhotoViewerKenBurnsActive && `is-ken-burns-${photoViewerKenBurnsVariant}`
  );
  const photoViewerOutgoingFrameClassName = activePhotoViewerTransitionState !== null
    ? joinClassNames(
        'photo-viewer-frame',
        'is-outgoing',
        'is-transition-out',
        `is-transition-mode-${activePhotoViewerTransitionState.mode}`,
        `is-direction-${activePhotoViewerTransitionState.direction}`
      )
    : '';
  const photoViewerOutgoingFrameStyle = activePhotoViewerTransitionState !== null
    ? {
        ...photoViewerFrameStyle,
        ...activePhotoViewerTransitionState.outgoingFrameStyle
      }
    : photoViewerFrameStyle;
  const photoViewerStageClassName = joinClassNames(
    'photo-viewer-stage',
    isPhotoViewerFilmStripLayout ? 'is-layout-film-strip' : 'is-layout-standard',
    isPhotoThumbnailCropModeActive && 'is-thumbnail-crop-mode'
  );

  const photoViewerOverlayClassName = joinClassNames(
    'photo-viewer-overlay',
    isPhotoThumbnailCropModeActive && 'is-thumbnail-crop-mode'
  );

  const photoViewerOverlay = viewerPhoto ? (
          <div
            ref={viewerOverlayRef}
            className={photoViewerOverlayClassName}
            role="dialog"
            aria-modal="true"
            aria-label={viewerPhoto.originalName}
            tabIndex={-1}
            onKeyDown={handleViewerKeyDown}
            onMouseMove={notePhotoViewerActivity}
            onMouseDown={notePhotoViewerActivity}
            onPointerDown={notePhotoViewerActivity}
            onTouchStart={notePhotoViewerActivity}
            onWheel={notePhotoViewerActivity}
            onFocusCapture={notePhotoViewerActivity}
          >
            <div
              ref={photoViewerHeaderRef}
              className={`photo-viewer-header viewer-header${arePhotoViewerControlsVisible ? '' : ' is-hidden'}`}
            >
              <div className="viewer-metadata photo-viewer-metadata">
                <div className="viewer-metadata-line">
                  <h2 className="viewer-title-heading" title={viewerPhoto.originalName}>
                    {viewerPhoto.originalName}
                  </h2>
                  <span className="viewer-metadata-separator" aria-hidden="true">
                    •
                  </span>
                  <span className="viewer-metadata-detail">
                    {viewerPhoto.width && viewerPhoto.height ? `${viewerPhoto.width}×${viewerPhoto.height}` : 'Image'}
                  </span>
                  <span className="viewer-metadata-separator" aria-hidden="true">
                    •
                  </span>
                  <span className="viewer-metadata-detail">{formatBytes(viewerPhoto.sizeBytes)}</span>
                  <span className="viewer-metadata-separator" aria-hidden="true">
                    •
                  </span>
                  <span className="viewer-metadata-detail">{pluralize(viewerPhoto.viewCount, 'view')}</span>
                  {viewerPhotoCollection && isFavoriteBrowserActive ? (
                    <>
                      <span className="viewer-metadata-separator" aria-hidden="true">
                        •
                      </span>
                      <span className="viewer-metadata-detail">{viewerPhotoCollection.name}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="viewer-toolbar-group photo-viewer-toolbar-actions">
                <button
                  type="button"
                  className={`viewer-toolbar-button viewer-toolbar-button-text photo-viewer-favorite-toggle${
                    isViewerPhotoFavorite ? ' is-favorite' : ''
                  }`}
                  onClick={handleToggleViewerPhotoFavorite}
                  disabled={isPhotoThumbnailCropModeActive}
                  aria-pressed={isViewerPhotoFavorite}
                  aria-label={
                    isViewerPhotoFavorite
                      ? `Remove ${viewerPhoto.originalName} from favorites. Shortcut: L`
                      : `Mark ${viewerPhoto.originalName} as favorite. Shortcut: L`
                  }
                  title={isViewerPhotoFavorite ? 'Remove favorite. Shortcut: L' : 'Mark as favorite. Shortcut: L'}
                >
                  <span className="photo-viewer-favorite-glyph" aria-hidden="true">♥</span>
                  <span>{isViewerPhotoFavorite ? 'Favorited' : 'Favorite'}</span>
                  <span className="viewer-shortcut-key" aria-hidden="true">L</span>
                </button>
                <button
                  type="button"
                  className="viewer-toolbar-button viewer-toolbar-button-text"
                  onClick={togglePhotoViewerFitMode}
                  disabled={isPhotoThumbnailCropModeActive}
                  aria-pressed={photoViewerFitMode === 'fill'}
                  aria-label={
                    photoViewerFitMode === 'fit'
                      ? 'Switch photo viewer to fill mode. Shortcut: F'
                      : 'Switch photo viewer to fit mode. Shortcut: F'
                  }
                  title={
                    photoViewerFitMode === 'fit'
                      ? 'Fill the available photo viewer area. Shortcut: F'
                      : 'Fit the entire photo in the photo viewer area. Shortcut: F'
                  }
                >
                  <span>{photoViewerFitMode === 'fit' ? 'Fill' : 'Fit'}</span>
                  <span className="viewer-shortcut-key" aria-hidden="true">F</span>
                </button>
                {isCollectionThumbnailActionAvailable ? (
                  <button
                    type="button"
                    className={joinClassNames(
                      'viewer-toolbar-button',
                      'viewer-toolbar-button-text',
                      isPhotoThumbnailCropModeActive && 'is-crop-confirm'
                    )}
                    onClick={() => void handleSetCollectionThumbnail()}
                    disabled={isCollectionThumbnailBusy}
                    aria-label={
                      isPhotoThumbnailCropModeActive
                        ? 'Confirm the selected collection thumbnail crop. Shortcut: T'
                        : 'Choose a crop for this photo as the collection thumbnail. Shortcut: T'
                    }
                    title={
                      isPhotoThumbnailCropModeActive
                        ? 'Confirm the selected collection thumbnail crop. Shortcut: T'
                        : 'Choose a crop for this photo as the collection thumbnail. Shortcut: T'
                    }
                  >
                    <span>{isPhotoThumbnailCropModeActive ? 'Confirm crop' : 'Set thumbnail'}</span>
                    <span className="viewer-shortcut-key" aria-hidden="true">T</span>
                  </button>
                ) : null}
                {isPhotoThumbnailCropModeActive ? (
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-text"
                    onClick={() => exitPhotoThumbnailCropSelection()}
                    disabled={isCollectionThumbnailBusy}
                    aria-label="Cancel collection thumbnail crop selection. Shortcut: C or Escape"
                    title="Cancel collection thumbnail crop selection. Shortcut: C or Escape"
                  >
                    <span>Cancel crop</span>
                    <span className="viewer-shortcut-key" aria-hidden="true">C</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="viewer-toolbar-button viewer-toolbar-button-text viewer-toolbar-button-close"
                  onClick={requestClosePhotoViewer}
                  aria-label={isPhotoThumbnailCropModeActive ? 'Close photo viewer. Shortcut: X' : 'Close photo viewer. Shortcuts: C or X'}
                  title={isPhotoThumbnailCropModeActive ? 'Close photo viewer. Shortcut: X' : 'Close photo viewer. Shortcuts: C or X'}
                >
                  <span>Close</span>
                  <span className="viewer-shortcut-key" aria-hidden="true">{isPhotoThumbnailCropModeActive ? 'X' : 'C'}</span>
                </button>
              </div>
              <div className="photo-viewer-center-controls" role="group" aria-label="Photo slideshow and view controls">
                <label
                  className="viewer-toolbar-indicator photo-viewer-slide-duration"
                  title={`Each slide displays for ${photoViewerSlideDurationDescription}. Up/Down arrows adjust by 0.5s.`}
                >
                  <span className="photo-viewer-slide-duration-label">Pace</span>
                  <select
                    className="photo-viewer-slide-duration-select"
                    value={photoViewerSlideshowDelayMs}
                    onChange={handlePhotoViewerSlideshowDelayChange}
                    disabled={isPhotoThumbnailCropModeActive}
                    aria-label={`Slideshow slide duration. Current value: ${photoViewerSlideDurationDescription}. Up Arrow speeds up; Down Arrow slows down.`}
                    title={`Each slide displays for ${photoViewerSlideDurationDescription}. Up/Down arrows adjust by 0.5s.`}
                  >
                    {PHOTO_VIEWER_SLIDESHOW_DELAY_OPTIONS_MS.map((durationMs) => (
                      <option key={durationMs} value={durationMs}>
                        {formatPhotoViewerSlideDuration(durationMs)}
                      </option>
                    ))}
                  </select>
                  <span className="sr-only" aria-live="polite">
                    {photoViewerSlideDurationLabel}
                  </span>
                </label>
                <label
                  className="viewer-toolbar-indicator photo-viewer-slideshow-style"
                  title={photoViewerSlideshowModeDescription}
                >
                  <span className="photo-viewer-slideshow-style-label">Style</span>
                  <select
                    className="photo-viewer-slideshow-style-select"
                    value={photoViewerSlideshowMode}
                    onChange={handlePhotoViewerSlideshowModeChange}
                    disabled={isPhotoThumbnailCropModeActive}
                    aria-label={`Slideshow style for ${photoViewerLayoutModeOption.label} view. Current value: ${photoViewerSlideshowModeOption.label}.`}
                    title={photoViewerSlideshowModeDescription}
                  >
                    {photoViewerSlideshowModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="sr-only" aria-live="polite">
                    Slideshow style: {photoViewerSlideshowModeOption.label}
                  </span>
                </label>
                <div
                  className="viewer-toolbar-group viewer-transport-group photo-viewer-slideshow-transport"
                  role="group"
                  aria-label="Photo slideshow navigation"
                >
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-transport photo-viewer-slideshow-button"
                    onClick={showPreviousViewerPhoto}
                    disabled={!canPhotoViewerSlideshowAdvance || isPhotoThumbnailCropModeActive}
                    aria-label="Previous photo"
                    title="Previous photo"
                  >
                    <PhotoViewerPreviousIcon />
                  </button>
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-primary viewer-toolbar-button-transport photo-viewer-slideshow-button photo-viewer-slideshow-play-button"
                    onClick={togglePhotoViewerSlideshow}
                    disabled={!canPhotoViewerSlideshowAdvance || isPhotoThumbnailCropModeActive}
                    aria-pressed={isPhotoViewerSlideshowActive}
                    aria-label={
                      isPhotoViewerSlideshowActive
                        ? 'Pause photo slideshow. Shortcut: Space'
                        : 'Play photo slideshow. Shortcut: Space'
                    }
                    title={
                      isPhotoViewerSlideshowActive
                        ? 'Pause photo slideshow. Shortcut: Space'
                        : 'Play photo slideshow. Shortcut: Space'
                    }
                  >
                    {isPhotoViewerSlideshowActive ? <PhotoViewerPauseIcon /> : <PhotoViewerPlayIcon />}
                  </button>
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-transport photo-viewer-slideshow-button"
                    onClick={showNextViewerPhoto}
                    disabled={!canPhotoViewerSlideshowAdvance || isPhotoThumbnailCropModeActive}
                    aria-label="Next photo"
                    title="Next photo"
                  >
                    <PhotoViewerNextIcon />
                  </button>
                </div>
                <div className="photo-viewer-view-controls" role="group" aria-label="Photo viewer view mode">
                  <label
                    className="viewer-toolbar-indicator photo-viewer-layout"
                    title={`${photoViewerLayoutModeDescription} Shortcut: V cycles view modes.`}
                  >
                    <span className="photo-viewer-layout-label">View</span>
                    <select
                      className="photo-viewer-layout-select"
                      value={photoViewerLayoutMode}
                      onChange={handlePhotoViewerLayoutModeChange}
                      disabled={isPhotoThumbnailCropModeActive}
                      aria-label={`Photo viewer view mode. Current value: ${photoViewerLayoutModeOption.label}. Shortcut: V cycles view modes.`}
                      title={`${photoViewerLayoutModeDescription} Shortcut: V cycles view modes.`}
                    >
                      {PHOTO_VIEWER_LAYOUT_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span className="sr-only" aria-live="polite">
                      Photo viewer view: {photoViewerLayoutModeOption.label}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-text photo-viewer-view-cycle-button"
                    onClick={cyclePhotoViewerViewMode}
                    disabled={isPhotoThumbnailCropModeActive}
                    aria-label={`Cycle photo viewer view mode. Current view: ${photoViewerLayoutModeOption.label}. Shortcut: V`}
                    title={`Cycle photo viewer view mode. Current view: ${photoViewerLayoutModeOption.label}. Shortcut: V`}
                  >
                    <span>View</span>
                    <span className="viewer-shortcut-key" aria-hidden="true">V</span>
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              className={joinClassNames(
                'photo-viewer-nav',
                'is-previous',
                !arePhotoViewerControlsVisible && 'is-hidden'
              )}
              onClick={(event) => handlePhotoViewerSideNavClick(-1, event)}
              onPointerDown={stopPhotoViewerSideNavActivityPropagation}
              onMouseDown={preventPhotoViewerSideNavMouseActivity}
              onTouchStart={stopPhotoViewerSideNavActivityPropagation}
              disabled={isPhotoThumbnailCropModeActive}
              tabIndex={arePhotoViewerControlsVisible ? undefined : -1}
              aria-label="Previous photo"
            >
              ‹
            </button>
            <div ref={photoViewerStageRef} className={photoViewerStageClassName} onWheel={handlePhotoViewerWheel}>
              {isPhotoViewerFilmStripLayout ? (
                <div className="photo-viewer-film-strip" aria-label="Film strip photo layout">
                  {photoViewerFilmStripFrames.map((filmStripFrame) => {
                    const isCurrentFilmStripFrame = filmStripFrame.offset === 0;
                    const filmStripFrameStyle: CSSProperties = {
                      ...(isCurrentFilmStripFrame ? photoViewerFilmStripCurrentFrameStyle : {}),
                      width: `${filmStripFrame.width}px`,
                      height: `${filmStripFrame.height}px`,
                      opacity: filmStripFrame.opacity,
                      zIndex: filmStripFrame.zIndex,
                      transform: `translate3d(calc(-50% + ${Number(filmStripFrame.x.toFixed(2))}px), -50%, 0)`
                    };
                    const filmStripFrameClassName = joinClassNames(
                      'photo-viewer-film-strip-frame',
                      isCurrentFilmStripFrame ? 'is-current' : 'is-neighbor',
                      isCurrentFilmStripFrame &&
                        isPhotoViewerFilmStripKenBurnsActive &&
                        'is-film-strip-ken-burns-active',
                      isCurrentFilmStripFrame &&
                        isPhotoViewerFilmStripKenBurnsActive &&
                        `is-film-strip-ken-burns-${photoViewerFilmStripKenBurnsVariant}`,
                      filmStripFrame.offset < 0 && 'is-before',
                      filmStripFrame.offset > 0 && 'is-after',
                      filmStripFrame.distance > 1 && 'is-distant'
                    );

                    if (isCurrentFilmStripFrame) {
                      return (
                        <div
                          ref={photoViewerCurrentFrameRef}
                          key={filmStripFrame.key}
                          className={filmStripFrameClassName}
                          style={filmStripFrameStyle}
                        >
                          <div className="photo-viewer-film-strip-current-image-shell">
                            <PhotoImage
                              className="photo-viewer-image"
                              photo={viewerPhoto}
                              source="original"
                              alt={viewerPhoto.originalName}
                              draggable={false}
                              onDragStart={(event: ReactDragEvent<HTMLImageElement>) => event.preventDefault()}
                              onLoad={handlePhotoViewerImageLoad}
                              onPointerDown={handlePhotoViewerImagePointerDown}
                              onPointerMove={handlePhotoViewerImagePointerMove}
                              onPointerUp={handlePhotoViewerImagePointerUp}
                              onPointerCancel={handlePhotoViewerImagePointerUp}
                              style={photoViewerImageStyle}
                            />
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={filmStripFrame.key}
                        className={filmStripFrameClassName}
                        style={filmStripFrameStyle}
                        aria-hidden="true"
                      >
                        <PhotoImage
                          className="photo-viewer-film-strip-image"
                          photo={filmStripFrame.photo}
                          source="original"
                          alt=""
                          loading={filmStripFrame.distance <= 2 ? 'eager' : 'lazy'}
                          decoding="async"
                          draggable={false}
                          onDragStart={(event: ReactDragEvent<HTMLImageElement>) => event.preventDefault()}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <>
                  {activePhotoViewerTransitionState !== null ? (
                    <div
                      key={`outgoing-${activePhotoViewerTransitionState.id}`}
                      className={photoViewerOutgoingFrameClassName}
                      style={photoViewerOutgoingFrameStyle}
                      aria-hidden="true"
                    >
                      <PhotoImage
                        className="photo-viewer-image"
                        photo={activePhotoViewerTransitionState.outgoingPhoto}
                        source="original"
                        alt=""
                        draggable={false}
                        onDragStart={(event: ReactDragEvent<HTMLImageElement>) => event.preventDefault()}
                        style={activePhotoViewerTransitionState.outgoingImageStyle}
                      />
                    </div>
                  ) : null}
                  <div
                    ref={photoViewerCurrentFrameRef}
                    key={`current-${viewerPhoto.id}`}
                    className={photoViewerCurrentFrameClassName}
                    style={photoViewerFrameStyle}
                  >
                    <PhotoImage
                      className="photo-viewer-image"
                      photo={viewerPhoto}
                      source="original"
                      alt={viewerPhoto.originalName}
                      draggable={false}
                      onDragStart={(event: ReactDragEvent<HTMLImageElement>) => event.preventDefault()}
                      onLoad={handlePhotoViewerImageLoad}
                      onPointerDown={handlePhotoViewerImagePointerDown}
                      onPointerMove={handlePhotoViewerImagePointerMove}
                      onPointerUp={handlePhotoViewerImagePointerUp}
                      onPointerCancel={handlePhotoViewerImagePointerUp}
                      style={photoViewerImageStyle}
                    />
                  </div>
                </>
              )}
              {isPhotoThumbnailCropModeActive && photoThumbnailCropBoxStyle ? (
                <div
                  className="photo-thumbnail-crop-layer"
                  onPointerMove={handlePhotoThumbnailCropPointerMove}
                  onPointerUp={handlePhotoThumbnailCropPointerUp}
                  onPointerCancel={handlePhotoThumbnailCropPointerUp}
                >
                  {photoThumbnailCropImageBoundsStyle ? (
                    <div className="photo-thumbnail-crop-image-bounds" style={photoThumbnailCropImageBoundsStyle} />
                  ) : null}
                  <div
                    className="photo-thumbnail-crop-box"
                    style={photoThumbnailCropBoxStyle}
                    role="presentation"
                    onPointerDown={handlePhotoThumbnailCropBoxPointerDown}
                  >
                    {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                      <button
                        key={handle}
                        type="button"
                        className={`photo-thumbnail-crop-handle is-${handle}`}
                        onPointerDown={(event) => handlePhotoThumbnailCropHandlePointerDown(handle, event)}
                        aria-label={`Resize thumbnail crop from the ${handle.toUpperCase()} corner`}
                        title="Drag to resize crop"
                      />
                    ))}
                  </div>
                  <div className="photo-thumbnail-crop-instructions" role="status" aria-live="polite">
                    <strong>Choose collection thumbnail crop</strong>
                    <span>Drag the 4:3 frame to move it. Drag a corner to resize. Press T to confirm, C or Esc to cancel.</span>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={joinClassNames(
                'photo-viewer-nav',
                'is-next',
                !arePhotoViewerControlsVisible && 'is-hidden'
              )}
              onClick={(event) => handlePhotoViewerSideNavClick(1, event)}
              onPointerDown={stopPhotoViewerSideNavActivityPropagation}
              onMouseDown={preventPhotoViewerSideNavMouseActivity}
              onTouchStart={stopPhotoViewerSideNavActivityPropagation}
              disabled={isPhotoThumbnailCropModeActive}
              tabIndex={arePhotoViewerControlsVisible ? undefined : -1}
              aria-label="Next photo"
            >
              ›
            </button>
          </div>
  ) : null;

  if (isFavoriteBrowserActive) {
    const favoriteBrowserMeta = `${pluralize(favoriteBrowseKnownFavoriteCount, 'favorite photo')} across ${pluralize(
      favoriteBrowseCollections.length,
      'collection'
    )}`;
    const favoriteBrowserEmptyTitle =
      favoriteBrowseKnownFavoriteCount === 0
        ? favoriteBrowseTag
          ? `No favorites tagged ${favoriteBrowseTag.label}`
          : 'No favorite photos yet'
        : photoSearch.trim() !== ''
          ? 'No matching favorite photos'
          : 'No favorite photos loaded';
    const favoriteBrowserEmptyMessage =
      favoriteBrowseKnownFavoriteCount === 0
        ? favoriteBrowseTag
          ? 'Favorite photos from collections with this tag will appear here.'
          : 'Mark photos with the heart button inside any photo collection to build this view.'
        : photoSearch.trim() !== ''
          ? 'Try a different filename, collection, or tag search.'
          : 'Favorite photos are still loading or could not be loaded.';
    const isFavoriteBrowserEmpty = favoriteBrowseEntries.length === 0 && !isFavoriteBrowseLoading;

    return (
      <section className="photo-catalog-view photo-collection-detail-view photo-favorites-browser-view" aria-label="Photo favorites browser">
        <PhotoCatalogNotice notice={notice} />
        {favoriteBrowseError ? <PhotoCatalogNotice notice={{ tone: 'warning', text: favoriteBrowseError }} /> : null}

        <div className="photo-favorites-browser-toolbar" aria-label="Photo favorites controls">
          <div className="photo-favorites-filter-controls" aria-label="Filter favorite photos by collection tag">
            <button
              type="button"
              className={`photo-favorite-tag-chip${favoriteBrowseTagId === null ? ' is-active' : ''}`}
              onClick={() => openFavoriteBrowser(null)}
              aria-pressed={favoriteBrowseTagId === null}
              title="Show all favorite photos"
            >
              <span className="photo-favorite-tag-chip-label">All favorites</span>
              <span className="photo-favorite-tag-chip-count">{photoFavoriteOverview.photoCount}</span>
            </button>
            {photoFavoriteOverview.tags.map((summary) => {
              const isActiveTag = favoriteBrowseTagId === summary.tag.id;
              return (
                <button
                  type="button"
                  key={summary.tag.id}
                  className={`photo-favorite-tag-chip${isActiveTag ? ' is-active' : ''}`}
                  onClick={() => openFavoriteBrowser(isActiveTag ? null : summary.tag.id)}
                  aria-pressed={isActiveTag}
                  aria-label={
                    isActiveTag
                      ? `Clear ${summary.tag.label} favorite photo filter`
                      : `Browse ${pluralize(summary.photoCount, 'favorite photo')} tagged ${summary.tag.label}`
                  }
                  title={
                    isActiveTag
                      ? `Clear ${summary.tag.label} filter`
                      : `Browse ${pluralize(summary.photoCount, 'favorite photo')} tagged ${summary.tag.label}`
                  }
                >
                  <span className="photo-favorite-tag-chip-label">{summary.tag.label}</span>
                  {isActiveTag ? <span className="photo-favorite-tag-chip-clear" aria-hidden="true">×</span> : null}
                  <span className="photo-favorite-tag-chip-count">{summary.photoCount}</span>
                </button>
              );
            })}
            {photoSearch.trim() !== '' ? (
              <button
                type="button"
                className="photo-favorite-active-filter-chip"
                onClick={() => setPhotoSearch('')}
                title="Clear favorite search"
              >
                <span className="photo-favorite-active-filter-label">Search: "{photoSearch.trim()}"</span>
                <span className="photo-favorite-active-filter-clear" aria-hidden="true">×</span>
              </button>
            ) : null}
            <span className="photo-favorites-browser-count" aria-label="Favorite browser metadata">
              {favoriteBrowserMeta}
            </span>
          </div>

          <div className="photo-favorites-browser-controls">
            <label className="photo-grid-search-control" htmlFor="photo-favorites-search">
              <span>Search favorites</span>
              <input
                id="photo-favorites-search"
                type="search"
                value={photoSearch}
                placeholder="Filename, collection, or tag"
                onChange={(event: ChangeEvent<HTMLInputElement>) => setPhotoSearch(event.target.value)}
              />
            </label>
            <label className="photo-grid-sort-control" htmlFor="photo-favorites-sort-category">
              <span>Sort by</span>
              <select
                id="photo-favorites-sort-category"
                value={photoGridSortCategory}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  handlePhotoGridSortCategoryChange(event.target.value as PhotoGridSortCategory);
                }}
              >
                {Object.entries(PHOTO_GRID_SORT_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {isPhotoGridRandomSortActive ? (
              <button
                type="button"
                className="app-button secondary photo-grid-randomize-sort-button"
                onClick={reshufflePhotoGridSort}
                aria-label="Shuffle the current randomized photo order again"
                title="Shuffle the current randomized photo order again"
              >
                Shuffle again
              </button>
            ) : null}
            <button
              type="button"
              className={`sort-direction-button photo-grid-sort-direction-button${isPhotoGridRandomSortActive ? ' is-random-disabled' : ''}`}
              onClick={() => {
                setPhotoGridSortDirection((currentValue) => (currentValue === 'asc' ? 'desc' : 'asc'));
              }}
              disabled={isPhotoGridRandomSortActive}
              aria-label={
                isPhotoGridRandomSortActive
                  ? 'Sort direction is not used while randomized sorting is active.'
                  : `Sort order: ${photoGridSortDirectionLabel}. Toggle sort direction.`
              }
              title={
                isPhotoGridRandomSortActive
                  ? 'Sort direction is not used while randomized sorting is active.'
                  : `Sort ${photoGridSortDirectionLabel}`
              }
            >
              <span className="sort-direction-icon" aria-hidden="true">
                {photoGridSortDirection === 'asc' ? '↑' : '↓'}
              </span>
            </button>
            <button type="button" className="app-button secondary photo-detail-return-button" onClick={closeFavoriteBrowser}>
              Return to home
            </button>
          </div>
        </div>

        {isFavoriteBrowseLoading && favoriteBrowseEntries.length === 0 ? (
          <div className="photo-empty-state">Loading favorite photos…</div>
        ) : null}

        {isFavoriteBrowserEmpty ? (
          <div className="photo-empty-state">
            <h3>{favoriteBrowserEmptyTitle}</h3>
            <p>{favoriteBrowserEmptyMessage}</p>
          </div>
        ) : null}

        {favoriteBrowseEntries.length > 0 ? (
          <div className="photo-grid">
            {favoriteBrowseEntries.map(({ photo, collection }) => (
              <PhotoGridCard
                key={`${collection.id}:${photo.id}`}
                photo={photo}
                isFavorite={isFavoritePhoto(photo)}
                onOpen={openPhotoGridPhoto}
                onToggleFavorite={handleTogglePhotoFavorite}
                contextLabel={collection.name}
              />
            ))}
          </div>
        ) : null}

        {photoViewerOverlay}
      </section>
    );
  }

  if (selectedCollectionId) {
    const collection = detail?.collection ?? collections.find((candidate) => candidate.id === selectedCollectionId) ?? null;

    return (
      <section className="photo-catalog-view photo-collection-detail-view" aria-label="Photo collection detail">

        <PhotoCatalogNotice notice={notice} />

        {collection ? (
          <div className="photo-detail-header">
            <div className="photo-detail-summary">
              <div className="photo-detail-title-line">
                <h2 className="photo-detail-title" title={collection.name}>{collection.name}</h2>
                <div className="photo-detail-inline-meta" aria-label="Collection metadata">
                  <span>{pluralize(collection.photoCount, 'photo')}</span>
                  <span className="photo-detail-meta-separator" aria-hidden="true">·</span>
                  <span>{formatBytes(collection.totalSizeBytes)}</span>
                  <span className="photo-detail-meta-separator" aria-hidden="true">·</span>
                  <span>{pluralize(collection.viewCount, 'view')}</span>
                </div>
              </div>
              {collection.description ? <p className="photo-detail-description">{collection.description}</p> : null}
            </div>
            <div className="photo-detail-action-cluster" aria-label="Photo grid controls">
              <button
                type="button"
                className="app-button secondary photo-grid-random-slideshow-button"
                onClick={startRandomizedPhotoGridSlideshow}
                disabled={visiblePhotos.length < 2}
                aria-label="Start a randomized slideshow from the currently visible photos"
                title={
                  visiblePhotos.length < 2
                    ? 'At least two visible photos are needed to start a randomized slideshow.'
                    : 'Start a randomized slideshow from the currently visible photos.'
                }
              >
                Shuffle slideshow
              </button>
              <label className="photo-grid-sort-control" htmlFor="photo-grid-sort-category">
                <span>Sort by</span>
                <select
                  id="photo-grid-sort-category"
                  value={photoGridSortCategory}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    handlePhotoGridSortCategoryChange(event.target.value as PhotoGridSortCategory);
                  }}
                >
                  {Object.entries(PHOTO_GRID_SORT_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {isPhotoGridRandomSortActive ? (
                <button
                  type="button"
                  className="app-button secondary photo-grid-randomize-sort-button"
                  onClick={reshufflePhotoGridSort}
                  aria-label="Shuffle the current randomized photo order again"
                  title="Shuffle the current randomized photo order again"
                >
                  Shuffle again
                </button>
              ) : null}
              <button
                type="button"
                className={`sort-direction-button photo-grid-sort-direction-button${isPhotoGridRandomSortActive ? ' is-random-disabled' : ''}`}
                onClick={() => {
                  setPhotoGridSortDirection((currentValue) => (currentValue === 'asc' ? 'desc' : 'asc'));
                }}
                disabled={isPhotoGridRandomSortActive}
                aria-label={
                  isPhotoGridRandomSortActive
                    ? 'Sort direction is not used while randomized sorting is active.'
                    : `Sort order: ${photoGridSortDirectionLabel}. Toggle sort direction.`
                }
                title={
                  isPhotoGridRandomSortActive
                    ? 'Sort direction is not used while randomized sorting is active.'
                    : `Sort ${photoGridSortDirectionLabel}`
                }
              >
                <span className="sort-direction-icon" aria-hidden="true">
                  {photoGridSortDirection === 'asc' ? '↑' : '↓'}
                </span>
              </button>
              <button
                type="button"
                className={`app-button secondary photo-grid-favorites-only-toggle${isPhotoFavoritesOnly ? ' is-active' : ''}`}
                onClick={() => setIsPhotoFavoritesOnly((currentValue) => !currentValue)}
                aria-pressed={isPhotoFavoritesOnly}
                aria-label={isPhotoFavoritesOnly ? 'Show all photos' : 'Show favorite photos only'}
                title={isPhotoFavoritesOnly ? 'Showing favorites only' : 'Show favorites only'}
              >
                ♥
              </button>
              <button type="button" className="app-button secondary photo-detail-return-button" onClick={onBackToCollections}>
                Return to home
              </button>
            </div>
          </div>
        ) : null}


        {isDetailLoading ? <div className="photo-empty-state">Loading photo collection…</div> : null}

        {detail && visiblePhotos.length === 0 ? (
          <div className="photo-empty-state">
            <h3>{emptyPhotoStateTitle}</h3>
            <p>{emptyPhotoStateMessage}</p>
          </div>
        ) : null}

        {visiblePhotos.length > 0 ? (
          <div className="photo-grid">
            {visiblePhotos.map((photo) => (
              <PhotoGridCard
                key={photo.id}
                photo={photo}
                isFavorite={selectedFavoritePhotoIds.has(photo.id)}
                onOpen={openPhotoGridPhoto}
                onToggleFavorite={handleTogglePhotoFavorite}
              />
            ))}
          </div>
        ) : null}

        {photoViewerOverlay}

      </section>
    );
  }

  return (
    <section
      className="photo-catalog-view"
      aria-label={isCollectionHomeViewActive ? 'Photo collection home layout sections' : 'Photo collection catalog'}
    >

      <PhotoCatalogNotice notice={notice} />

      {isCollectionHomeViewActive ? (
        <div className="home-view photo-home-view">
          {homeStripViews.length > 0 ? (
            homeStripViews.map((view, index) => (
              <PhotoHomeStripSection
                key={view.strip.id}
                view={view}
                index={index}
                totalCount={homeStripViews.length}
                prioritizeInitialThumbnails={index < PHOTO_HOME_STRIP_EAGER_THUMBNAIL_SECTION_LIMIT}
                onMove={onMoveHomeStrip}
                onEdit={onEditHomeStrip}
                onDelete={onDeleteHomeStrip}
                onSelectCollection={onSelectCollection}
                onOpenInfo={setInfoCollectionId}
                onAddTag={requestAddCollectionTag}
                onRemoveTag={requestRemoveCollectionTag}
                onSearchTags={searchPhotoCollectionTags}
              />
            ))
          ) : (
            <div className="empty-state home-view-empty">
              {collections.length === 0
                ? 'No photo collections yet. Import photos to create your first collection, then save home sections from the side panel.'
                : 'No photo home sections yet. Use the + button in the side panel to save the current search, sort, and tags.'}
            </div>
          )}
        </div>
      ) : (
        <>
          {onReturnHome ? (
            <div className="catalog-panel-header results-view-header photo-results-view-header">
              <div>
                <h2>Photo collection results</h2>
                <p>{pluralize(filteredCollections.length, 'collection')} shown</p>
              </div>
              <button type="button" className="app-button secondary" onClick={onReturnHome}>
                Return to home
              </button>
            </div>
          ) : null}

          {filteredCollections.length === 0 ? (
            <div className="photo-empty-state">
              <h3>{collections.length === 0 ? 'No photo collections yet' : 'No matching collections'}</h3>
              <p>
                {collections.length === 0
                  ? 'Import a ZIP file or individual images to create your first photo collection.'
                  : 'Try clearing search or tag filters.'}
              </p>
              {collections.length === 0 ? (
                <button type="button" className="app-button" onClick={onOpenImport}>
                  Import photos
                </button>
              ) : null}
            </div>
          ) : (
            <div className="photo-collection-grid">
              {filteredCollections.map((collection) => (
                <PhotoCollectionCard
                  key={collection.id}
                  collection={collection}
                  onSelect={onSelectCollection}
                  onOpenInfo={setInfoCollectionId}
                  onAddTag={requestAddCollectionTag}
                  onRemoveTag={requestRemoveCollectionTag}
                  onSearchTags={searchPhotoCollectionTags}
                />
              ))}
            </div>
          )}
        </>
      )}

      {infoCollection ? (
        <PhotoCollectionDetailsModal
          collection={infoCollection}
          onClose={() => setInfoCollectionId(null)}
          onDelete={requestDeleteCollection}
        />
      ) : null}
    </section>
  );
}
