const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export class DownloadUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadUrlError';
  }
}

const parseHttpUrl = (value, base) => {
  try {
    const parsed = base ? new URL(value, base) : new URL(value);
    return HTTP_PROTOCOLS.has(parsed.protocol) ? parsed : null;
  } catch (error) {
    return null;
  }
};

const isPackagedTauriOrigin = (origin) => {
  const parsed = parseHttpUrl(origin);
  return parsed?.hostname === 'tauri.localhost';
};

/**
 * Native HTTP clients cannot resolve browser-relative ticket URLs. Prefer an
 * absolute API base, then fall back to the Vite/browser origin during local dev.
 */
export const resolveHttpDownloadUrl = (
  downloadUrl,
  {
    apiBaseUrl = '/api',
    runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '',
    desktopRuntime = false,
  } = {}
) => {
  const value = String(downloadUrl || '').trim();
  if (!value) {
    throw new DownloadUrlError('Server nije vratio download URL.');
  }

  const absoluteTicket = parseHttpUrl(value);
  if (absoluteTicket) return absoluteTicket.toString();

  const apiBase = String(apiBaseUrl || '/api').trim();
  const absoluteApiBase = parseHttpUrl(apiBase);
  const browserOrigin = parseHttpUrl(runtimeOrigin);

  if (
    desktopRuntime
    && !absoluteApiBase
    && (!browserOrigin || isPackagedTauriOrigin(runtimeOrigin))
  ) {
    throw new DownloadUrlError(
      'Desktop API adresa nije konfigurisana. Postavi apsolutni VITE_API_BASE_URL prije production builda.'
    );
  }

  const resolvedApiBase = absoluteApiBase
    || (browserOrigin ? parseHttpUrl(apiBase, browserOrigin.toString()) : null);

  if (!resolvedApiBase) {
    throw new DownloadUrlError('Download URL nije ispravan ili ne koristi HTTP(S).');
  }

  const base = value.startsWith('/')
    ? `${resolvedApiBase.origin}/`
    : resolvedApiBase.toString().replace(/\/?$/, '/');
  const resolved = parseHttpUrl(value, base);

  if (!resolved) {
    throw new DownloadUrlError('Download URL nije ispravan ili ne koristi HTTP(S).');
  }

  return resolved.toString();
};
