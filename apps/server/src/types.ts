export type ToolAvailability = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ytDlp: boolean;
};

export type CatalogItem = {
  id: string;
  originalName: string;
  storedName: string;
  sizeBytes: number;
  uploadedAt: string;
  status: 'uploaded';
  relativePath: string;
};

export type SessionRecord = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
};

export type SocketMessage =
  | { type: 'welcome'; payload: { serverTime: string } }
  | { type: 'pong'; payload: { serverTime: string } }
  | { type: 'catalog:list'; payload: CatalogItem[] }
  | { type: 'runtime'; payload: Record<string, unknown> }
  | { type: 'panic'; payload: { locked: true } }
  | { type: 'error'; payload: { message: string } };
