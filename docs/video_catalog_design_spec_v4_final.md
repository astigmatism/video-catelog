# Video Catalog Web Application - Design and Requirements Specification (Final v4)

Document date: 2026-04-21

Purpose: Convert the full conversation into a finalized technical design and requirements document that can be reused in future implementation work or future AI conversations.

Document rules:
- Confirmed = explicitly stated by you in this conversation.
- Recommended = implementation choice chosen for the baseline design because it fits the confirmed requirements.
- Optional = intentionally out of scope for v1, but reasonable later.
- Risk = important caveat that affects implementation quality, safety, or behavior.

---

## 1. Executive summary

This project is a self-hosted, single-user video catalog and review application designed to run inside an Ubuntu VM in your ESXi environment. The application is private in purpose, but it will be reachable from the public internet through a reverse-proxy/domain setup that you manage. The application itself should listen on port 3000 on the VM.

The product goal is to replace folder-and-filename-only organization with a thumbnail-first, searchable, filterable catalog that feels closer to browsing a private YouTube-like library. The product is not a traditional multi-page site. It is a single-screen SPA from the user’s point of view, with one main shell that changes state between lock screen, catalog, viewer, and modal overlays.

The system must support two ingest paths:
1. browser upload
2. URL import through yt-dlp

Every ingest path must use the same processing pipeline:
- validate the incoming file or download
- warn on same-name duplicates
- warn on exact-checksum duplicates
- probe the media with ffprobe
- keep or canonicalize the video into one retained browser-playable file
- generate poster thumbnail assets
- generate hover-preview assets
- finalize metadata and counters

The retained-file rule is now finalized:
- if the incoming file is already browser-safe, keep it or remux it without unnecessary re-encoding
- if it is not browser-safe, transcode it to the canonical MP4 target
- after success, delete the temporary incoming/original file
- do not keep a second permanent original copy in v1

The application must also provide:
- a password gate as the first screen
- a panic-style Escape behavior that logs out, invalidates the session, and returns to the password screen
- an idle auto-lock with a default of 30 minutes and UI configurability
- a thumbnail grid catalog with sidebar filters
- categories and tags
- immersive review playback on selection
- keyboard review controls
- zoom / fit / fill controls
- download of the retained playable asset
- metrics such as view count and a manual used counter
- hover preview in the initial release

Recommended baseline implementation:
- Backend: Node.js + Fastify + TypeScript
- Frontend: React + TypeScript + Vite
- Database: PostgreSQL
- Real-time transport: authenticated WebSocket endpoint in Fastify
- Media tooling: ffprobe + ffmpeg + yt-dlp
- Reverse proxy/TLS: your existing external reverse proxy; local on-box proxy optional later
- Storage: local filesystem on the Ubuntu VM
- Process model: one app process + one worker process + PostgreSQL

At this point, there are no blocker-level requirement gaps left. The remaining items are implementation details and operational tuning, not unresolved product-definition questions.

---

## 2. Requirement status snapshot

### 2.1 Confirmed product requirements

The following items are confirmed.

1. The solution must run in an Ubuntu server environment.
2. The backend preference is Node.js with Fastify.
3. The app is single-user only.
4. The first screen must be a password input / lock screen.
5. The app must be protected so that only the owner can access the catalog.
6. Pressing Escape must act as a panic action: log out, unauthenticate, and return the app to the password screen.
7. The Escape behavior is intended to work from anywhere in the application via a document-level key binding.
8. The application will run on an Ubuntu VM in ESXi.
9. The server is responsible for storage and processing.
10. The library will be built from scratch through managed ingest, not by immediate bulk folder import.
11. Approximate storage planning is around 500 GB or more, but no hard functional limit is yet set.
12. The main catalog must present a grid of videos.
13. Video cards should use thumbnail visuals similar in spirit to YouTube.
14. A filter/navigation area should exist, likely in a left column or equivalent side panel.
15. Upload through the browser must be supported.
16. yt-dlp import by URL must be supported.
17. yt-dlp imports do not need cookie-backed or authenticated site access in v1.
18. All ingest paths must pass through the same media-processing pipeline.
19. Each video must be assessed for web playback compatibility.
20. FFmpeg / FFprobe are expected to be part of the solution.
21. Selecting a video from the grid should open it, begin playback, and enter a fullscreen-style review mode.
22. The viewer must support keyboard seeking forward and backward.
23. The viewer must support keyboard playback-speed changes.
24. The viewer must support zoom / magnification.
25. The viewer must support fit / fill style viewing modes.
26. The viewer must support downloading the retained video file.
27. Resume-last-position is not required.
28. A video has exactly one category.
29. Categories are flat, not hierarchical.
30. Categories must be creatable and deletable.
31. There must be a default fallback category such as Uncategorized.
32. When a category is deleted, affected videos should be reassigned to Uncategorized.
33. Tags are zero-to-many per video.
34. Tags are used for filtering and search.
35. A view is counted when the video is explicitly opened into the viewer state.
36. Hover preview does not count as a view.
37. Used in project is a manual counter, not a project entity in v1.
38. The used counter must support increment and decrement.
39. Downloads should expose the retained transformed / playable file only, not a separate original.
40. Deletion should be immediate hard delete, with confirmation first.
41. Duplicate warnings are required.
42. Same-name duplicate warning should show the existing item thumbnail in the dialog.
43. The duplicate dialog should allow renaming before proceeding.
44. Duplicate checking should also include checksum-based exact duplicate detection.
45. Hover preview is required in the first implementation, not deferred.
46. Bulk folder import from an existing tree is not required now.
47. The app will be reachable from the public internet behind a reverse-proxy/domain setup that you manage.
48. The app itself should listen on port 3000 on the machine.
49. The app should feel like a single-screen application from the user’s point of view, not a multi-page product.
50. The preferred interaction model is WebSocket-first for commands, state changes, and server-to-client updates.
51. HTTP is still acceptable where the browser naturally benefits from it, especially upload, media streaming, and downloads.
52. Configuration should be split: environment/config file for low-level settings and secrets, UI-based settings for user-facing behavior that should be adjustable inside the app.
53. The retained-media policy is the conditional single-kept-file rule: keep/remux when already web-safe, otherwise convert, then delete the temporary original.
54. The preferred viewer-open behavior is an immersive in-app full-window viewer plus a best-effort browser fullscreen request on open.
55. Idle auto-lock is required.
56. The idle auto-lock timeout should default to 30 minutes.
57. The idle auto-lock timeout should be configurable in the UI.
58. The primary visible name in the catalog should be the ingest/original name, not a separate display-title feature in v1.
59. The output of this design phase should be a detailed technical requirements/design document suitable for future implementation work.

