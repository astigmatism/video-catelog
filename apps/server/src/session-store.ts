import { randomUUID } from 'node:crypto';
import type { SessionRecord } from './types';

export type SessionActivityStateName = 'idle' | 'active';

export type SessionActivityTransitionReason =
  | 'session.created'
  | 'session.destroyed'
  | 'session.expired'
  | 'session.locked';

export type SessionActivitySnapshot = {
  state: SessionActivityStateName;
  idle: boolean;
  authenticatedSessionCount: number;
  evaluatedAt: number;
};

export type SessionActivityTransition = {
  previous: SessionActivitySnapshot;
  current: SessionActivitySnapshot;
  reason: SessionActivityTransitionReason;
  sessionId: string | null;
};

export type SessionActivityTransitionListener = (transition: SessionActivityTransition) => void;

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly activityTransitionListeners = new Set<SessionActivityTransitionListener>();
  private lastActivitySnapshot: SessionActivitySnapshot = this.createActivitySnapshot();

  constructor(private readonly ttlMinutes: number) {}

  create(): SessionRecord {
    const now = Date.now();
    const staleRemovalReason = this.cleanupExpiredSessions(now);
    if (staleRemovalReason) {
      this.emitActivityTransitionIfChanged(staleRemovalReason, null, now);
    }

    const session: SessionRecord = {
      id: randomUUID(),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.getTtlMs(),
      lockedAt: null
    };

    this.sessions.set(session.id, session);
    this.emitActivityTransitionIfChanged('session.created', session.id, now);
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

    const now = Date.now();
    const removalReason = this.getRemovalReason(session, now);
    if (removalReason) {
      this.sessions.delete(sessionId);
      this.emitActivityTransitionIfChanged(removalReason, sessionId, now);
      return undefined;
    }

    return session;
  }

  destroy(sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }

    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.emitActivityTransitionIfChanged('session.destroyed', sessionId);
    }
  }

  cleanup(): void {
    const removalReason = this.cleanupExpiredSessions(Date.now());
    if (removalReason) {
      this.emitActivityTransitionIfChanged(removalReason, null);
    }
  }

  getAuthenticatedSessionCount(): number {
    return this.getActivitySnapshot().authenticatedSessionCount;
  }

  hasAuthenticatedSessions(): boolean {
    return this.getAuthenticatedSessionCount() > 0;
  }

  isIdle(): boolean {
    return this.getActivitySnapshot().idle;
  }

  getActivitySnapshot(): SessionActivitySnapshot {
    this.cleanup();
    const snapshot = this.createActivitySnapshot();
    this.lastActivitySnapshot = snapshot;
    return { ...snapshot };
  }

  onActivityStateChange(listener: SessionActivityTransitionListener): () => void {
    this.activityTransitionListeners.add(listener);
    return () => {
      this.activityTransitionListeners.delete(listener);
    };
  }

  private cleanupExpiredSessions(now: number): SessionActivityTransitionReason | null {
    let removalReason: SessionActivityTransitionReason | null = null;

    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionRemovalReason = this.getRemovalReason(session, now);
      if (!sessionRemovalReason) {
        continue;
      }

      this.sessions.delete(sessionId);
      removalReason ??= sessionRemovalReason;
    }

    return removalReason;
  }

  private getRemovalReason(session: SessionRecord, now: number): SessionActivityTransitionReason | null {
    if (session.lockedAt !== null) {
      return 'session.locked';
    }

    if (now > session.expiresAt) {
      return 'session.expired';
    }

    return null;
  }

  private createActivitySnapshot(evaluatedAt: number = Date.now()): SessionActivitySnapshot {
    const authenticatedSessionCount = this.sessions.size;
    const idle = authenticatedSessionCount === 0;

    return {
      state: idle ? 'idle' : 'active',
      idle,
      authenticatedSessionCount,
      evaluatedAt
    };
  }

  private emitActivityTransitionIfChanged(
    reason: SessionActivityTransitionReason,
    sessionId: string | null,
    evaluatedAt: number = Date.now()
  ): void {
    const previous = this.lastActivitySnapshot;
    const current = this.createActivitySnapshot(evaluatedAt);
    this.lastActivitySnapshot = current;

    if (previous.state === current.state) {
      return;
    }

    const transition: SessionActivityTransition = {
      previous: { ...previous },
      current: { ...current },
      reason,
      sessionId
    };

    for (const listener of Array.from(this.activityTransitionListeners)) {
      try {
        listener(transition);
      } catch {
        // Session lifecycle hooks must not disrupt authentication/session handling.
      }
    }
  }

  private getTtlMs(): number {
    return this.ttlMinutes * 60 * 1000;
  }
}
