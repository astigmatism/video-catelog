import type { FormEvent, JSX, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

type GoogleLockScreenProps = {
  onSubmit: (query: string) => Promise<void>;
};

function SearchIcon(): JSX.Element {
  return (
    <svg
      className="google-lock-search-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M9.5 4a5.5 5.5 0 0 1 4.35 8.86l4.15 4.15-1.49 1.49-4.15-4.15A5.5 5.5 0 1 1 9.5 4Zm0 2a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    </svg>
  );
}

function MicrophoneIcon(): JSX.Element {
  return (
    <svg
      className="google-lock-action-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        className="google-lock-mic-blue"
        d="M12 15.5a3.5 3.5 0 0 0 3.5-3.5V5.5a3.5 3.5 0 0 0-7 0V12a3.5 3.5 0 0 0 3.5 3.5Z"
      />
      <path
        className="google-lock-mic-green"
        d="M18 11.75a6 6 0 0 1-12 0h-2a8 8 0 0 0 7 7.93V22h2v-2.32a8 8 0 0 0 7-7.93h-2Z"
      />
      <path className="google-lock-mic-red" d="M12 3a3.5 3.5 0 0 0-3.5 3.5V8h7V6.5A3.5 3.5 0 0 0 12 3Z" />
      <path className="google-lock-mic-yellow" d="M8.5 8h7v4h-7V8Z" />
    </svg>
  );
}

function LensIcon(): JSX.Element {
  return (
    <svg
      className="google-lock-action-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        className="google-lock-lens-blue"
        d="M6.5 7.75A1.25 1.25 0 0 1 7.75 6.5h2.08l1.1-1.5h2.14l1.1 1.5h2.08a1.25 1.25 0 0 1 1.25 1.25v1.75h-2V8.5h-2.32l-1.1-1.5h-.16l-1.1 1.5H8.5v1h-2V7.75Z"
      />
      <path
        className="google-lock-lens-green"
        d="M17.5 11.25V16.5H12v2h4.75A2.75 2.75 0 0 0 19.5 15.75v-4.5h-2Z"
      />
      <path
        className="google-lock-lens-red"
        d="M6.5 11.25v4.5a2.75 2.75 0 0 0 2.75 2.75H10v-2H8.5v-5.25h-2Z"
      />
      <path
        className="google-lock-lens-yellow"
        d="M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"
      />
    </svg>
  );
}

function AppsIcon(): JSX.Element {
  return (
    <svg
      className="google-lock-apps-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm6 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  );
}

function LeafIcon(): JSX.Element {
  return (
    <svg
      className="google-lock-leaf-icon"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path d="M19.7 4.3C11.1 4.7 5 9.8 5 15.4c0 2.7 2 4.9 4.7 4.9 5.8 0 9.7-7.1 10-16Z" />
      <path d="M5.8 18.7c2.4-4.5 5.9-7.2 10.4-8.5" />
    </svg>
  );
}

export function GoogleLockScreen({ onSubmit }: GoogleLockScreenProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  function focusSearchInputFromPage(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.target instanceof HTMLElement) {
      const interactiveTarget = event.target.closest(
        'a, button, input, select, textarea, [tabindex]'
      );
      if (interactiveTarget !== null && interactiveTarget !== event.currentTarget) {
        return;
      }
    }

    searchInputRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(query);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="google-lock-screen" onPointerDown={focusSearchInputFromPage}>
      <header className="google-lock-header" aria-label="Google navigation">
        <nav className="google-lock-nav google-lock-nav-left" aria-label="Primary Google links">
          <a href="https://about.google/">About</a>
          <a href="https://store.google.com/">Store</a>
        </nav>
        <nav className="google-lock-nav google-lock-nav-right" aria-label="Google account links">
          <a href="https://mail.google.com/">Gmail</a>
          <a href="https://www.google.com/imghp">Images</a>
          <a
            className="google-lock-apps-button"
            href="https://www.google.com/intl/en/about/products/"
            aria-label="Google apps"
          >
            <AppsIcon />
          </a>
          <a className="google-lock-sign-in-button" href="https://accounts.google.com/">
            Sign in
          </a>
        </nav>
      </header>

      <main className="google-lock-main">
        <section className="google-lock-search-cluster" aria-label="Google Search">
          <h1 className="google-lock-logo" aria-label="Google">
            <span className="google-lock-logo-blue">G</span>
            <span className="google-lock-logo-red">o</span>
            <span className="google-lock-logo-yellow">o</span>
            <span className="google-lock-logo-blue">g</span>
            <span className="google-lock-logo-green">l</span>
            <span className="google-lock-logo-red">e</span>
          </h1>

          <form className="google-lock-search-form" role="search" onSubmit={handleSubmit} noValidate>
            <div className="google-lock-search-box">
              <SearchIcon />
              <input
                ref={searchInputRef}
                autoFocus
                className="google-lock-search-input"
                id="google-lock-search"
                name="q"
                type="password"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                disabled={isSubmitting}
              />
              <span className="google-lock-search-action" aria-hidden="true">
                <MicrophoneIcon />
              </span>
              <span className="google-lock-search-action" aria-hidden="true">
                <LensIcon />
              </span>
            </div>

            <div className="google-lock-search-buttons">
              <button type="submit" disabled={isSubmitting}>
                Google Search
              </button>
              <button type="submit" disabled={isSubmitting}>
                I'm Feeling Lucky
              </button>
            </div>

            <span className="google-lock-submit-status" aria-live="polite">
              {isSubmitting ? 'Searching' : ''}
            </span>
          </form>
        </section>
      </main>

      <footer className="google-lock-footer" aria-label="Google footer links">
        <nav className="google-lock-footer-links google-lock-footer-left" aria-label="Business links">
          <a href="https://ads.google.com/">Advertising</a>
          <a href="https://smallbusiness.withgoogle.com/">Business</a>
          <a href="https://www.google.com/search/howsearchworks/">How Search works</a>
        </nav>
        <a className="google-lock-footer-center" href="https://sustainability.google/">
          <LeafIcon />
          <span>Applying AI towards science and the environment</span>
        </a>
        <nav className="google-lock-footer-links google-lock-footer-right" aria-label="Privacy links">
          <a href="https://policies.google.com/privacy">Privacy</a>
          <a href="https://policies.google.com/terms">Terms</a>
          <a href="https://www.google.com/preferences">Settings</a>
        </nav>
      </footer>
    </div>
  );
}