### 2.2 Important technical implications from the confirmed requirements

These are not new requirements. They are implications of the confirmed ones.

1. Public internet exposure means the app cannot be treated like a trusted LAN-only tool.
2. A plain password page alone is not enough; secure password storage, session handling, rate limiting, origin checks, and protected media delivery matter.
3. Because the app is single-user, a full multi-account user system is unnecessary in v1.
4. Because the reverse proxy is user-managed and external to the app, the base deployment should not require a local on-box proxy to be functional.
5. Because the app itself must listen on port 3000, the Fastify process must be the primary application listener in the base deployment.
6. Because downloads must come from the app, the retained file format and playback format should align as closely as possible.
7. Because hard delete is confirmed, delete operations must remove both database metadata and filesystem assets atomically enough to avoid orphaned data.
8. Because Escape is a safety requirement, lock/logout must be server-authoritative, not just cosmetic client state.
9. Because WebSocket is preferred, the server must close active sockets when a session is locked or expires.
10. Because media playback and download rely on browser-native behavior, the app should not force binary media transport through WebSocket just for consistency.
11. Because the app is a single-screen SPA, viewer, modals, lock screen, filters, and settings should all be app states within one shell rather than separate user-facing pages.
12. Because the visible catalog name is the ingest/original name in v1, metadata design should not depend on a separate user-facing title field.
13. Because the conditional single-kept-file policy is confirmed, the media pipeline must make an explicit keep/remux/transcode decision during ingest.
14. Because idle auto-lock is confirmed, the app must track activity timestamps and enforce lock state on both HTTP and WebSocket access.

---

## 3. Major design changes from Draft v3

Draft v4 resolves the remaining sign-off items from Draft v3.

1. The single-kept-file policy is now final.
2. The viewer-open behavior is now final: immersive in-app viewer first, then best-effort browser fullscreen.
3. Idle auto-lock is now in scope for v1, with a default of 30 minutes and UI configurability.
4. Visible naming is now final: no separate display-title feature in v1.
5. The deployment baseline is simplified: Fastify on port 3000 behind your existing reverse proxy. Local Nginx is optional later, not required on day one.
6. There are no remaining blocker-level requirement questions.

---

## 4. Final sign-off summary and known caveats

### 4.1 Final sign-off summary

| Topic | Final decision |
|---|---|
| Single kept file | Keep/remux when already browser-safe, otherwise transcode, then delete temporary original |
| Fullscreen priority | Immersive in-app full-window viewer plus best-effort browser fullscreen request on open |
| Idle auto-lock | Enabled in v1 |
| Idle auto-lock default | 30 minutes |
| Idle auto-lock configurability | Configurable from the UI |
| Visible naming | Use the ingest/original name as the primary visible name in v1 |
| Separate display title | Not part of v1 |
| External reverse proxy | User-managed; app listens on port 3000 |

### 4.2 Known caveats that should be carried into implementation

1. **Browser fullscreen versus panic-Escape reliability**
   - The application should treat the immersive in-app full-window viewer as the primary guaranteed review mode.
   - Browser-managed fullscreen is still desirable, but it is an enhancement, not the sole implementation of “fullscreen.”
   - Risk: browsers may treat Escape as a fullscreen-exit key before or instead of the app’s own panic handler. The implementation should still attempt to lock aggressively on Escape and on relevant fullscreen-exit transitions, but a universal cross-browser one-press guarantee cannot be assumed while browser fullscreen is active.

2. **Conditional canonicalization minimizes but does not eliminate generation loss**
   - If an input is already browser-safe, keeping or remuxing it avoids unnecessary loss.
   - If an input must be transcoded, the resulting canonical MP4 may not be mathematically identical to the incoming file, even if visual quality remains high.

3. **Idle auto-lock needs a concrete activity definition**
   - Recommended baseline: keyboard, mouse, pointer, touch, and explicit control interactions count as activity.
   - Recommended baseline: passive playback by itself does not reset the idle timer.
   - This is chosen in favor of safety and predictable lock behavior.

4. **Local on-box proxy is optional, not foundational**
   - The design should work correctly without local Nginx.
   - If you later add local Nginx for asset acceleration or TLS termination on the VM, the application design should already be compatible with that change.

---

## 5. Recommended technical stack

### 5.1 Platform baseline

Recommended baseline:
- Ubuntu 24.04.4 LTS
- Node.js 24.15.0 LTS
- Fastify 5.8.x
- React 19.2
- Vite 8.x
- PostgreSQL 16+ (the setup guide uses PostgreSQL 18 from the official PGDG repository)
- FFmpeg / FFprobe
- yt-dlp

Notes:
- Ubuntu 24.04 LTS is the production-safe operating-system target.
- Node 24 LTS is the recommended Node line for a new deployment.
- Fastify 5.x matches the current official docs line.
- A local Nginx installation is not required for the base deployment because your reverse proxy is external.

### 5.2 Backend

Recommended:
- Fastify + TypeScript

Recommended Fastify ecosystem pieces:
- @fastify/cookie
- @fastify/session or an equivalent revocable server-side session layer backed by PostgreSQL
- @fastify/multipart
- @fastify/websocket
- @fastify/helmet
- @fastify/rate-limit
- @fastify/csrf-protection

Session recommendation:
- prefer a revocable server-side session model over a purely stateless cookie session
- because panic lock, idle auto-lock, and WebSocket teardown are first-class requirements

Implementation note:
- this can be built with @fastify/session plus a real store, or with a small custom session layer backed by PostgreSQL and signed cookies
- avoid in-memory-only production session storage

### 5.3 Frontend

Recommended:
- React + TypeScript + Vite
- native HTMLVideoElement with custom controls
- no mandatory user-facing router beyond the single SPA shell

Reasoning:
- broad ecosystem support
- stable tooling
- custom review controls are easier when built directly on the media element and browser APIs

### 5.4 Database

Recommended:
- PostgreSQL

Reasoning:
- good fit for relational metadata, categories, tags, counters, events, jobs, settings, and revocable sessions
- supports jsonb snapshots for ffprobe and yt-dlp metadata
- strong concurrency behavior for worker/job processing

### 5.5 Media storage

