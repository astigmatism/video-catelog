# Video Catalog

Video Catalog is a Fastify + TypeScript backend with a React + TypeScript + Vite web client.

The production runtime is intentionally a single Node.js server process:

1. `apps/web` is built with Vite into `apps/web/dist`.
2. `apps/server` is built with TypeScript into `apps/server/dist`.
3. The Fastify backend serves the built frontend, API routes, media routes, and WebSocket endpoint from one port.
4. PM2 manages that backend process in production and PM2's systemd startup integration brings it back after reboot.

Development still uses two processes: Vite for the web client and `tsx watch` for the backend.

## Quick start on Ubuntu Server

From the repository root, run as your normal Ubuntu user, not as root:

```bash
APP_PASSWORD='set-a-strong-password-here' bash ops/ubuntu/bootstrap-all.sh
```

Then open:

```text
http://YOUR_SERVER_IP:3000
```

Check runtime status and logs:

```bash
pm2 status video-catalog
pm2 logs video-catalog
systemctl status pm2-$(whoami).service
```

For full deployment and operations steps, see [`docs/ubuntu-production.md`](docs/ubuntu-production.md).

## Production commands

```bash
npm run build
npm run start:prod
npm run save:prod
npm run restart:prod
npm run stop:prod
npm run logs:prod
npm run status:prod
```

`npm run deploy:prod` runs the build, starts or restarts the PM2 process, and saves the PM2 process list.

## Development commands

```bash
npm install
npm run dev
npm run typecheck
```

The existing development flow is preserved:

- `npm run dev:web` starts Vite for the client.
- `npm run dev:server` starts the backend with `tsx watch`.
- `npm run dev` starts both development processes.

## Runtime notes

- `APP_PASSWORD` is required when `NODE_ENV=production`.
- The generated `.env` binds the app to `0.0.0.0:3000` and stores media under `./storage`.
- Vite is not run in production; only the compiled static frontend is served.
- PM2 runs one backend instance because the app keeps sessions, WebSocket state, and media processing queue state in-process.
- If you put the app behind a reverse proxy, set `TRUST_PROXY=true` and set `WS_ALLOWED_ORIGINS` to the public browser origin, for example `https://catalog.example.com`.
