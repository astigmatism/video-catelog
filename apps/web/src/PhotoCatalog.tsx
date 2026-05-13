import type {
  ChangeEvent,
  CSSProperties,
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
import { useEffect, useMemo, useRef, useState } from 'react';

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
  photoCount: number;
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
  | 'viewCount';

export type PhotoCollectionSortDirection = 'asc' | 'desc';

export type PhotoCollectionFilters = {
  search: string;
  sortCategory: PhotoCollectionSortCategory;
  sortDirection: PhotoCollectionSortDirection;
  tagSearch: string;
  selectedTagIds: string[];
  excludedTagIds: string[];
};

export const PHOTO_COLLECTION_SORT_CATEGORY_LABELS: Record<PhotoCollectionSortCategory, string> = {
  none: '',
  createdAt: 'Date added',
  name: 'Name',
  photoCount: 'Photo count',
  lastViewedAt: 'Last viewed',
  viewCount: 'View count'
};

export function getDefaultPhotoCollectionFilters(): PhotoCollectionFilters {
  return {
    search: '',
    sortCategory: 'none',
    sortDirection: 'desc',
    tagSearch: '',
    selectedTagIds: [],
    excludedTagIds: []
  };
}

type PhotoGridSortCategory = 'name' | 'views' | 'resolution' | 'file_size';

type PhotoGridSortDirection = 'asc' | 'desc';

const PHOTO_GRID_SORT_CATEGORY_LABELS: Record<PhotoGridSortCategory, string> = {
  name: 'Name',
  views: 'Views',
  resolution: 'Resolution',
  file_size: 'File size'
};

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

type PhotoNotice = {
  tone: NoticeTone;
  text: string;
};

export type PhotoCatalogViewProps = {
  collections: PhotoCollection[];
  selectedCollectionId: string | null;
  viewerPhotoId: string | null;
  isActive: boolean;
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

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
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

  return {
    id,
    name,
    normalizedName: readString(value.normalizedName, name.toLowerCase()),
    description: readNullableString(value.description),
    coverPhotoId: readNullableString(value.coverPhotoId),
    coverPhoto,
    photoCount: Math.max(0, Math.floor(readNumber(value.photoCount))),
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

const PHOTO_VIEWER_CONTROLS_AUTO_HIDE_DELAY_MS = 2000;
const PHOTO_VIEWER_DEFAULT_SLIDESHOW_DELAY_MS = 5000;
const PHOTO_VIEWER_SLIDESHOW_DELAY_OPTIONS_SECONDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PHOTO_COLLECTION_FAVORITES_STORAGE_KEY = 'photoCatalog.collectionFavorites.v1';
const PHOTO_VIEWER_MIN_ZOOM = 1;
const PHOTO_VIEWER_MAX_ZOOM = 4;
const PHOTO_VIEWER_WHEEL_ZOOM_FACTOR = 1.12;
const PHOTO_VIEWER_MIN_WHEEL_ZOOM_STEPS = 0.5;
const PHOTO_VIEWER_MAX_WHEEL_ZOOM_STEPS = 3;

type PhotoViewerFitMode = 'fit' | 'fill';

type PhotoViewerSize = {
  width: number;
  height: number;
};

type PhotoViewerPan = {
  x: number;
  y: number;
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

  return target instanceof HTMLSelectElement && target.classList.contains('photo-viewer-slide-duration-select');
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

function getPhotoFavoritesStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStoredPhotoFavorites(): PhotoFavoriteState {
  const storage = getPhotoFavoritesStorage();
  if (!storage) {
    return {};
  }

  try {
    const rawValue = storage.getItem(PHOTO_COLLECTION_FAVORITES_STORAGE_KEY);
    if (!rawValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isRecord(parsedValue)) {
      return {};
    }

    return Object.entries(parsedValue).reduce<PhotoFavoriteState>((result, [collectionId, photoIds]) => {
      if (collectionId.trim() === '' || !Array.isArray(photoIds)) {
        return result;
      }

      const normalizedPhotoIds = uniqueStrings(
        photoIds.filter((photoId): photoId is string => typeof photoId === 'string' && photoId.trim() !== '')
      );

      if (normalizedPhotoIds.length > 0) {
        result[collectionId] = normalizedPhotoIds;
      }

      return result;
    }, {});
  } catch {
    return {};
  }
}

function writeStoredPhotoFavorites(favorites: PhotoFavoriteState): void {
  const storage = getPhotoFavoritesStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(PHOTO_COLLECTION_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Favorite persistence is a best-effort client-side enhancement.
  }
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

function clampPhotoViewerPan(pan: PhotoViewerPan, limit: PhotoViewerPan): PhotoViewerPan {
  return {
    x: limit.x > 0 ? Math.max(-limit.x, Math.min(limit.x, Number(pan.x.toFixed(2)))) : 0,
    y: limit.y > 0 ? Math.max(-limit.y, Math.min(limit.y, Number(pan.y.toFixed(2)))) : 0
  };
}

type PhotoImageSource = 'thumbnail' | 'original';

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
    case 'none':
    default:
      return 0;
  }
}

function tieBreakPhotoCollections(left: PhotoCollection, right: PhotoCollection): number {
  return right.createdAt.localeCompare(left.createdAt) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
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

  return [...filteredCollections].sort((left, right) => {
    const primaryComparison = comparePhotoCollectionsForSort(left, right, filters.sortCategory);
    const directedComparison = filters.sortDirection === 'asc' ? primaryComparison : -primaryComparison;
    return directedComparison || tieBreakPhotoCollections(left, right);
  });
}

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
    case 'name':
    default:
      return comparePhotosByName(left, right);
  }
}

function tieBreakPhotosForGridSort(left: Photo, right: Photo): number {
  return comparePhotosByName(left, right) || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

function sortPhotos(
  photos: Photo[],
  sortCategory: PhotoGridSortCategory,
  sortDirection: PhotoGridSortDirection
): Photo[] {
  return [...photos].sort((left, right) => {
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

  return (
    <img
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
  onSelect: (collectionId: string) => void;
  onOpenInfo: (collectionId: string) => void;
  onAddTag: (collectionId: string, label: string) => Promise<PhotoCollection | null>;
  onRemoveTag: (collectionId: string, tagId: string) => Promise<PhotoCollection | null>;
  onSearchTags: (query: string) => Promise<PhotoCatalogTag[]>;
};

function PhotoCollectionCard({
  collection,
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
  const cardSubtitle = `${pluralize(collection.photoCount, 'photo')} · ${formatBytes(collection.totalSizeBytes)} · ${pluralize(
    collection.viewCount,
    'view'
  )}`;
  const tagPopoverId = `photo-tag-management-popover-${collection.id}`;

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
          {coverPhoto ? <PhotoImage photo={coverPhoto} source="thumbnail" alt="" loading="lazy" /> : <EmptyPhotoCover />}
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

function PhotoGridCard({
  photo,
  isFavorite,
  onOpen,
  onToggleFavorite
}: {
  photo: Photo;
  isFavorite: boolean;
  onOpen: (photoId: string) => void;
  onToggleFavorite: (photo: Photo) => void;
}): JSX.Element {
  const [isFavoriteControlSuppressed, setIsFavoriteControlSuppressed] = useState(false);

  useEffect(() => {
    if (isFavorite) {
      setIsFavoriteControlSuppressed(false);
    }
  }, [isFavorite]);

  const handleFavoriteClick = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    if (isFavorite && event.detail > 0) {
      event.currentTarget.blur();
      setIsFavoriteControlSuppressed(true);
    } else if (!isFavorite) {
      setIsFavoriteControlSuppressed(false);
    }

    onToggleFavorite(photo);
  };

  const handlePointerLeave = (): void => {
    setIsFavoriteControlSuppressed(false);
  };

  return (
    <article
      className={`photo-grid-card${isFavorite ? ' is-favorite' : ''}${
        isFavoriteControlSuppressed ? ' is-favorite-control-suppressed' : ''
      }`}
      onPointerLeave={handlePointerLeave}
    >
      <div className="photo-grid-image-wrap">
        <button
          type="button"
          className="photo-grid-card-button"
          onClick={() => onOpen(photo.id)}
          aria-label={`Open ${photo.originalName}`}
        >
          <PhotoImage className="photo-grid-image" photo={photo} source="thumbnail" alt={photo.originalName} loading="lazy" />
        </button>
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
  const [isPhotoFavoritesOnly, setIsPhotoFavoritesOnly] = useState(false);
  const [favoritePhotoIdsByCollection, setFavoritePhotoIdsByCollection] = useState<PhotoFavoriteState>(() =>
    readStoredPhotoFavorites()
  );
  const [newTagLabel, setNewTagLabel] = useState('');
  const [isTagBusy, setIsTagBusy] = useState(false);
  const viewerOverlayRef = useRef<HTMLDivElement | null>(null);
  const photoViewerHeaderRef = useRef<HTMLDivElement | null>(null);
  const photoViewerStageRef = useRef<HTMLDivElement | null>(null);
  const photoViewerControlsHideTimerRef = useRef<number | null>(null);
  const photoViewerSlideshowTimerRef = useRef<number | null>(null);
  const preserveControlsVisibilityForNextPhotoChangeRef = useRef(false);
  const photoViewerDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPan: PhotoViewerPan;
  } | null>(null);
  const [arePhotoViewerControlsVisible, setArePhotoViewerControlsVisible] = useState(true);
  const [isPhotoViewerSlideshowActive, setIsPhotoViewerSlideshowActive] = useState(false);
  const [photoViewerSlideshowDelayMs, setPhotoViewerSlideshowDelayMs] = useState(
    PHOTO_VIEWER_DEFAULT_SLIDESHOW_DELAY_MS
  );
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
  const [isCollectionThumbnailBusy, setIsCollectionThumbnailBusy] = useState(false);
  const [infoCollectionId, setInfoCollectionId] = useState<string | null>(null);

  useEffect(() => {
    writeStoredPhotoFavorites(favoritePhotoIdsByCollection);
  }, [favoritePhotoIdsByCollection]);

  useEffect(() => {
    if (selectedCollectionId) {
      setInfoCollectionId(null);
    }
  }, [selectedCollectionId]);

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
    if (!viewerPhotoId || !detail) {
      return;
    }

    let cancelled = false;
    fetchJson(`/api/photos/${encodeURIComponent(viewerPhotoId)}/views`, { method: 'POST' }, onUnauthorized)
      .then((payload) => {
        const updatedPhoto = parsePhotoUpdatePayload(payload);
        if (!updatedPhoto || cancelled) {
          return;
        }

        setDetail((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            photos: current.photos.map((photo) => (photo.id === updatedPhoto.id ? updatedPhoto : photo))
          };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [viewerPhotoId, detail?.collection.id]);

  useEffect(() => {
    if (!selectedCollectionId) {
      return;
    }

    if (!collections.some((collection) => collection.id === selectedCollectionId)) {
      onBackToCollections();
    }
  }, [collections, selectedCollectionId]);

  useEffect(() => {
    if (!viewerPhotoId) {
      clearPhotoViewerControlsHideTimer();
      clearPhotoViewerSlideshowTimer();
      preserveControlsVisibilityForNextPhotoChangeRef.current = false;
      photoViewerDragRef.current = null;
      setIsPhotoViewerSlideshowActive(false);
      setIsPhotoViewerPanning(false);
      return;
    }

    const shouldPreserveControlsVisibility = preserveControlsVisibilityForNextPhotoChangeRef.current;
    preserveControlsVisibilityForNextPhotoChangeRef.current = false;

    resetPhotoViewerViewport();

    if (!shouldPreserveControlsVisibility) {
      setArePhotoViewerControlsVisible(true);
      viewerOverlayRef.current?.focus();
      schedulePhotoViewerControlsHide();
    }

    return () => {
      clearPhotoViewerSlideshowTimer();
      photoViewerDragRef.current = null;
      setIsPhotoViewerPanning(false);
    };
  }, [viewerPhotoId]);

  useEffect(() => {
    return () => {
      clearPhotoViewerControlsHideTimer();
      clearPhotoViewerSlideshowTimer();
    };
  }, []);

  const filteredCollections = useMemo(
    () => filterAndSortPhotoCollections(collections, filters),
    [collections, filters]
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

  const selectedFavoritePhotoIds = useMemo(() => {
    if (!selectedCollectionId) {
      return new Set<string>();
    }

    return new Set(favoritePhotoIdsByCollection[selectedCollectionId] ?? []);
  }, [favoritePhotoIdsByCollection, selectedCollectionId]);

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
      photoGridSortDirection
    );
  }, [detail, isPhotoFavoritesOnly, photoGridSortCategory, photoGridSortDirection, photoSearch, selectedFavoritePhotoIds]);

  const viewerPhoto = useMemo(() => {
    if (!viewerPhotoId || !detail) {
      return null;
    }

    return detail.photos.find((photo) => photo.id === viewerPhotoId) ?? null;
  }, [viewerPhotoId, detail]);

  const viewerOrderedPhotos = visiblePhotos.length > 0 ? visiblePhotos : detail?.photos ?? [];
  const viewerOrderedPhotoIds = viewerOrderedPhotos.map((photo) => photo.id).join('|');
  const photoViewerSlideDurationLabel = `${formatPhotoViewerSlideDuration(photoViewerSlideshowDelayMs)} / slide`;
  const photoViewerSlideDurationDescription = describePhotoViewerSlideDuration(photoViewerSlideshowDelayMs);
  const canPhotoViewerSlideshowAdvance = viewerOrderedPhotos.length > 1;

  const isViewerPhotoFavorite = viewerPhoto !== null && selectedFavoritePhotoIds.has(viewerPhoto.id);
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

  const photoViewerRenderedSize = useMemo(
    () =>
      calculatePhotoViewerRenderedSize(
        photoViewerIntrinsicSize,
        photoViewerStageSize,
        photoViewerFitMode,
        photoViewerZoom
      ),
    [photoViewerFitMode, photoViewerIntrinsicSize, photoViewerStageSize, photoViewerZoom]
  );

  const photoViewerPanLimit = useMemo(
    () => calculatePhotoViewerPanLimit(photoViewerRenderedSize, photoViewerStageSize),
    [photoViewerRenderedSize, photoViewerStageSize]
  );

  const photoViewerPanOffset = useMemo(
    () => clampPhotoViewerPan(photoViewerPan, photoViewerPanLimit),
    [photoViewerPan, photoViewerPanLimit]
  );

  const isPhotoViewerPanAvailable = photoViewerPanLimit.x > 0 || photoViewerPanLimit.y > 0;

  const photoViewerImageStyle = useMemo<CSSProperties>(() => {
    const transform = photoViewerRenderedSize
      ? `translate3d(${photoViewerPanOffset.x}px, ${photoViewerPanOffset.y}px, 0)`
      : `translate3d(${photoViewerPanOffset.x}px, ${photoViewerPanOffset.y}px, 0) scale(${photoViewerZoom})`;

    return {
      width: photoViewerRenderedSize ? `${photoViewerRenderedSize.width}px` : '100%',
      height: photoViewerRenderedSize ? `${photoViewerRenderedSize.height}px` : '100%',
      objectFit: photoViewerRenderedSize ? 'fill' : photoViewerFitMode === 'fit' ? 'contain' : 'cover',
      transform,
      transformOrigin: 'center center',
      cursor: isPhotoViewerPanning ? 'grabbing' : isPhotoViewerPanAvailable ? 'grab' : 'default',
      touchAction: isPhotoViewerPanAvailable ? 'none' : 'auto',
      willChange: 'transform, width, height'
    };
  }, [
    isPhotoViewerPanAvailable,
    isPhotoViewerPanning,
    photoViewerFitMode,
    photoViewerPanOffset.x,
    photoViewerPanOffset.y,
    photoViewerRenderedSize,
    photoViewerZoom
  ]);

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

  function schedulePhotoViewerControlsHide(): void {
    clearPhotoViewerControlsHideTimer();
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
    schedulePhotoViewerControlsHide();
  }

  function resetPhotoViewerViewport(): void {
    photoViewerDragRef.current = null;
    setIsPhotoViewerPanning(false);
    setPhotoViewerFitMode('fit');
    setPhotoViewerZoom(1);
    setPhotoViewerPan({
      x: 0,
      y: 0
    });
    setPhotoViewerNaturalSize(null);
  }

  function togglePhotoViewerFitMode(): void {
    notePhotoViewerActivity();
    setPhotoViewerFitMode((currentValue) => (currentValue === 'fit' ? 'fill' : 'fit'));
  }

  function togglePhotoViewerSlideshow(): void {
    notePhotoViewerActivity();
    if (!canPhotoViewerSlideshowAdvance) {
      clearPhotoViewerSlideshowTimer();
      setIsPhotoViewerSlideshowActive(false);
      return;
    }

    setIsPhotoViewerSlideshowActive((currentValue) => !currentValue);
  }

  function showPreviousViewerPhoto(): void {
    notePhotoViewerActivity();
    openViewerPhotoAtOffset(-1);
  }

  function showNextViewerPhoto(): void {
    notePhotoViewerActivity();
    openViewerPhotoAtOffset(1);
  }

  function handlePhotoViewerSlideshowDelayChange(event: ChangeEvent<HTMLSelectElement>): void {
    notePhotoViewerActivity();
    const nextDelayMs = Number(event.currentTarget.value);
    const isAllowedDelay = PHOTO_VIEWER_SLIDESHOW_DELAY_OPTIONS_SECONDS.some(
      (seconds) => seconds * 1000 === nextDelayMs
    );
    if (!Number.isFinite(nextDelayMs) || !isAllowedDelay) {
      return;
    }

    setPhotoViewerSlideshowDelayMs(nextDelayMs);
  }

  async function handleSetCollectionThumbnail(): Promise<void> {
    if (!detail || !viewerPhoto || isCollectionThumbnailBusy) {
      return;
    }

    notePhotoViewerActivity();
    setIsCollectionThumbnailBusy(true);
    setNotice(null);

    try {
      const payload = await fetchJson(
        `/api/photos/collections/${encodeURIComponent(detail.collection.id)}/thumbnail`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoId: viewerPhoto.id })
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
      setNotice({ tone: 'success', text: `Set “${viewerPhoto.originalName}” as the collection thumbnail.` });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Collection thumbnail could not be updated.'
      });
    } finally {
      setIsCollectionThumbnailBusy(false);
    }
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
    if (event.button !== 0 || !isPhotoViewerPanAvailable) {
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

  const handleTogglePhotoFavorite = (photo: Photo): void => {
    setFavoritePhotoIdsByCollection((currentFavorites) => {
      const currentPhotoIds = new Set(currentFavorites[photo.collectionId] ?? []);
      if (currentPhotoIds.has(photo.id)) {
        currentPhotoIds.delete(photo.id);
      } else {
        currentPhotoIds.add(photo.id);
      }

      const nextFavorites = { ...currentFavorites };
      const nextPhotoIds = Array.from(currentPhotoIds);
      if (nextPhotoIds.length > 0) {
        nextFavorites[photo.collectionId] = nextPhotoIds;
      } else {
        delete nextFavorites[photo.collectionId];
      }

      return nextFavorites;
    });
  };

  const handleToggleViewerPhotoFavorite = (): void => {
    if (!viewerPhoto) {
      return;
    }

    notePhotoViewerActivity();
    handleTogglePhotoFavorite(viewerPhoto);
  };

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

  function openViewerPhotoAtOffset(offset: number, options: { preserveControlsVisibility?: boolean } = {}): void {
    if (!viewerPhoto || viewerOrderedPhotos.length === 0) {
      return;
    }

    const currentIndex = viewerOrderedPhotos.findIndex((photo) => photo.id === viewerPhoto.id);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + offset + viewerOrderedPhotos.length) % viewerOrderedPhotos.length;
    const nextPhoto = viewerOrderedPhotos[nextIndex];
    if (nextPhoto) {
      if (options.preserveControlsVisibility === true && nextPhoto.id !== viewerPhoto.id) {
        preserveControlsVisibilityForNextPhotoChangeRef.current = true;
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
      openViewerPhotoAtOffset(1, { preserveControlsVisibility: true });
    }, photoViewerSlideshowDelayMs);

    return () => {
      clearPhotoViewerSlideshowTimer();
    };
  }, [
    canPhotoViewerSlideshowAdvance,
    isPhotoViewerSlideshowActive,
    photoViewerSlideshowDelayMs,
    viewerPhoto?.id,
    viewerOrderedPhotoIds
  ]);

  const handleViewerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    notePhotoViewerActivity();

    if (isPhotoViewerSlideDurationSelectTarget(event.target)) {
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

    const lowerKey = event.key.toLowerCase();
    const hasShortcutModifier = event.altKey || event.ctrlKey || event.metaKey;
    const isSpaceKey = !hasShortcutModifier && (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space');
    const isFavoriteKey = !hasShortcutModifier && (lowerKey === 'l' || event.code === 'KeyL');
    const isFitModeKey = !hasShortcutModifier && (lowerKey === 'f' || event.code === 'KeyF');
    const isThumbnailKey = !hasShortcutModifier && (lowerKey === 't' || event.code === 'KeyT');

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

    if (isThumbnailKey) {
      event.preventDefault();
      if (!event.repeat) {
        void handleSetCollectionThumbnail();
      }
      return;
    }

    if (lowerKey === 'c' || lowerKey === 'x') {
      event.preventDefault();
      onClosePhotoViewer();
    }
  };

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
              <label className="photo-grid-sort-control" htmlFor="photo-grid-sort-category">
                <span>Sort by</span>
                <select
                  id="photo-grid-sort-category"
                  value={photoGridSortCategory}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                    setPhotoGridSortCategory(event.target.value as PhotoGridSortCategory);
                  }}
                >
                  {Object.entries(PHOTO_GRID_SORT_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="sort-direction-button photo-grid-sort-direction-button"
                onClick={() => {
                  setPhotoGridSortDirection((currentValue) => (currentValue === 'asc' ? 'desc' : 'asc'));
                }}
                aria-label={`Sort order: ${photoGridSortDirectionLabel}. Toggle sort direction.`}
                title={`Sort ${photoGridSortDirectionLabel}`}
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
                onOpen={onOpenPhoto}
                onToggleFavorite={handleTogglePhotoFavorite}
              />
            ))}
          </div>
        ) : null}

        {viewerPhoto ? (
          <div
            ref={viewerOverlayRef}
            className="photo-viewer-overlay"
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
                </div>
              </div>
              <div className="viewer-toolbar-group photo-viewer-toolbar-actions">
                <button
                  type="button"
                  className={`viewer-toolbar-button viewer-toolbar-button-text photo-viewer-favorite-toggle${
                    isViewerPhotoFavorite ? ' is-favorite' : ''
                  }`}
                  onClick={handleToggleViewerPhotoFavorite}
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
                <button
                  type="button"
                  className="viewer-toolbar-button viewer-toolbar-button-text"
                  onClick={() => void handleSetCollectionThumbnail()}
                  disabled={isCollectionThumbnailBusy}
                  aria-label="Set this photo as the collection thumbnail. Shortcut: T"
                  title="Set this photo as the collection thumbnail. Shortcut: T"
                >
                  <span>Set thumbnail</span>
                  <span className="viewer-shortcut-key" aria-hidden="true">T</span>
                </button>
                <button
                  type="button"
                  className="viewer-toolbar-button viewer-toolbar-button-text viewer-toolbar-button-close"
                  onClick={onClosePhotoViewer}
                  aria-label="Close photo viewer. Shortcuts: C or X"
                  title="Close photo viewer. Shortcuts: C or X"
                >
                  <span>Close</span>
                  <span className="viewer-shortcut-key" aria-hidden="true">C</span>
                </button>
              </div>
              <div className="photo-viewer-center-controls" role="group" aria-label="Photo slideshow controls">
                <div
                  className="viewer-toolbar-group viewer-transport-group photo-viewer-slideshow-transport"
                  role="group"
                  aria-label="Photo slideshow navigation"
                >
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-transport photo-viewer-slideshow-button"
                    onClick={showPreviousViewerPhoto}
                    disabled={!canPhotoViewerSlideshowAdvance}
                    aria-label="Previous photo"
                    title="Previous photo"
                  >
                    <PhotoViewerPreviousIcon />
                  </button>
                  <button
                    type="button"
                    className="viewer-toolbar-button viewer-toolbar-button-icon viewer-toolbar-button-primary viewer-toolbar-button-transport photo-viewer-slideshow-button photo-viewer-slideshow-play-button"
                    onClick={togglePhotoViewerSlideshow}
                    disabled={!canPhotoViewerSlideshowAdvance}
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
                    disabled={!canPhotoViewerSlideshowAdvance}
                    aria-label="Next photo"
                    title="Next photo"
                  >
                    <PhotoViewerNextIcon />
                  </button>
                </div>
                <label
                  className="viewer-toolbar-indicator photo-viewer-slide-duration"
                  title={`Each slide displays for ${photoViewerSlideDurationDescription}`}
                >
                  <span className="photo-viewer-slide-duration-label">Pace</span>
                  <select
                    className="photo-viewer-slide-duration-select"
                    value={photoViewerSlideshowDelayMs}
                    onChange={handlePhotoViewerSlideshowDelayChange}
                    aria-label={`Slideshow slide duration. Current value: ${photoViewerSlideDurationDescription}.`}
                    title={`Each slide displays for ${photoViewerSlideDurationDescription}`}
                  >
                    {PHOTO_VIEWER_SLIDESHOW_DELAY_OPTIONS_SECONDS.map((seconds) => (
                      <option key={seconds} value={seconds * 1000}>
                        {seconds} {seconds === 1 ? 'second' : 'seconds'}
                      </option>
                    ))}
                  </select>
                  <span className="sr-only" aria-live="polite">
                    {photoViewerSlideDurationLabel}
                  </span>
                </label>
              </div>
            </div>
            <button type="button" className="photo-viewer-nav is-previous" onClick={showPreviousViewerPhoto} aria-label="Previous photo">
              ‹
            </button>
            <div ref={photoViewerStageRef} className="photo-viewer-stage" onWheel={handlePhotoViewerWheel}>
              <PhotoImage
                className="photo-viewer-image"
                photo={viewerPhoto}
                source="original"
                alt={viewerPhoto.originalName}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                onLoad={handlePhotoViewerImageLoad}
                onPointerDown={handlePhotoViewerImagePointerDown}
                onPointerMove={handlePhotoViewerImagePointerMove}
                onPointerUp={handlePhotoViewerImagePointerUp}
                onPointerCancel={handlePhotoViewerImagePointerUp}
                style={photoViewerImageStyle}
              />
            </div>
            <button type="button" className="photo-viewer-nav is-next" onClick={showNextViewerPhoto} aria-label="Next photo">
              ›
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="photo-catalog-view" aria-label="Photo collection catalog">

      <PhotoCatalogNotice notice={notice} />

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
