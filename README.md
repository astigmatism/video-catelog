# Video Catalog Scaffold

This is a runnable bootstrap scaffold for the private video catalog application.

What it already includes:
- Fastify + TypeScript backend
- React + TypeScript + Vite frontend
- WebSocket connection between client and server
- Password gate UI
- Panic Escape logout behavior
- Idle auto-lock baseline
- Single-screen shell layout with sidebar, catalog area, upload panel, and settings panel
- Multipart upload endpoint that stores incoming files on disk
- Filesystem-backed placeholder catalog index
- User-level systemd service files and Ubuntu bootstrap scripts

What is intentionally still placeholder-level:
- PostgreSQL persistence wiring
- FFmpeg thumbnail generation
- Hover-preview generation
- yt-dlp ingest UI/workflow
- Protected media streaming and real viewer controls
- duplicate checksum detection

The goal is to give you a cloned repository that can start immediately and already matches the deployment shape of the final project.

## Quick start

1. Extract this scaffold into the root of your repository.
2. From the repo root, run:

   ```bash
   APP_PASSWORD='set-a-strong-password-here' bash ops/ubuntu/bootstrap-all.sh
   ```

3. Check the service:

   ```bash
   systemctl --user status video-catalog.service
   ```

4. Open `http://YOUR_SERVER_IP:3000`.

## Useful commands

```bash
journalctl --user -u video-catalog.service -f
systemctl --user restart video-catalog.service
systemctl --user stop video-catalog.service
systemctl --user start video-catalog.service
npm run build
```

## Notes

- The scaffold is designed to live in your Ubuntu user's home directory and run under that same user.
- The bootstrap script installs Node.js and yt-dlp into `~/.local/bin`.
- The bootstrap script enables a user-level systemd service so the app comes up at boot.