Recommended:
- filesystem storage on the Ubuntu VM
- metadata in PostgreSQL

Reasoning:
- large media assets do not belong in the database
- backup model is straightforward: PostgreSQL backup plus filesystem backup/snapshot

### 5.6 Process model

Recommended:
- app process
- worker process
- PostgreSQL
- user-managed external reverse proxy outside the app process boundary

Reasoning:
- media processing must not run inline in interactive request or socket handlers
- a separate worker keeps uploads/imports responsive
- no Redis is required on day one
- no mandatory local web server is required on day one

---

## 6. High-level architecture

### 6.1 Logical components

1. Web UI
   - lock screen
   - catalog grid
   - filters panel
   - viewer overlay / immersive viewer state
   - metadata editing
   - upload/import dialogs
   - settings modal or settings panel

2. Fastify app
   - auth/session endpoints
   - authenticated WebSocket endpoint
   - upload endpoint
   - protected media streaming and download endpoints
   - minimal health/admin endpoints

3. WebSocket command layer
   - catalog query and filtering commands
   - metadata mutations
   - category and tag management
   - settings reads/writes
   - job progress events
   - session/lock events

4. Worker
   - ffprobe inspection
   - keep/remux/transcode decisioning
   - thumbnail generation
   - hover preview generation
   - yt-dlp invocation
   - duplicate checks and ingest finalization

5. PostgreSQL
   - metadata
   - counters
   - events
   - jobs
   - settings
   - revocable sessions

6. Filesystem asset store
   - retained videos
   - thumbnails
   - hover previews
   - optional storyboards later
   - temp uploads
   - temp yt-dlp downloads

7. External reverse proxy (user-managed)
   - TLS termination
   - domain routing
   - WebSocket upgrade forwarding
   - request/response header forwarding to the app

8. Optional future local reverse proxy on the VM
   - only if you later want on-box TLS, protected file acceleration, or local caching

### 6.2 Runtime topology

```text
Browser
  -> User-managed reverse proxy / TLS
    -> Fastify app on port 3000
      -> PostgreSQL
      -> filesystem

Worker process
  -> PostgreSQL (jobs + metadata + sessions if needed)
  -> ffprobe / ffmpeg / yt-dlp
  -> filesystem
```

### 6.3 Transport split

Recommended split:

HTTP is used for:
- initial SPA shell
- login/logout/lock bootstrap
- session check
- multipart file upload
- protected poster retrieval
- protected hover-preview retrieval
- protected video streaming with Range support
- protected download

WebSocket is used for:
- catalog queries
- filter changes
- metadata edits
- category/tag/settings updates
- duplicate warning responses
- import job creation and progress
- live UI updates
- lock propagation to all tabs sharing the same session

### 6.4 Recommended network posture

Recommended default:
- Fastify binds to `0.0.0.0:3000` or to the specific VM interface that your reverse proxy reaches.
- PostgreSQL binds locally only.
- If your reverse proxy has stable source IPs, firewall port 3000 so only those IPs can reach it.
- If you later add a local on-box reverse proxy, Fastify can move to `127.0.0.1:3000` without changing application behavior.

Reason:
- matches your requirement that the application be hosted on port 3000 on the VM
- avoids making local Nginx a hidden requirement
- still leaves room for later hardening and optimization

---

## 7. Authentication, lock screen, session, and security model


### 7.1 Owner-only access model

Confirmed:
- one human user
- one password gate
- immediate lock behavior is important

Recommended v1 authentication model:
- one logical owner identity
- no username field required unless you later want one
- password hash stored securely, never plaintext
- opaque session ID in a secure cookie
- server-side session record so logout/lock can revoke access immediately

Recommended password handling:
- store only a password hash, not plaintext
- bootstrap through an environment variable or one-time setup command
- allow long passphrases

Recommended hashing baseline:
- Argon2id for password hashing
- compare using constant-time verification

### 7.2 Why server-side revocable sessions are recommended

Reason:
- lock/logout must invalidate the current authenticated session immediately
- WebSocket connections must close when the session locks or expires
- current-tab, same-browser multi-tab, and future second-device behavior are cleaner with a revocable session record

Recommended model:
- browser receives secure, HttpOnly, SameSite cookie with opaque session ID
- PostgreSQL stores session row with expiry and last activity
- WebSocket handshake validates session before upgrading
- server keeps an in-memory mapping of session_id -> active sockets
- lock/logout destroys session row and closes every socket tied to that session

### 7.3 Lock screen behavior

Confirmed requirement:
- pressing Escape should return the app to the password screen quickly and unauthenticate the session

Recommended behavior:
1. capture Escape at document level where possible
2. pause playing media
3. clear transient viewer state
4. request exit from browser fullscreen if active
5. destroy the authenticated session server-side
6. close any active WebSocket(s) for that session
7. clear client caches/state for protected data
8. render the password screen

Recommended transport behavior:
- client attempts a WebSocket `auth.lock` command if connected
- client also keeps an HTTP `POST /api/auth/lock` fallback if the socket is unavailable
- whichever path succeeds first becomes the source of truth

### 7.4 Public internet hardening

Because the app is public-facing, the following should be baseline, not optional polish:

1. TLS at the reverse proxy
2. rate limiting on login attempts
3. rate limiting on upload/import endpoints
4. CSRF protection on state-changing HTTP routes
5. explicit Origin validation on WebSocket handshakes
6. security headers
7. request body size limits
8. WebSocket message size limits
9. structured logs without secrets or passwords
10. safe execution of ffmpeg / yt-dlp without shell interpolation
11. origin/session revalidation and immediate socket closure on logout/expiry

### 7.5 Media authorization

Important design point:
- if thumbnails, previews, and video files are served as simple public static files, the password gate becomes weak because direct asset URLs could bypass the intended protection model

Recommended default:
- authenticated media delivery only
- through Fastify directly in the base deployment, with optional authenticated reverse-proxy acceleration later if you add a local on-box proxy

Reason:
- preserves both performance and access control

### 7.6 Upload safety baseline

Recommended minimum controls for uploads and yt-dlp downloads before processing:
- allow-list accepted video extensions for browser uploads
- treat client-supplied Content-Type as advisory only
- validate the actual media with ffprobe and magic-number/file-signature checks where practical
- generate internal filenames rather than trusting user filenames on disk
- enforce request/file size limits
- store files outside the public web root
- keep filesystem permissions minimal

---


## 8. UI and UX design

### 8.1 Single-screen SPA model

