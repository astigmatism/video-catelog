import type { ChangeEvent, FormEvent, JSX } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

type CatalogItem = {
  id: string;
  originalName: string;
  storedName: string;
  sizeBytes: number;
  uploadedAt: string;
  status: 'uploaded';
  relativePath: string;
};

type RuntimeInfo = {
  toolAvailability: {
    ffmpeg: boolean;
    ffprobe: boolean;
    ytDlp: boolean;
  };
  config: {
    idleLockMinutes: number;
    wsHeartbeatMs: number;
    port: number;
    db: {
      host: string;
      port: number;
      name: string;
      user: string;
    };
  };
};

type SidebarSection = 'catalog' | 'upload' | 'settings';

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('Enter your password to unlock the catalog.');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeSection, setActiveSection] = useState<SidebarSection>('catalog');
  const [idleLockMinutes, setIdleLockMinutes] = useState(30);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState('No file selected yet.');
  const socketRef = useRef<WebSocket | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());

  const runtimeSummary = useMemo(() => {
    if (!runtime) {
      return 'Runtime not loaded yet.';
    }
    return `Port ${runtime.config.port} | DB ${runtime.config.db.user}@${runtime.config.db.host}/${runtime.config.db.name}`;
  }, [runtime]);

  async function loadCatalog(): Promise<void> {
    const response = await fetch('/api/catalog', {
      credentials: 'include'
    });

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { items: CatalogItem[] };
    setCatalog(data.items);
  }

  async function loadRuntime(): Promise<void> {
    const response = await fetch('/api/runtime', {
      credentials: 'include'
    });

    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as RuntimeInfo;
    setRuntime(data);
    setIdleLockMinutes(data.config.idleLockMinutes);
  }

  async function checkSession(): Promise<void> {
    const response = await fetch('/api/me', {
      credentials: 'include'
    });
    const data = (await response.json()) as { authenticated: boolean };
    setAuthenticated(data.authenticated);
    if (data.authenticated) {
      setMessage('Catalog unlocked.');
      await Promise.all([loadCatalog(), loadRuntime()]);
    }
  }

  async function login(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      setMessage('Incorrect password.');
      setPassword('');
      return;
    }

    setAuthenticated(true);
    setPassword('');
    setMessage('Catalog unlocked.');
    await Promise.all([loadCatalog(), loadRuntime()]);
  }

  async function panicLogout(): Promise<void> {
    await fetch('/api/panic', {
      method: 'POST',
      credentials: 'include'
    });

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    setAuthenticated(false);
    setCatalog([]);
    setRuntime(null);
    setWsConnected(false);
    setActiveSection('catalog');
    setSelectedFile(null);
    setUploadMessage('No file selected yet.');
    setMessage('Locked. Enter your password to continue.');
  }

  async function uploadSelectedFile(): Promise<void> {
    if (!selectedFile) {
      setUploadMessage('Choose a file first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    const response = await fetch('/api/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData
    });

    const data = (await response.json()) as {
      ok?: boolean;
      duplicate?: { existing: CatalogItem } | null;
      item?: CatalogItem;
      message?: string;
    };

    if (!response.ok) {
      setUploadMessage(data.message ?? 'Upload failed.');
      return;
    }

    if (data.duplicate?.existing) {
      setUploadMessage(`Uploaded with warning: a file named ${data.duplicate.existing.originalName} is already cataloged.`);
    } else {
      setUploadMessage('Upload stored in incoming media area.');
    }

    setSelectedFile(null);
    await loadCatalog();
    socketRef.current?.send(JSON.stringify({ type: 'catalog:list' }));
  }

  useEffect(() => {
    void checkSession();
  }, []);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      setWsConnected(true);
      socket.send(JSON.stringify({ type: 'runtime:get' }));
      socket.send(JSON.stringify({ type: 'catalog:list' }));
    });

    socket.addEventListener('message', (event) => {
      const parsed = JSON.parse(event.data) as { type?: string; payload?: unknown };
      if (parsed.type === 'catalog:list' && Array.isArray(parsed.payload)) {
        setCatalog(parsed.payload as CatalogItem[]);
      }
      if (parsed.type === 'runtime' && parsed.payload) {
        setRuntime(parsed.payload as RuntimeInfo);
      }
      if (parsed.type === 'panic') {
        void panicLogout();
      }
    });

    socket.addEventListener('close', () => {
      setWsConnected(false);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [authenticated]);

  useEffect(() => {
    const markInteraction = (): void => {
      lastInteractionRef.current = Date.now();
    };

    const handleKeydown = (event: KeyboardEvent): void => {
      markInteraction();
      if (event.key === 'Escape' && authenticated) {
        void panicLogout();
      }
    };

    const events: Array<keyof DocumentEventMap> = ['mousemove', 'mousedown', 'pointerdown', 'touchstart', 'wheel', 'keydown'];

    document.addEventListener('keydown', handleKeydown);
    for (const eventName of events) {
      if (eventName !== 'keydown') {
        document.addEventListener(eventName, markInteraction as EventListener, { passive: true });
      }
    }

    const interval = window.setInterval(() => {
      if (!authenticated) {
        return;
      }

      const idleMs = idleLockMinutes * 60 * 1000;
      if (Date.now() - lastInteractionRef.current >= idleMs) {
        void panicLogout();
      }
    }, 10000);

    return () => {
      document.removeEventListener('keydown', handleKeydown);
      for (const eventName of events) {
        if (eventName !== 'keydown') {
          document.removeEventListener(eventName, markInteraction as EventListener);
        }
      }
      window.clearInterval(interval);
    };
  }, [authenticated, idleLockMinutes]);

  if (!authenticated) {
    return (
      <div className="lock-screen">
        <form className="lock-card" onSubmit={login}>
          <h1>Video Catalog</h1>
          <p>{message}</p>
          <label htmlFor="password">Password</label>
          <input
            autoFocus
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            placeholder="Enter password"
          />
          <button type="submit">Go</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h2>Catalog</h2>
        <button className={activeSection === 'catalog' ? 'active' : ''} onClick={() => setActiveSection('catalog')}>
          Grid
        </button>
        <button className={activeSection === 'upload' ? 'active' : ''} onClick={() => setActiveSection('upload')}>
          Upload
        </button>
        <button className={activeSection === 'settings' ? 'active' : ''} onClick={() => setActiveSection('settings')}>
          Settings
        </button>
        <div className="sidebar-spacer" />
        <button onClick={() => void panicLogout()}>Lock now</button>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <strong>Scaffold online</strong>
            <div className="muted">{runtimeSummary}</div>
          </div>
          <div className="status-pill-row">
            <span className={wsConnected ? 'pill ok' : 'pill'}>WebSocket {wsConnected ? 'connected' : 'offline'}</span>
            <span className={runtime?.toolAvailability.ffmpeg ? 'pill ok' : 'pill'}>ffmpeg</span>
            <span className={runtime?.toolAvailability.ffprobe ? 'pill ok' : 'pill'}>ffprobe</span>
            <span className={runtime?.toolAvailability.ytDlp ? 'pill ok' : 'pill'}>yt-dlp</span>
          </div>
        </header>

        {activeSection === 'catalog' && (
          <section>
            <div className="section-heading">
              <div>
                <h3>Catalog grid</h3>
                <p>This is the placeholder catalog view. Hover preview, viewer, and FFmpeg processing come next.</p>
              </div>
              <button onClick={() => void loadCatalog()}>Refresh</button>
            </div>
            <div className="grid">
              {catalog.map((item) => (
                <article className="card" key={item.id}>
                  <div className="thumbnail-placeholder">Preview slot</div>
                  <h4 title={item.originalName}>{item.originalName}</h4>
                  <dl>
                    <div>
                      <dt>Uploaded</dt>
                      <dd>{new Date(item.uploadedAt).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(item.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{item.status}</dd>
                    </div>
                  </dl>
                </article>
              ))}
              {catalog.length === 0 && <div className="empty-state">No items yet. Use the Upload panel to add one.</div>}
            </div>
          </section>
        )}

        {activeSection === 'upload' && (
          <section className="panel">
            <h3>Upload</h3>
            <p>This scaffold already writes incoming files into <code>storage/uploads/incoming</code>.</p>
            <input
              type="file"
              accept="video/*"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <button onClick={() => void uploadSelectedFile()}>Upload selected file</button>
            <p className="muted">{uploadMessage}</p>
          </section>
        )}

        {activeSection === 'settings' && (
          <section className="panel">
            <h3>Settings</h3>
            <label htmlFor="idleMinutes">Idle auto-lock minutes</label>
            <input
              id="idleMinutes"
              type="number"
              min={1}
              value={idleLockMinutes}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setIdleLockMinutes(Number(event.target.value) || 1)}
            />
            <p className="muted">This scaffold applies the idle timeout in the browser. The final application should persist this setting.</p>
          </section>
        )}
      </main>
    </div>
  );
}
