let accessToken = '';

export function getAccessToken(): string {
  return accessToken;
}

export function setAccessToken(value?: string | null): void {
  accessToken = String(value || '');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vca:token-updated', { detail: accessToken }));
  }
}

export function clearAccessToken(): void {
  setAccessToken('');
}
