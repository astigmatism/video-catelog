import { randomUUID } from 'node:crypto';
import type { SessionRecord } from './types';

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly ttlMinutes: number) {}

  create(): SessionRecord {
    const now = Date.now();
    const session: SessionRecord = {
      id: randomUUID(),
      createdAt: now,
      lastSeenAt: now
    };

    this.sessions.set(session.id, session);
    this.cleanup();
    return session;
  }

  get(sessionId: string | undefined): SessionRecord | undefined {
    if (!sessionId) {
      return undefined;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const ttlMs = this.ttlMinutes * 60 * 1000;
    if (Date.now() - session.lastSeenAt > ttlMs) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    session.lastSeenAt = Date.now();
    return session;
  }

  destroy(sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }

    this.sessions.delete(sessionId);
  }

  cleanup(): void {
    const ttlMs = this.ttlMinutes * 60 * 1000;
    const cutoff = Date.now() - ttlMs;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastSeenAt < cutoff) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
