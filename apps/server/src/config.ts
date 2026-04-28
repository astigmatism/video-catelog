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
  uploadTempRoot: string;
  ytDlpTempRoot: string;
  mediaStoreRoot: string;
  thumbsRoot: string;
  previewsRoot: string;
  dbConnectionString: string | null;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string | null;
  trustProxy: boolean;
  wsHeartbeatMs: number;
  wsAllowedOrigins: string[];
  maxUploadBytes: number;
  ffmpegCommand: string;
  ffprobeCommand: string;
  ytDlpCommand: string;
  webDistRoot: string;
};

type EnvMap = Record<string, string | undefined>;

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

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function stripMatchingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function parseDotEnvFile(envFilePath: string): EnvMap {
  if (!fs.existsSync(envFilePath)) {
    return {};
  }

  const contents = fs.readFileSync(envFilePath, 'utf8');
  const result: EnvMap = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();

    if (key === '') {
      continue;
    }

    result[key] = stripMatchingQuotes(rawValue);
  }

  return result;
}

function readSetting(env: EnvMap, dotEnv: EnvMap, key: string): string | undefined {
  const processValue = env[key];
  if (processValue !== undefined && processValue !== '') {
    return processValue;
  }

  const dotEnvValue = dotEnv[key];
  if (dotEnvValue !== undefined && dotEnvValue !== '') {
    return dotEnvValue;
  }

  return undefined;
}

export function loadConfig(): AppConfig {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const envFilePath = path.join(repoRoot, '.env');
  const dotEnv = parseDotEnvFile(envFilePath);
  const env: EnvMap = process.env as Record<string, string | undefined>;
  const nodeEnv = readSetting(env, dotEnv, 'NODE_ENV') ?? 'development';
  const appPassword = readSetting(env, dotEnv, 'APP_PASSWORD');

  if (nodeEnv === 'production' && !appPassword) {
    throw new Error('APP_PASSWORD must be set in .env or the process environment when NODE_ENV=production.');
  }

  const mediaRoot = path.resolve(repoRoot, readSetting(env, dotEnv, 'MEDIA_ROOT') ?? 'storage');
  const incomingRoot = path.join(mediaRoot, 'uploads', 'incoming');
  const tmpRoot = path.join(mediaRoot, 'uploads', 'tmp');
  const uploadTempRoot = path.join(tmpRoot, 'uploads');
  const ytDlpTempRoot = path.join(tmpRoot, 'ytdlp');
  const mediaStoreRoot = path.join(mediaRoot, 'media');
  const thumbsRoot = path.join(mediaRoot, 'thumbs');
  const previewsRoot = path.join(mediaRoot, 'previews');
  const webDistRoot = path.resolve(repoRoot, 'apps', 'web', 'dist');

  return {
    appPassword: appPassword ?? 'change-this-before-public-use',
    port: parseInteger(readSetting(env, dotEnv, 'PORT'), 3000),
    host: readSetting(env, dotEnv, 'HOST') ?? '0.0.0.0',
    cookieName: readSetting(env, dotEnv, 'COOKIE_NAME') ?? 'video_catalog_session',
    sessionTtlMinutes: parseInteger(readSetting(env, dotEnv, 'SESSION_TTL_MINUTES'), 720),
    idleLockMinutes: parseInteger(readSetting(env, dotEnv, 'IDLE_LOCK_MINUTES'), 30),
    mediaRoot,
    incomingRoot,
    tmpRoot,
    uploadTempRoot,
    ytDlpTempRoot,
    mediaStoreRoot,
    thumbsRoot,
    previewsRoot,
    dbConnectionString: readSetting(env, dotEnv, 'DATABASE_URL') ?? null,
    dbHost: readSetting(env, dotEnv, 'DB_HOST') ?? '/var/run/postgresql',
    dbPort: parseInteger(readSetting(env, dotEnv, 'DB_PORT'), 5432),
    dbName: readSetting(env, dotEnv, 'DB_NAME') ?? 'video_catalog',
    dbUser: readSetting(env, dotEnv, 'DB_USER') ?? process.env.USER ?? 'unknown',
    dbPassword: readSetting(env, dotEnv, 'DB_PASSWORD') ?? null,
    trustProxy: parseBoolean(readSetting(env, dotEnv, 'TRUST_PROXY'), false),
    wsHeartbeatMs: parseInteger(readSetting(env, dotEnv, 'WS_HEARTBEAT_MS'), 30000),
    wsAllowedOrigins: parseCommaSeparatedList(readSetting(env, dotEnv, 'WS_ALLOWED_ORIGINS')),
    maxUploadBytes: parseInteger(readSetting(env, dotEnv, 'MAX_UPLOAD_BYTES'), 1024 * 1024 * 1024),
    ffmpegCommand: readSetting(env, dotEnv, 'FFMPEG_PATH') ?? 'ffmpeg',
    ffprobeCommand: readSetting(env, dotEnv, 'FFPROBE_PATH') ?? 'ffprobe',
    ytDlpCommand: readSetting(env, dotEnv, 'YTDLP_PATH') ?? 'yt-dlp',
    webDistRoot
  };
}
