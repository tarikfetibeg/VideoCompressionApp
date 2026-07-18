import { describe, expect, it } from 'vitest';
import { DownloadUrlError, resolveHttpDownloadUrl } from './downloadUrls';

describe('resolveHttpDownloadUrl', () => {
  it('resolves a relative ticket against the Vite origin in desktop dev', () => {
    expect(resolveHttpDownloadUrl('/api/downloads/tickets/token-1', {
      apiBaseUrl: '/api',
      runtimeOrigin: 'http://localhost:5173',
      desktopRuntime: true,
    })).toBe('http://localhost:5173/api/downloads/tickets/token-1');
  });

  it('uses an absolute API origin for an installed desktop client', () => {
    expect(resolveHttpDownloadUrl('/api/downloads/tickets/token-2', {
      apiBaseUrl: 'https://vca.example.ba/api',
      runtimeOrigin: 'http://tauri.localhost',
      desktopRuntime: true,
    })).toBe('https://vca.example.ba/api/downloads/tickets/token-2');
  });

  it('keeps an already absolute HTTP download URL', () => {
    expect(resolveHttpDownloadUrl('https://media.example.ba/download/token-3', {
      apiBaseUrl: '/api',
      runtimeOrigin: 'http://localhost:5173',
      desktopRuntime: true,
    })).toBe('https://media.example.ba/download/token-3');
  });

  it('rejects a packaged desktop build without an absolute API base', () => {
    expect(() => resolveHttpDownloadUrl('/api/downloads/tickets/token-4', {
      apiBaseUrl: '/api',
      runtimeOrigin: 'http://tauri.localhost',
      desktopRuntime: true,
    })).toThrow(DownloadUrlError);
  });
});