Confirmed direction:
- the product should feel like one application screen that changes state, not like a multi-page website

Recommended top-level UI states:
1. locked
2. catalog
3. viewer-active
4. modal-active overlays (upload, import, duplicate warning, edit metadata, categories, tags, settings)

Recommended browser-path model:
- one primary browser path for the app shell
- API/media paths are implementation paths, not user-facing navigation concepts

### 8.2 Lock screen

Confirmed requirements:
- initial screen is password-first
- Escape returns to it by destroying the authenticated session
- idle auto-lock also returns to it

Recommended lock-screen behavior:
- full-window dark page/shell
- single password field
- submit/go button
- Enter submits
- optional show/hide password toggle
- no catalog content visible underneath
- no protected thumbnails pre-rendered behind it

### 8.3 Main catalog screen

Confirmed requirements:
- grid of videos
- YouTube-like thumbnail emphasis
- left-side filtering/navigation controls

Recommended layout:
- left sidebar: search, categories, tags, status filters, source filters, sort options
- main grid: responsive 16:9 cards
- top bar: upload, import-by-URL, settings, category management, tag management, logout/lock control

Recommended card contents:
- poster thumbnail
- visible name (ingest/original name by default)
- duration
- category
- tag summary
- view count
- used count
- processing/error badge when relevant

Recommended card hover actions:
- open/play
- used +
- used -
- download
- edit metadata
- delete

### 8.4 Viewer experience

Confirmed requirements:
- open from grid selection
- begin playback immediately
- use a fullscreen-style review mode
- keyboard seek
- keyboard speed control
- zoom
- fit/fill modes
- download

Recommended design:
- stay in the same SPA shell
- open a full-window viewer overlay first
- then attempt browser Fullscreen API as a best-effort enhancement
- if browser fullscreen is denied or fails, remain in immersive full-window viewer mode

Reason:
- preserves the single-screen product model
- keeps panic-lock behavior more reliable than depending solely on browser fullscreen

### 8.5 Duplicate warning modal

Confirmed requirements:
- warn if same visible name already exists
- warn if exact checksum duplicate exists
- show the existing item's thumbnail
- allow renaming before continuing

Recommended modal sections:
1. warning headline
2. reason badges
   - same name
   - exact checksum match
   - same source URL for yt-dlp imports if applicable
3. existing item preview card
4. rename input for the incoming item
5. cancel button
6. continue button

Recommended existing-item preview details:
- thumbnail
- visible name
- duration
- category
- created/imported date if easily available

### 8.6 Settings surface

Confirmed direction:
- both config-file style settings and UI settings should exist

Recommended UI form:
- settings modal or right-side settings panel, not a separate page

Recommended in-app settings candidates:
- seek step formula and clamp
- speed increment and min/max
- default autoplay attempt on open
- default fullscreen attempt on open
- hover preview generation defaults
- grid density/card size
- idle auto-lock timeout (default 30 minutes)

Infrastructure/secret settings stay outside the UI:
- password hash
- session secrets
- database URL
- storage roots
- executable paths
- hard request/file-size ceilings

### 8.7 Idle auto-lock UX

Confirmed:
- idle auto-lock is in scope for v1
- default timeout is 30 minutes
- timeout is configurable in the UI

Recommended baseline behavior:
- lock when the session has seen no qualifying activity for the configured duration
- qualifying activity = keyboard, mouse, pointer, touch, wheel, and explicit viewer-control interactions
- passive playback alone does not count as activity
- when the lock occurs, pause media, clear protected client state, invalidate the server session, close the WebSocket, and return to the password screen

Risk:
- if you leave video running and do not interact with the app, auto-lock may trigger during viewing
- that behavior is consistent with the safety-first requirement

---

## 9. Viewer controls and behavior

### 9.1 Keyboard mapping

Confirmed:
- left/right for seeking
- up/down for playback speed control
- Escape for panic lock behavior

Recommended v1 mapping:

| Key | Action | Status |
|---|---|---|
| Left Arrow | Seek backward by configured step | Confirmed concept, recommended default below |
| Right Arrow | Seek forward by configured step | Confirmed concept, recommended default below |
| Up Arrow | Increase playback speed by configured increment | Confirmed concept, recommended default below |
| Down Arrow | Decrease playback speed by configured increment | Confirmed concept, recommended default below |
| Space | Play / pause | Recommended |
| F | Retry/toggle browser fullscreen request | Recommended |
| Z | Toggle zoom mode | Recommended |
| 0 | Reset zoom and speed | Recommended |
| Escape | Panic lock application immediately | Confirmed intent, with browser-fullscreen caveat |

### 9.2 Recommended default seek behavior

You explicitly preferred a duration-relative concept rather than a single hardcoded number.

Recommended default formula:
- `seek_step_seconds = clamp(duration_seconds * 0.01, 2, 8)`

Examples:
- 30 second clip -> 2 sec
- 10 minute clip -> 6 sec
- 60 minute clip -> 8 sec cap

Why this is a good default:
- short clips stay precise
- medium clips feel natural
- long clips do not jump too far

Implementation note:
- expose the ratio and clamp values through the settings UI

### 9.3 Recommended playback speed behavior

Recommended defaults:
- initial speed = 1.0x
- increment = 0.05x
- min speed = 0.25x
- max speed = 4.0x

Why:
- 0.05x is fine-grained enough for review work without becoming tedious
- 0.01x is likely too granular for repeated keyboard adjustments

Implementation note:
- expose increment/min/max through the settings UI

### 9.4 Zoom and view modes

Confirmed:
- zoom / magnification is required
- fit / fill style viewing is required

Recommended modes:
1. Fit
   - entire frame visible
   - implemented via contain behavior
2. Fill
   - frame fills viewport with cropping if needed
   - implemented via cover behavior
3. Zoom
   - manual scale and pan

Recommended zoom interaction:
- mouse wheel adjusts zoom factor
- click-and-drag pans when zoomed in
- double-click toggles between fit and a default zoom level
- reset control returns to Fit, 1.0x speed, centered pan

### 9.5 Autoplay and fullscreen caveat

Important browser reality:
- playback and fullscreen requests should be treated as best-effort browser actions
- the app should handle promise rejection and fallback gracefully

Recommended behavior:
- on thumbnail click, send explicit viewer-open command
- increment the view count because the user intentionally opened the viewer
- render the viewer overlay
- load the protected media URL over HTTP
- attempt `play()` and attempt `requestFullscreen()` without breaking the workflow if either fails

