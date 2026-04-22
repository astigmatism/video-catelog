import fs from 'node:fs';
import path from 'node:path';

export type AppConfig = {
  appPassword: string;
  port: number;
  host: string;
  cookieName: string;
  sessionTtlMinutes: number;
  idleLockMinutes: number;
  mediaRoot: string;
  incomingRoot: string;
  tmpRoot: string;
  mediaStoreRoot: string;
  thumbsRoot: string;
  previewsRoot: string;
  catalogFilePath: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  trustProxy: boolean;
  wsHeartbeatMs: number;
  webDistRoot: string;
};

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function ensureDir(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

export function loadConfig(): AppConfig {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const mediaRoot = path.resolve(repoRoot, process.env.MEDIA_ROOT ?? 'storage');
  const incomingRoot = path.join(mediaRoot, 'uploads', 'incoming');
  const tmpRoot = path.join(mediaRoot, 'uploads', 'tmp');
  const mediaStoreRoot = path.join(mediaRoot, 'media');
  const thumbsRoot = path.join(mediaRoot, 'thumbs');
  const previewsRoot = path.join(mediaRoot, 'previews');
  const catalogFilePath = path.join(mediaRoot, 'catalog', 'items.json');
  const webDistRoot = path.resolve(repoRoot, 'apps', 'web', 'dist');

  ensureDir(mediaRoot);
  ensureDir(incomingRoot);
  ensureDir(tmpRoot);
  ensureDir(mediaStoreRoot);
  ensureDir(thumbsRoot);
  ensureDir(previewsRoot);
  ensureDir(path.dirname(catalogFilePath));

  if (!fs.existsSync(catalogFilePath)) {
    fs.writeFileSync(catalogFilePath, '[]\n', 'utf8');
  }

  return {
    appPassword: process.env.APP_PASSWORD ?? 'change-this-before-public-use',
    port: parseInteger(process.env.PORT, 3000),
    host: process.env.HOST ?? '0.0.0.0',
    cookieName: process.env.COOKIE_NAME ?? 'video_catalog_session',
    sessionTtlMinutes: parseInteger(process.env.SESSION_TTL_MINUTES, 720),
    idleLockMinutes: parseInteger(process.env.IDLE_LOCK_MINUTES, 30),
    mediaRoot,
    incomingRoot,
    tmpRoot,
    mediaStoreRoot,
    thumbsRoot,
    previewsRoot,
    catalogFilePath,
    dbHost: process.env.DB_HOST ?? '/var/run/postgresql',
    dbPort: parseInteger(process.env.DB_PORT, 5432),
    dbName: process.env.DB_NAME ?? 'video_catalog',
    dbUser: process.env.DB_USER ?? process.env.USER ?? 'unknown',
    trustProxy: parseBoolean(process.env.TRUST_PROXY, true),
    wsHeartbeatMs: parseInteger(process.env.WS_HEARTBEAT_MS, 30000),
    webDistRoot
  };
}
