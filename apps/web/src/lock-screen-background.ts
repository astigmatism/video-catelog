import type { CSSProperties } from 'react';

type LockScreenImportMetaEnv = ImportMetaEnv & {
  readonly VITE_LOCK_SCREEN_BACKGROUND_IMAGE_URL?: string;
};

type LockScreenBackgroundStyle = CSSProperties & {
  '--lock-screen-background-image'?: string;
};

const ENV_BACKGROUND_IMAGE_URL = (import.meta.env as LockScreenImportMetaEnv)
  .VITE_LOCK_SCREEN_BACKGROUND_IMAGE_URL;

const BUNDLED_LOCK_SCREEN_BACKGROUND_IMAGES = import.meta.glob(
  './assets/lock-screen/*.{avif,gif,jpeg,jpg,png,svg,webp}',
  {
    eager: true,
    import: 'default',
    query: '?url'
  }
) as Record<string, string>;

const PREFERRED_BUNDLED_BACKGROUND_IMAGE_PATHS = [
  './assets/lock-screen/google-homepage-lock-background.png',
  './assets/lock-screen/google-homepage-lock-background.jpg',
  './assets/lock-screen/google-homepage-lock-background.jpeg',
  './assets/lock-screen/google-homepage-lock-background.webp',
  './assets/lock-screen/google.com.jpg'
] as const;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function getBundledBackgroundImageUrl(): string | undefined {
  const preferredImageUrl = firstNonEmpty(
    ...PREFERRED_BUNDLED_BACKGROUND_IMAGE_PATHS.map(
      (imagePath) => BUNDLED_LOCK_SCREEN_BACKGROUND_IMAGES[imagePath]
    )
  );

  if (preferredImageUrl) {
    return preferredImageUrl;
  }

  return Object.entries(BUNDLED_LOCK_SCREEN_BACKGROUND_IMAGES).sort(([leftPath], [rightPath]) =>
    leftPath.localeCompare(rightPath)
  )[0]?.[1];
}

function toCssUrl(value: string): string {
  const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `url("${escapedValue}")`;
}

const LOCK_SCREEN_BACKGROUND_IMAGE_URL = firstNonEmpty(
  ENV_BACKGROUND_IMAGE_URL,
  getBundledBackgroundImageUrl()
);

export const LOCK_SCREEN_BACKGROUND_STYLE: LockScreenBackgroundStyle | undefined =
  LOCK_SCREEN_BACKGROUND_IMAGE_URL === undefined
    ? undefined
    : {
        '--lock-screen-background-image': toCssUrl(LOCK_SCREEN_BACKGROUND_IMAGE_URL)
      };