### 9.6 View counting

Confirmed:
- entering the viewer counts as a view
- hover preview does not count as a view

Recommended implementation:
- increment `view_count` once when the explicit viewer-open action is accepted by the server
- do not depend on actual `play()` success for the counter, because the metric definition is intentional open, not successful autoplay
- also append a `video_view_opened` event row

### 9.7 Fullscreen/Escape safety rule

Recommended implementation rule:
- do not rely solely on browser fullscreen to satisfy the user-visible requirement for fullscreen review
- always enter the immersive in-app full-window viewer state first
- then attempt browser fullscreen
- preserve a visible lock control in the UI in addition to the Escape shortcut

Risk:
- browser-managed fullscreen can compete with application-level Escape handling
- this is why immersive in-app full-window mode is the primary implementation target

---

## 10. Category, tag, search, and metrics model

### 10.1 Categories

Confirmed:
- exactly one category per video
- flat categories only
- categories can be created and deleted
- Uncategorized fallback exists

Recommended category rules:
- category names must be unique case-insensitively
- Uncategorized is a protected system category and cannot be deleted
- deleting any other category reassigns its videos to Uncategorized inside one transaction

### 10.2 Tags

Confirmed:
- zero-to-many per video
- useful for filtering and search

Recommended tag behavior:
- tags stored as normalized records, not raw comma-separated text
- UI offers autocomplete from existing tags
- freeform creation allowed
- renaming a tag updates the single tag record used by all attached videos

### 10.3 Search scope

Recommended search fields:
- visible name
- original ingest filename/name
- category name
- tags
- source URL
- source site
- yt-dlp remote title / channel fields when available

### 10.4 Sort and filter options

Recommended default sort options:
- newest imported
- oldest imported
- name A-Z
- name Z-A
- duration
- most viewed
- most used

Recommended filter options:
- category
- tags
- processing state (ready / processing / failed)
- source type (upload / yt-dlp)

### 10.5 Metrics

Confirmed metrics:
- view_count
- used_count

Recommended additional stored metrics:
- download_count
- imported_at
- last_viewed_at
- last_downloaded_at

Reason:
- even if not shown immediately, these are cheap and useful later

---

## 11. Media model and retained asset strategy

### 11.1 Asset types

Recommended retained asset types per video:
1. primary retained video asset
2. poster thumbnail asset
3. hover preview asset
4. optional storyboard asset later
5. no permanent original/source asset in v1

### 11.2 Canonical video target

Recommended browser baseline target:
- container: MP4
- video codec: H.264 / AVC
- audio codec: AAC when audio exists
- pixel format: yuv420p
- faststart enabled for progressive playback

Important quality rule:
- do not downscale or alter frame rate by default unless explicitly configured
- preserve source resolution and frame rate by default

### 11.3 Final single-kept-file policy

Confirmed final rule:
- keep/remux when already browser-safe, otherwise convert, then delete temp/original after success

Detailed behavior:
1. Probe the input with ffprobe.
2. If it is already browser-safe enough for direct playback, retain it as the permanent asset or remux it without lossy re-encode if that is sufficient.
3. If not browser-safe, transcode to the canonical MP4 target and discard the temporary input only after success.

This gives you:
- one permanent retained file in normal operation
- fewer unnecessary generation-loss events
- simpler download behavior

### 11.4 Checksums and duplicate identity

Recommended checksum behavior:
- compute checksum for the incoming binary before canonicalization
- store checksum for the retained asset as well

Why both are useful:
- incoming checksum supports exact duplicate warning on raw source identity
- retained checksum supports integrity checks and later asset validation

### 11.5 Visible naming versus internal file naming

Very important distinction:
- the visible catalog name is the ingest/original name by default in v1
- filesystem storage names should not be the raw uploaded or downloaded filename
- v1 does not introduce a separate display-title feature

Recommended metadata model:
- keep the current user-visible name in the database as `visible_name`
- initialize `visible_name` from the incoming/original name
- also preserve the original incoming name in immutable metadata for auditability and duplicate handling
- store files internally using UUID or other managed identifiers

Why:
- prevents path issues
- avoids collisions
- supports safe rename flows when the duplicate dialog or metadata edit path changes the visible name later
- still preserves the original name for display defaults, duplicate checks, and search

### 11.6 Filesystem layout

Recommended layout:

```text
/srv/video-catalog/
  app/
  shared/
    env/
    logs/
    tmp/
      uploads/
      ytdlp/
      ffmpeg/
    media/
      retained/
      thumbnails/
      hover-previews/
      storyboards/
```

Optional later if you add more elaborate deployment automation:

```text
  releases/
```

---

## 12. Ingest and processing flows


### 12.1 Upload flow

Recommended v1 flow:
1. User opens upload dialog.
2. Browser uploads file over authenticated multipart HTTP.
3. Server writes to temp path while computing the incoming checksum.
4. Server records a preliminary video row in `pending_duplicate_check` or `pending_processing` state.
5. Duplicate checks run.
6. If same-name or checksum duplicate is found, return a duplicate-warning payload and keep the temp asset pending a user decision.
7. After the user resolves the warning, enqueue worker processing.
8. Worker probes media, decides keep/remux/transcode, generates assets, and finalizes the record.
9. Video becomes ready in the catalog.

### 12.2 yt-dlp import flow

Recommended v1 flow:
1. User opens import-by-URL dialog.
2. User submits URL over WebSocket command or small HTTP endpoint.
3. Server validates the URL format and enqueues an import job.
4. Worker runs a metadata-first yt-dlp step.
5. Worker stores the yt-dlp metadata snapshot.
6. Worker downloads media into a temp directory.
7. Worker computes the incoming checksum and applies the same duplicate logic used for uploads.
8. Worker runs the same keep/remux/transcode, thumbnail, and hover-preview pipeline.
9. Video becomes ready in the catalog.

Recommended metadata to retain from yt-dlp:
- source URL
- extractor/site name
- remote title
- uploader/channel if available
- upload date if available
- raw info JSON snapshot

### 12.3 Duplicate detection flow

Recommended v1 duplicate rules:

Rule A - same-name warning
- normalize the incoming visible filename/title
- compare against existing normalized names
- if matched, warn and show existing thumbnail

Rule B - exact checksum warning
- compute SHA-256 checksum of the incoming uploaded/downloaded binary
- if matched, warn as exact duplicate

