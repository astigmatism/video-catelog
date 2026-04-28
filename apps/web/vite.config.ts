import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_DEV_SERVER_PORT = 5173;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getOriginPort(origin: string, fallback: number): number {
  try {
    const url = new URL(origin);
    if (url.port !== '') {
      return readPositiveInteger(url.port, fallback);
    }

    if (url.protocol === 'http:' || url.protocol === 'ws:') {
      return 80;
    }

    if (url.protocol === 'https:' || url.protocol === 'wss:') {
      return 443;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeHttpOrigin(value: string | undefined, fallback: string): string {
  const rawValue = value ?? fallback;

  try {
    const url = new URL(rawValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return fallback;
    }

    url.pathname = '';
    url.search = '';
    url.hash = '';
    return withoutTrailingSlash(url.toString());
  } catch {
    return fallback;
  }
}

function toWebSocketOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return withoutTrailingSlash(url.toString());
}

function normalizeWebSocketOrigin(value: string | undefined, fallback: string): string {
  const rawValue = value ?? fallback;

  try {
    const url = new URL(rawValue);
    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    } else if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return fallback;
    }

    url.pathname = '';
    url.search = '';
    url.hash = '';
    return withoutTrailingSlash(url.toString());
  } catch {
    return fallback;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devServerPort = readPositiveInteger(env.VITE_DEV_SERVER_PORT, DEFAULT_DEV_SERVER_PORT);
  const rawConfiguredBackendPort = readPositiveInteger(
    firstNonEmpty(env.VITE_BACKEND_PORT, env.BACKEND_PORT, env.PORT),
    DEFAULT_BACKEND_PORT
  );
  const configuredBackendPort =
    rawConfiguredBackendPort === devServerPort ? DEFAULT_BACKEND_PORT : rawConfiguredBackendPort;
  const backendHttpOrigin = normalizeHttpOrigin(
    firstNonEmpty(env.VITE_BACKEND_ORIGIN, env.BACKEND_ORIGIN),
    `http://127.0.0.1:${configuredBackendPort}`
  );
  const backendWsOrigin = normalizeWebSocketOrigin(
    firstNonEmpty(env.VITE_BACKEND_WS_ORIGIN, env.BACKEND_WS_ORIGIN),
    toWebSocketOrigin(backendHttpOrigin)
  );
  const backendPort = getOriginPort(
    backendWsOrigin,
    getOriginPort(backendHttpOrigin, configuredBackendPort)
  );

  return {
    plugins: [react()],
    define: {
      __VIDEO_CATALOG_DEV_BACKEND_PORT__: JSON.stringify(backendPort),
      __VIDEO_CATALOG_DEV_BACKEND_HTTP_ORIGIN__: JSON.stringify(backendHttpOrigin),
      __VIDEO_CATALOG_DEV_BACKEND_WS_ORIGIN__: JSON.stringify(backendWsOrigin)
    },
    server: {
      port: devServerPort,
      hmr: {
        path: '/__vite_hmr'
      },
      proxy: {
        '/api': {
          target: backendHttpOrigin,
          changeOrigin: true,
          ws: true,
          rewriteWsOrigin: true
        },
        '/media': {
          target: backendHttpOrigin,
          changeOrigin: true
        },
        '/download': {
          target: backendHttpOrigin,
          changeOrigin: true
        },
        '/ws': {
          target: backendHttpOrigin,
          ws: true,
          changeOrigin: true,
          rewriteWsOrigin: true
        }
      }
    }
  };
});
