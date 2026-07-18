import axios from 'axios';
import {
  isDesktopRuntime,
  secureDelete,
  secureGet,
  secureSet,
} from '../desktop/runtime';
import { setAccessToken, clearAccessToken } from './tokenStore';

const REFRESH_TOKEN_KEY = 'v2_refresh_token';
const DEVICE_ID_KEY = 'v2_device_id';
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
const sessionClient = axios.create({ baseURL: apiBaseUrl });

export interface SessionUser {
  id: string;
  username: string;
  role: string;
}

export interface V2SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  device?: { deviceId?: string };
}

async function getPersistentValue(key: string): Promise<string | null> {
  if (isDesktopRuntime()) return secureGet(key);
  return window.localStorage.getItem(key);
}

async function setPersistentValue(key: string, value: string): Promise<void> {
  if (isDesktopRuntime()) return secureSet(key, value);
  window.localStorage.setItem(key, value);
}

async function deletePersistentValue(key: string): Promise<void> {
  if (isDesktopRuntime()) return secureDelete(key);
  window.localStorage.removeItem(key);
}

async function getDeviceInfo(): Promise<Record<string, unknown>> {
  let deviceId = await getPersistentValue(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await setPersistentValue(DEVICE_ID_KEY, deviceId);
  }

  let runtimeInfo: Record<string, unknown> = {
    hostname: 'Browser klijent',
    platform: (navigator.platform || 'unknown').slice(0, 50),
    platformVersion: navigator.userAgent.slice(0, 80),
    appVersion: '2.0.0',
  };

  if (isDesktopRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core');
    runtimeInfo = await invoke<Record<string, unknown>>('device_info');
  }

  let notificationPermission = 'unknown';
  if (isDesktopRuntime()) {
    const notifications = await import('@tauri-apps/plugin-notification');
    notificationPermission = (await notifications.isPermissionGranted()) ? 'granted' : 'denied';
  }

  return {
    deviceId,
    ...runtimeInfo,
    updateChannel: import.meta.env.VITE_UPDATE_CHANNEL === 'pilot' ? 'pilot' : 'stable',
    notificationPermission,
    site: import.meta.env.VITE_SITE_ID || 'primary',
  };
}

async function persistSession(session: V2SessionResponse): Promise<V2SessionResponse> {
  setAccessToken(session.accessToken);
  await setPersistentValue(REFRESH_TOKEN_KEY, session.refreshToken);
  return session;
}

export async function loginV2(username: string, password: string): Promise<V2SessionResponse> {
  try {
    const response = await sessionClient.post<V2SessionResponse>('/v2/auth/login', {
      username,
      password,
      device: await getDeviceInfo(),
    });
    return persistSession(response.data);
  } catch (error: any) {
    const status = Number(error?.response?.status || 0);
    const serverMessage = error?.response?.data?.message;
    const proxyOrNetworkFailure = !error?.response
      || ([500, 502, 503, 504].includes(status) && !serverMessage);

    if (proxyOrNetworkFailure) {
      throw new Error('Server aplikacije nije dostupan. Provjeri backend servis i mrežnu vezu.');
    }
    throw error;
  }
}

export async function refreshCurrentSession(): Promise<V2SessionResponse | null> {
  const refreshToken = await getPersistentValue(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  try {
    const response = await sessionClient.post<V2SessionResponse>('/v2/auth/refresh', {
      refreshToken,
      device: await getDeviceInfo(),
    });
    return persistSession(response.data);
  } catch (error) {
    clearAccessToken();
    await deletePersistentValue(REFRESH_TOKEN_KEY);
    throw error;
  }
}

export async function logoutCurrentSession(): Promise<void> {
  const refreshToken = await getPersistentValue(REFRESH_TOKEN_KEY);
  try {
    if (refreshToken) await sessionClient.post('/v2/auth/logout', { refreshToken });
  } finally {
    clearAccessToken();
    await deletePersistentValue(REFRESH_TOKEN_KEY);
  }
}

export async function getCurrentDeviceId(): Promise<string> {
  const device = await getDeviceInfo();
  return String(device.deviceId);
}
