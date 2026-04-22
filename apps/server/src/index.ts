import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { loadConfig } from './config';
import { CatalogStore } from './catalog-store';
import { SessionStore } from './session-store';
import { detectToolAvailability } from './tooling';
import type { SocketMessage } from './types';

const config = loadConfig();
const catalogStore = new CatalogStore(config.catalogFilePath);
const sessionStore = new SessionStore(config.sessionTtlMinutes);
const app = Fastify({
  logger: true,
  trustProxy: config.trustProxy
});

app.register(fastifyCookie);
app.register(fastifyMultipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
});
app.register(fastifyWebsocket);

function getSessionId(request: FastifyRequest): string | undefined {
  return request.cookies[config.cookieName];
}

function isAuthenticated(request: FastifyRequest): boolean {
  return Boolean(sessionStore.get(getSessionId(request)));
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
  }
}

app.get('/api/health', async () => {
  return {
    ok: true,
    now: new Date().toISOString()
  };
});

app.get('/api/me', async (request, reply) => {
  const authenticated = isAuthenticated(request);
  if (!authenticated) {
    reply.code(200).send({ authenticated: false });
    return;
  }

  reply.send({ authenticated: true });
});

app.post('/api/login', async (request, reply) => {
  const body = (request.body ?? {}) as { password?: string };
  const password = body.password ?? '';
  if (password !== config.appPassword) {
    reply.code(401).send({ ok: false, message: 'Invalid password.' });
    return;
  }

  const session = sessionStore.create();
  reply.setCookie(config.cookieName, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });

  reply.send({ ok: true, authenticated: true });
});

app.post('/api/logout', async (request, reply) => {
  sessionStore.destroy(getSessionId(request));
  reply.clearCookie(config.cookieName, {
    path: '/'
  });
  reply.send({ ok: true, authenticated: false });
});

app.post('/api/panic', async (request, reply) => {
  sessionStore.destroy(getSessionId(request));
  reply.clearCookie(config.cookieName, {
    path: '/'
  });
  reply.send({ ok: true, authenticated: false, panic: true });
});

app.get('/api/runtime', async (request, reply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  reply.send({
    authenticated: true,
    toolAvailability: detectToolAvailability(),
    config: {
      idleLockMinutes: config.idleLockMinutes,
      wsHeartbeatMs: config.wsHeartbeatMs,
      port: config.port,
      db: {
        host: config.dbHost,
        port: config.dbPort,
        name: config.dbName,
        user: config.dbUser
      }
    }
  });
});

app.get('/api/catalog', async (request, reply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  reply.send({
    items: catalogStore.list()
  });
});

app.post('/api/upload', async (request, reply) => {
  if (!isAuthenticated(request)) {
    reply.code(401).send({ authenticated: false });
    return;
  }

  const file = await request.file();
  if (!file) {
    reply.code(400).send({ ok: false, message: 'No file was provided.' });
    return;
  }

  const originalName = file.filename || 'unnamed-upload';
  const duplicate = catalogStore.findByOriginalName(originalName);
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const storedName = `${Date.now()}-${safeName}`;
  const targetPath = path.join(config.incomingRoot, storedName);

  await pipeline(file.file, fs.createWriteStream(targetPath));
  const stat = fs.statSync(targetPath);

  const item = catalogStore.addUploadedItem({
    originalName,
    storedName,
    sizeBytes: stat.size,
    relativePath: path.relative(config.mediaRoot, targetPath)
  });

  reply.send({
    ok: true,
    duplicate: duplicate
      ? {
          type: 'same-name',
          existing: duplicate
        }
      : null,
    item
  });
});

app.get('/ws', { websocket: true }, (connection, request) => {
  if (!isAuthenticated(request)) {
    connection.close(4001, 'Unauthenticated');
    return;
  }

  const send = (message: SocketMessage): void => {
    connection.send(JSON.stringify(message));
  };

  send({
    type: 'welcome',
    payload: {
      serverTime: new Date().toISOString()
    }
  });

  const heartbeat = setInterval(() => {
    send({
      type: 'pong',
      payload: {
        serverTime: new Date().toISOString()
      }
    });
  }, config.wsHeartbeatMs);

  connection.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as { type?: string };
      switch (parsed.type) {
        case 'ping':
          send({
            type: 'pong',
            payload: {
              serverTime: new Date().toISOString()
            }
          });
          break;
        case 'catalog:list':
          send({
            type: 'catalog:list',
            payload: catalogStore.list()
          });
          break;
        case 'runtime:get':
          send({
            type: 'runtime',
            payload: {
              toolAvailability: detectToolAvailability(),
              config: {
                idleLockMinutes: config.idleLockMinutes,
                wsHeartbeatMs: config.wsHeartbeatMs
              }
            }
          });
          break;
        case 'panic':
          sessionStore.destroy(getSessionId(request));
          send({
            type: 'panic',
            payload: {
              locked: true
            }
          });
          connection.close(4000, 'Locked');
          break;
        default:
          send({
            type: 'error',
            payload: {
              message: 'Unknown command.'
            }
          });
      }
    } catch {
      send({
        type: 'error',
        payload: {
          message: 'Invalid message payload.'
        }
      });
    }
  });

  connection.on('close', () => {
    clearInterval(heartbeat);
  });
});

if (fs.existsSync(config.webDistRoot)) {
  app.register(fastifyStatic, {
    root: config.webDistRoot,
    wildcard: true,
    index: false,
    maxAge: '1d'
  });

  app.get('/', async (_, reply) => {
    return reply.sendFile('index.html', {
      maxAge: 0,
      immutable: false
    });
  });

  app.get('/*', async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url === '/ws') {
      reply.code(404).send({ message: 'Not found.' });
      return;
    }

    return reply.sendFile('index.html', {
      maxAge: 0,
      immutable: false
    });
  });
} else {
  app.get('/', async (_, reply) => {
    reply.type('text/html').send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h1>Video Catalog Scaffold</h1>
          <p>The frontend build was not found yet.</p>
          <p>Run <code>npm run build</code> from the repository root.</p>
        </body>
      </html>
    `);
  });
}

async function start(): Promise<void> {
  try {
    await app.listen({
      port: config.port,
      host: config.host
    });
    app.log.info(`Video Catalog listening on http://${config.host}:${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