Rule C - source URL warning for yt-dlp
- if the same source URL already exists, warn separately

Recommended UX priority:
- same-name warning is usability-oriented
- checksum warning is integrity-oriented
- source URL warning is import-history-oriented

### 12.4 Canonicalization job stages

Recommended worker stages:
1. temp ingest ready
2. ffprobe metadata extraction
3. duplicate validation final pass
4. retain/remux/transcode decision
5. remux or transcode if needed
6. poster thumbnail generation
7. hover preview generation
8. database finalization
9. cleanup of temp/original files

### 12.5 Failure behavior

Recommended states:
- pending_duplicate_check
- pending_processing
- processing
- ready
- failed

On failure:
- keep the video row
- keep error text
- allow retry after correction
- do not partially expose broken assets as ready

### 12.6 Delete flow

Confirmed:
- hard delete
- confirmation required

Recommended delete behavior:
1. user clicks delete
2. confirmation dialog opens
3. on confirm, app deletes metadata rows and asset files
4. operation is logged in an event table
5. no trash or recycle bin in v1

Status: Confirmed outcome, proposed internal sequencing.

---


## 13. Hover preview design


You explicitly want hover preview in the first implementation and want behavior similar in spirit to YouTube, where the preview shows selected portions of the overall video rather than simply replaying the beginning.

### 13.1 Recommended approach

Recommended asset type:
- muted MP4 hover preview clip generated offline

Reason:
- closest to the behavior you described
- simple to play inside a hovered card
- more expressive than a static sprite-only solution

### 13.2 Recommended preview algorithm

Recommended default algorithm:
1. Exclude the first and last 5 percent of the source timeline.
2. Pick evenly spaced sample windows through the remaining duration.
3. Extract a small number of short subclips.
4. Concatenate them into one short muted preview file.
5. Scale to card-friendly size.
6. Encode at lowish resolution and modest frame rate for fast loading.

Recommended default values:
- duration under 30 sec: 4 segments x 0.75 sec
- duration 30 sec to 5 min: 6 segments x 1.0 sec
- duration over 5 min: 8 segments x 1.0 sec
- output size: 320x180 or 480x270 depending on card density
- output fps: 12 to 15 fps
- audio: none
- loop while hovered: yes

Status: Proposed.

### 13.3 Hover behavior in the grid

Recommended runtime behavior:
- wait 150 to 250 ms before starting preview to avoid accidental starts while moving the cursor across the grid
- load preview only when the card is visible or near visible
- fall back to poster thumbnail immediately if preview asset is unavailable
- stopping hover stops playback and resets the preview

Status: Proposed.

### 13.4 Recommended fallback behavior

If preview generation fails:
- keep the poster thumbnail
- mark preview generation as failed but do not fail the whole video ingest

Status: Proposed.

### 13.5 Optional later enhancement

Optional future addition:
- storyboard sprite sheets for scrub previews or richer preview UX

Reason:
- FFmpeg supports representative-frame and tile/storyboard workflows, but a muted preview clip is the closest fit for the current product goal

---


## 14. Data model

This is a recommended schema direction, not final SQL.

### 14.1 videos

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| visible_name | text | current user-facing name; defaults to original ingest name |
| normalized_visible_name | text | used for same-name duplicate checks and search |
| original_ingest_name | text | immutable raw incoming filename/title |
| normalized_original_ingest_name | text | supports duplicate checks and search |
| category_id | uuid | not null, defaults to Uncategorized |
| source_type | enum | upload or yt_dlp |
| source_url | text nullable | original remote URL |
| source_site | text nullable | extractor/site identifier |
| source_remote_id | text nullable | remote content id when available |
| duration_seconds | numeric | from ffprobe |
| width | integer | from ffprobe |
| height | integer | from ffprobe |
| fps | numeric nullable | from ffprobe |
| audio_present | boolean | from probe |
| incoming_checksum_sha256 | text nullable | checksum of incoming uploaded/downloaded binary |
| retained_asset_id | uuid nullable | FK to primary retained video asset |
| processing_state | enum | pending_duplicate_check, pending_processing, processing, ready, failed |
| retain_policy | enum | conditional_single_keep |
| is_browser_safe_input | boolean | probe decision |
| view_count | integer | maintained counter |
| used_count | integer | maintained counter |
| download_count | integer | maintained counter |
| last_viewed_at | timestamptz nullable | convenience field |
| last_downloaded_at | timestamptz nullable | convenience field |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 14.2 video_assets

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| video_id | uuid | foreign key |
| asset_kind | enum | retained_video, thumbnail, hover_preview, storyboard |
| storage_path | text | managed internal path |
| mime_type | text | |
| width | integer nullable | |
| height | integer nullable | |
| duration_seconds | numeric nullable | |
| file_size_bytes | bigint nullable | |
| checksum_sha256 | text nullable | asset checksum |
| codec_video | text nullable | |
| codec_audio | text nullable | |
| metadata_json | jsonb nullable | generation and probe metadata |
| created_at | timestamptz | |

### 14.3 categories

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| name | text | unique |
| slug | text | unique |
| is_system | boolean | true for Uncategorized |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 14.4 tags

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| name | text | unique normalized tag |
| slug | text | unique |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 14.5 video_tags

| Column | Type | Notes |
|---|---|---|
| video_id | uuid | composite key |
| tag_id | uuid | composite key |
| created_at | timestamptz | |

### 14.6 video_events

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| video_id | uuid nullable | foreign key |
| event_type | text | view_opened, used_incremented, used_decremented, downloaded, deleted, lock, etc. |
| payload_json | jsonb nullable | room for analytics and debugging |
| created_at | timestamptz | |

### 14.7 jobs

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| job_type | text | probe, canonicalize, thumbnail, hover_preview, yt_dlp_import, cleanup |
| video_id | uuid nullable | foreign key |
| state | enum | queued, running, succeeded, failed |
| attempts | integer | retry count |
| priority | integer | scheduling control |
| payload_json | jsonb | job parameters |
| error_text | text nullable | failure diagnostics |
| created_at | timestamptz | |
| started_at | timestamptz nullable | |
| finished_at | timestamptz nullable | |

### 14.8 owner_sessions

| Column | Type | Notes |
|---|---|---|
| id | uuid | primary key and cookie session identifier |
| created_at | timestamptz | |
| last_seen_at | timestamptz | |
| expires_at | timestamptz | |
| locked_at | timestamptz nullable | set on logout/lock if desired |
| user_agent | text nullable | optional audit aid |
| ip_address | inet nullable | optional audit aid |

