type BrowserIdentity = {
  title: string;
  faviconHref: string;
  faviconType?: string;
};

const GOOGLE_LOCK_FAVICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\"><path fill=\"#4285f4\" d=\"M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v7.8h12.7c-.3 2.1-1.7 5.3-4.9 7.4l-.1.5 7.1 5.5.5.1c4.7-4.3 6.8-10.7 6.8-17.2Z\"/><path fill=\"#34a853\" d=\"M24 47c6.5 0 12-2.1 16-5.8l-7.6-5.9c-2 1.4-4.8 2.4-8.4 2.4-6.4 0-11.9-4.3-13.9-10.1l-.5.1-7.4 5.7-.1.5C6.1 41.7 14.4 47 24 47Z\"/><path fill=\"#fbbc05\" d=\"M10.1 27.6c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8v-.5l-7.6-5.9-.4.2C.8 15.1 0 18.9 0 22.8s.8 7.7 2.1 11.1l8-6.3Z\"/><path fill=\"#ea4335\" d=\"M24 8c4.5 0 7.5 1.9 9.2 3.6l6.7-6.6C35.9 1.3 30.5-.9 24-.9 14.4-.9 6.1 4.4 2.1 11.8l8 6.2C12.1 12.2 17.6 8 24 8Z\"/></svg>";

const AUTHENTICATED_APP_FAVICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><defs><linearGradient id=\"sugar-spice-favicon-gradient\" x1=\"10\" y1=\"6\" x2=\"54\" y2=\"58\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#ff7aa2\"/><stop offset=\"0.52\" stop-color=\"#b453ff\"/><stop offset=\"1\" stop-color=\"#4f46e5\"/></linearGradient></defs><rect width=\"64\" height=\"64\" rx=\"16\" fill=\"url(#sugar-spice-favicon-gradient)\"/><path fill=\"#fff\" d=\"M20 42.7c-3.8 0-6.8-1.2-9-3.5l3.8-4.6c1.5 1.6 3.3 2.4 5.4 2.4 2.4 0 3.6-.8 3.6-2.3 0-.8-.3-1.4-.9-1.8-.6-.4-1.9-.9-3.8-1.5-2.7-.8-4.7-1.9-6.1-3.2-1.3-1.3-2-3.2-2-5.6 0-2.8 1-5 3.1-6.6 2.1-1.7 4.8-2.5 8.2-2.5 3.3 0 6.1 1 8.4 3.1l-3.4 4.8c-1.5-1.3-3.2-1.9-5.1-1.9-2 0-3 .7-3 2.1 0 .7.3 1.2.9 1.6.6.4 1.9.8 3.9 1.4 2.9.9 5 2 6.3 3.4 1.3 1.4 2 3.3 2 5.8 0 2.9-1.1 5.1-3.2 6.6-2.1 1.5-5.1 2.3-9.1 2.3Zm28.9 0c-3.3 0-6-1-8.1-3.1-2.1-2.1-3.2-4.7-3.2-8 0-3.2 1.1-5.9 3.3-8 2.2-2.1 5-3.1 8.4-3.1 2.8 0 5.3.8 7.4 2.5l-2.9 4.5c-1.3-1-2.8-1.5-4.4-1.5-1.6 0-2.9.5-3.8 1.5-1 1-1.4 2.3-1.4 4s.5 3.1 1.5 4.1c1 1 2.4 1.5 4.1 1.5 1.8 0 3.4-.6 4.8-1.8l2.7 4.6c-2.1 1.9-4.9 2.8-8.4 2.8Z\"/></svg>";

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function svgToDataUri(svg: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const authenticatedTitleOverride = normalizeOptionalString(
  import.meta.env.VITE_AUTHENTICATED_BROWSER_TITLE
);
const authenticatedIconHrefOverride = normalizeOptionalString(
  import.meta.env.VITE_AUTHENTICATED_BROWSER_ICON_HREF
);

export const GOOGLE_LOCK_BROWSER_IDENTITY: BrowserIdentity = {
  title: 'Google',
  faviconHref: svgToDataUri(GOOGLE_LOCK_FAVICON_SVG),
  faviconType: 'image/svg+xml'
};

export const AUTHENTICATED_BROWSER_IDENTITY: BrowserIdentity = {
  title: authenticatedTitleOverride ?? 'Sugar&Spice',
  faviconHref: authenticatedIconHrefOverride ?? svgToDataUri(AUTHENTICATED_APP_FAVICON_SVG),
  faviconType: authenticatedIconHrefOverride ? undefined : 'image/svg+xml'
};

function getManagedFaviconElement(): HTMLLinkElement {
  const existingElement = document.getElementById('app-browser-icon');

  if (existingElement instanceof HTMLLinkElement) {
    return existingElement;
  }

  const faviconElement = document.createElement('link');
  faviconElement.id = 'app-browser-icon';
  faviconElement.rel = 'icon';
  document.head.appendChild(faviconElement);
  return faviconElement;
}

export function applyBrowserIdentity(identity: BrowserIdentity): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.title = identity.title;

  const faviconElement = getManagedFaviconElement();
  faviconElement.rel = 'icon';
  faviconElement.href = identity.faviconHref;

  if (identity.faviconType) {
    faviconElement.type = identity.faviconType;
  } else {
    faviconElement.removeAttribute('type');
  }
}
