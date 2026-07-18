export interface NativeNotificationInput {
  id?: string;
  title: string;
  body: string;
  severity?: 'info' | 'action_required' | 'critical';
  deepLink?: string;
}

export const isDesktopRuntime = (): boolean => (
  typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
);

export async function initializeDesktopRuntime(): Promise<void> {
  if (!isDesktopRuntime()) return;

  const [{ enable, isEnabled }, notification] = await Promise.all([
    import('@tauri-apps/plugin-autostart'),
    import('@tauri-apps/plugin-notification'),
  ]);

  if (!(await isEnabled())) await enable();

  if (!(await notification.isPermissionGranted())) {
    await notification.requestPermission();
  }
}

export async function showNativeNotification(input: NativeNotificationInput): Promise<void> {
  if (!isDesktopRuntime()) return;

  const notification = await import('@tauri-apps/plugin-notification');
  if (!(await notification.isPermissionGranted())) return;

  notification.sendNotification({
    id: input.id ? Number.parseInt(input.id.slice(-8), 16) || undefined : undefined,
    title: input.title,
    body: input.body,
    extra: {
      severity: input.severity || 'info',
      deepLink: input.deepLink || '',
    },
  });
}

export async function listenForDesktopNavigation(
  onNavigate: (path: string) => void
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => {};

  const [{ listen }, deepLink] = await Promise.all([
    import('@tauri-apps/api/event'),
    import('@tauri-apps/plugin-deep-link'),
  ]);

  const navigateFromUrl = (value: string) => {
    try {
      const url = new URL(value);
      const entity = url.hostname;
      const id = url.pathname.replace(/^\//, '');
      if (entity === 'job' && id) {
        if (url.searchParams.get('view') === 'storyboard') onNavigate(`/edit-jobs/${id}/storyboard`);
        else if (url.searchParams.get('action') === 'premiere') onNavigate(`/edit-jobs/${id}?desktopAction=premiere`);
        else onNavigate(`/edit-jobs/${id}`);
      }
      if (entity === 'video' && id) onNavigate(`/video-details/${id}`);
      if (entity === 'my-work') onNavigate('/my-work');
    } catch {
      if (value.startsWith('/')) onNavigate(value);
    }
  };

  const current = await deepLink.getCurrent();
  current?.forEach(navigateFromUrl);

  const unlistenOpen = await deepLink.onOpenUrl((urls) => urls.forEach(navigateFromUrl));
  const unlistenNavigate = await listen<string>('desktop:navigate', (event) => onNavigate(event.payload));

  return () => {
    unlistenOpen();
    unlistenNavigate();
  };
}

export async function setDesktopTransferGuard(active: boolean): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_transfer_guard', { active });
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('secure_set', { key, value });
}

export async function secureGet(key: string): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('secure_get', { key });
}

export async function secureDelete(key: string): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('secure_delete', { key });
}

export interface NativeDownloadRequest {
  id: string;
  url: string;
  label: string;
  targetPath?: string;
  expectedSha256?: string;
}

export async function startNativeDownload(request: NativeDownloadRequest): Promise<{
  id: string;
  path: string;
  bytes: number;
  sha256?: string;
}> {
  if (!isDesktopRuntime()) throw new Error('Native download je dostupan samo u desktop aplikaciji.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('start_native_download', { request });
}

export async function cancelNativeDownload(id: string): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_native_download', { id });
}

export async function listenForNativeTransferProgress(
  handler: (payload: {
    id: string;
    status: string;
    transferredBytes: number;
    totalBytes: number;
    path: string;
    error: string;
  }) => void
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('desktop:transfer-progress', (event) => handler(event.payload as any));
}

export interface PremiereWorkspaceFile {
  sourceUrl: string;
  fileName: string;
  category: 'Media' | 'OFF';
  videoId?: string;
  fileId?: string;
  inMs?: number;
  outMs?: number;
  order?: number;
  note?: string;
}

export async function preparePremiereWorkspace(request: {
  jobId: string;
  title: string;
  brief: string;
  roughCut: Record<string, unknown> | null;
  files: PremiereWorkspaceFile[];
}): Promise<{
  jobId: string;
  workspacePath: string;
  manifestPath: string;
  exportsPath: string;
  downloaded: number;
  skipped: number;
}> {
  if (!isDesktopRuntime()) throw new Error('Premiere workspace zahtijeva desktop aplikaciju.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('prepare_premiere_workspace', { request });
}

export async function openLocalPath(path: string): Promise<void> {
  if (!isDesktopRuntime()) return;
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(path);
}

export async function listenForPremiereExports(
  handler: (payload: { jobId: string; path: string; size: number }) => void
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('desktop:premiere-export-ready', (event) => handler(event.payload as any));
}