### 14.9 app_settings

Recommended because of configurable viewer behavior.

| Column | Type | Notes |
|---|---|---|
| key | text | primary key |
| value_json | jsonb | setting payload |
| updated_at | timestamptz | |

Suggested settings to store here:
- seek formula/mode
- seek min/max clamp
- speed increment
- speed min/max
- hover preview sample count
- hover preview segment duration
- default fullscreen attempt on open
- worker concurrency for transcodes
- idle auto-lock timeout
- conditional single-kept-file policy flags only if you later choose to make them editable

---

## 15. Transport contract


This section replaces the earlier route-heavy API outline. The product is WebSocket-first, but not WebSocket-only.

### 15.1 HTTP surface

Recommended HTTP endpoints:

Authentication/session:
- POST /api/auth/login
- POST /api/auth/lock
- POST /api/auth/logout
- GET /api/auth/session

Uploads/import bootstrap:
- POST /api/uploads/file
- POST /api/uploads/:id/resolve-duplicate (optional if not done over WS)
- POST /api/imports/yt-dlp (optional if not done over WS)

Protected media access:
- GET /media/videos/:id
- GET /media/thumbnails/:id
- GET /media/hover-previews/:id
- GET /download/videos/:id

Shell/ops:
- GET /
- GET /health

Implementation note:
- the video/media endpoints should support authorization and Range requests
- the download endpoint should set attachment headers

### 15.2 Why these functions should remain HTTP

Recommended rationale:
- multipart upload is naturally handled by browser + HTTP
- video playback and download benefit from browser-native HTTP semantics, especially byte-range requests and partial-content responses
- the SPA shell and secure cookie bootstrap are also naturally HTTP

### 15.3 WebSocket endpoint

Recommended path:
- /ws

Handshake rules:
- only accept upgrade if the session cookie is valid
- validate Origin against an explicit allow-list
- apply size limits and message rate limits

Recommended message envelope:

```json
{
  "id": "uuid-or-monotonic-id",
  "type": "cmd",
  "name": "catalog.query",
  "payload": {}
}
```

Recommended success response envelope:

```json
{
  "id": "same-id",
  "type": "ack",
  "ok": true,
  "data": {}
}
```

Recommended error response envelope:

```json
{
  "id": "same-id",
  "type": "ack",
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message"
  }
}
```

Recommended server event envelope:

```json
{
  "type": "evt",
  "name": "job.progress",
  "data": {}
}
```

### 15.4 Recommended WebSocket command set

Catalog/query commands:
- catalog.query
- catalog.nextPage
- catalog.refresh
- video.get
- viewer.open

Metadata mutation commands:
- video.update
- video.used.increment
- video.used.decrement
- video.delete.request
- video.delete.confirm

Category/tag commands:
- categories.list
- categories.create
- categories.update
- categories.delete
- tags.list
- tags.create
- tags.update
- tags.delete

Import/settings commands:
- import.ytdlp.create
- jobs.subscribe
- settings.get
- settings.update

Session commands:
- auth.lock
- auth.ping

Duplicate workflow commands:
- upload.duplicate.resolve
- import.duplicate.resolve

### 15.5 Recommended server event set

- auth.locked
- auth.expired
- catalog.delta
- video.updated
- video.deleted
- video.processingStateChanged
- job.progress
- job.completed
- job.failed
- category.updated
- tag.updated
- settings.updated

### 15.6 Message validation rules

Recommended:
- validate every command with JSON schema
- explicit allow-list of command names
- message max size limit
- per-session and per-IP rate limiting
- per-command authorization checks even after the socket is authenticated

### 15.7 Lock/logout over WebSocket

Recommended behavior:
- when `auth.lock` is accepted, server invalidates the session and emits `auth.locked`
- server closes all sockets bound to that session immediately after the event
- client clears local protected state and shows the password screen

---


## 16. Worker and job-processing design


### 16.1 Why a worker is required

Video ingest is heavy work. The following must not happen inside interactive HTTP or socket handlers:
- ffprobe inspection
- transcoding
- thumbnail generation
- preview generation
- yt-dlp downloads

### 16.2 Recommended job types

- upload_finalize
- yt_dlp_import
- media_probe
- media_retention_decision
- media_remux_or_transcode
- thumbnail_generate
- hover_preview_generate
- cleanup_temp
- delete_video_assets

### 16.3 Recommended concurrency model

Start simple:
- one worker process
- one or two concurrent heavy media jobs depending on VM CPU resources
- queue everything in PostgreSQL-backed jobs

Reason:
- simpler operations model
- easier debugging
- avoids overcommitting CPU during transcodes

Status: Proposed.

### 16.4 Suggested PostgreSQL job-claiming pattern

Recommended implementation concept:
- worker polls queued jobs
- claims work using `FOR UPDATE SKIP LOCKED`
- updates state to `running`
- writes progress snapshots back to the DB
- app publishes relevant progress to the active WebSocket session

Reason:
- good enough for v1
- no extra queue infrastructure required

### 16.5 Retry behavior

Recommended:
- retry transient failures such as temporary yt-dlp/network issues
- do not blindly retry deterministic ffmpeg failures forever
- retain stderr/stdout excerpts or summarized error text for debugging
- exponential backoff for transient retries

Status: Proposed.

---


## 17. Performance and caching strategy

### 17.1 Catalog performance

Recommended:
- paginated or infinite-scroll catalog queries
- lazy loading of thumbnails and hover previews
- avoid loading full metadata for every card on first render
- debounce search input
- use thumbnail sizes appropriate to the grid

### 17.2 Media performance

Recommended:
- pre-generate poster thumbnails
- pre-generate hover preview assets
- use faststart on MP4 outputs
- support Range requests for retained video streaming

### 17.3 Protected asset caching

Recommended:
- immutable internal filenames for generated poster/preview assets
- long cache-control for poster and hover-preview assets where compatible with the auth model
- authenticated delivery only
- optional reverse-proxy acceleration later if you add a local on-box proxy

### 17.4 Database performance

Recommended indexes:
- videos(created_at)
- videos(category_id)
- videos(processing_state)
- videos(view_count)
- videos(used_count)
- videos(normalized_visible_name)
- videos(normalized_original_ingest_name)
- videos(incoming_checksum_sha256)
- videos(source_url)
- tags(name)
- video_tags(video_id, tag_id)
- owner_sessions(expires_at)

