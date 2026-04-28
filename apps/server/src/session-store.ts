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
      lastSeenAt: now,
      expiresAt: now + this.getTtlMs(),
      lockedAt: null
    };

    this.sessions.set(session.id, session);
    this.cleanup();
    return session;
  }

  get(sessionId: string | undefined): SessionRecord | undefined {
    const session = this.peek(sessionId);
    if (!session) {
      return undefined;
    }

    const now = Date.now();
    session.lastSeenAt = now;
    session.expiresAt = now + this.getTtlMs();
    return session;
  }

  peek(sessionId: string | undefined): SessionRecord | undefined {
    if (!sessionId) {
      return undefined;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    if (session.lockedAt !== null || Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  destroy(sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }

    this.sessions.delete(sessionId);
  }

  cleanup(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lockedAt !== null || now > session.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private getTtlMs(): number {
    return this.ttlMinutes * 60 * 1000;
  }
}