Recommended text search support:
- full-text or trigram search across visible_name / original_ingest_name / tags / category

---

## 18. Deployment model on Ubuntu

### 18.1 Recommended operating-system target

Recommended today:
- Ubuntu 24.04.4 LTS

Reason:
- stable released LTS base for production
- straightforward packages for PostgreSQL, FFmpeg, systemd, and supporting tooling

### 18.2 Recommended services in the base deployment

- postgresql
- video-catalog-app.service
- video-catalog-worker.service

Optional later:
- local nginx on the VM only if you later want on-box TLS termination, file offload, or local cache behavior

### 18.3 Port plan

Recommended default:
- Fastify app: 3000
- PostgreSQL: local only
- External reverse proxy: managed outside this application boundary

### 18.4 Recommended systemd model

- one service for API
- one service for worker
- restart-on-failure
- logs to journal plus app log files if desired

### 18.5 Recommended environment/config separation

Environment / secret config:
- APP_PASSWORD_HASH
- SESSION_COOKIE_SECRET
- DATABASE_URL
- STORAGE_ROOT
- FFMPEG_PATH
- FFPROBE_PATH
- YTDLP_PATH
- APP_BASE_URL
- MAX_UPLOAD_BYTES
- WS_ALLOWED_ORIGINS

In-app settings:
- viewer defaults
- preview defaults
- worker throttles if later exposed
- duplicate warning behavior if later exposed
- auto-lock timeout
- seek and speed defaults

### 18.6 Backup strategy

Minimum acceptable backup plan:
1. PostgreSQL backup or snapshot
2. media directory backup or VM snapshot
3. restore test process

Because hard delete is confirmed, backups matter more.

---

## 19. Implementation phasing

### Phase 1 - Owner-usable first release

This phase should include the following because they are either confirmed or strongly implied by confirmed requirements:

- password gate
- server-revocable session auth
- panic Escape lock/logout behavior
- idle auto-lock
- WebSocket command/event layer
- upload flow
- yt-dlp import flow
- probe/retain/remux/transcode pipeline
- thumbnail generation
- hover preview generation
- catalog grid
- categories and tags
- search/filter basics
- immersive viewer with keyboard controls
- best-effort browser fullscreen on open
- zoom / fit / fill modes
- view count
- used count + / -
- download retained playable file
- hard delete with confirmation
- duplicate warning modal
- Ubuntu deployment on port 3000

### Phase 2 - Workflow polish

- richer settings modal
- manual thumbnail override
- improved duplicate workflow
- saved filters
- enhanced diagnostics UI
- optional batch tagging/editing
- optional resumable uploads
- more nuanced idle-activity rules if desired later

### Phase 3 - Later enhancements

- bulk filesystem import
- storyboard scrubbing previews
- project entities instead of a manual used counter only
- optional keep-original mode
- optional OCR / transcripts / AI metadata later if ever desired

---

## 20. Explicit recommendations to carry forward into implementation

If a future implementation conversation needs a clean baseline, this is the recommended starting point:

1. Build a single-server Ubuntu 24.04.4 LTS deployment.
2. Run the Fastify app directly on port 3000 behind your existing reverse proxy.
3. Use Fastify + TypeScript for the backend.
4. Use React + TypeScript + Vite for the frontend.
5. Use PostgreSQL for metadata, jobs, settings, and revocable sessions.
6. Use a worker process for media jobs.
7. Use local filesystem storage for media binaries.
8. Use a password-gated single-user auth model.
9. Use a server-side revocable session so panic lock and idle auto-lock can invalidate the session and close sockets immediately.
10. Keep the user-facing product as a single-screen SPA.
11. Use WebSocket-first communication for interactive commands and live updates.
12. Keep HTTP for login bootstrap, uploads, protected streaming, and protected download.
13. Use a full-window viewer overlay and best-effort browser fullscreen request on open.
14. Use flat categories with one category per video and a protected Uncategorized fallback.
15. Use zero-to-many normalized tags.
16. Count a view when the explicit viewer-open action is accepted.
17. Keep used_count as a manual plus/minus counter in v1.
18. Use duplicate warnings for same-name matches and exact checksum matches.
19. Generate poster thumbnails and hover-preview clips offline with ffmpeg.
20. Store user-visible names in metadata, but store files internally with managed filenames.
21. Serve media only after auth checks.
22. Use the conditional single-kept-file policy as the canonical media strategy.
23. Keep hard delete, but back the system up reliably.
24. Do not introduce a separate display-title feature in v1 unless requirements change later.

---

## 21. Final status summary

This specification is now implementation-ready.

There are no blocker-level requirement gaps remaining from the discovery conversation.

The items that remain for implementation are ordinary engineering choices, such as:
- exact SQL migration shape
- exact file/folder layout inside the repo
- exact command names in the WebSocket contract
- exact FFmpeg command lines and encoding presets
- exact frontend component library choices, if any

Those items should be decided during implementation without changing the product definition established in this document.

The only caveat that deserves ongoing visibility is the browser-fullscreen-versus-Escape interaction noted earlier. That is not a missing requirement; it is a browser-platform constraint that the implementation should treat honestly.

---

## 22. Reference notes and current ecosystem snapshot

Checked on or around 2026-04-21.

Core stack references:
- Fastify latest docs: https://fastify.dev/docs/latest/
- Fastify ecosystem: https://fastify.dev/docs/latest/Guides/Ecosystem/
- Fastify websocket plugin: https://github.com/fastify/fastify-websocket
- Fastify session plugin: https://github.com/fastify/session
- Fastify secure-session plugin: https://github.com/fastify/fastify-secure-session
- Node.js download page: https://nodejs.org/en/download
- React blog: https://react.dev/blog/2025/10/01/react-19-2
- Vite releases: https://vite.dev/releases
- Ubuntu releases: https://releases.ubuntu.com/24.04/
- PostgreSQL docs: https://www.postgresql.org/docs/
- PostgreSQL Ubuntu install guidance: https://www.postgresql.org/download/linux/ubuntu/
- yt-dlp installation wiki: https://github.com/yt-dlp/yt-dlp/wiki/Installation
- yt-dlp README: https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- FFprobe docs: https://ffmpeg.org/ffprobe.html
- FFmpeg filters docs: https://ffmpeg.org/ffmpeg-filters.html
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP WebSocket Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- MDN requestFullscreen(): https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
- MDN HTMLMediaElement.play(): https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
