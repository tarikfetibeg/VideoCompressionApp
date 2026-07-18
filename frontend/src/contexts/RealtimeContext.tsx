import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';
import axiosInstance from '../axiosConfig';
import { getAccessToken } from '../auth/tokenStore';
import { getCurrentDeviceId } from '../auth/sessionApi';
import { UserContext } from './UserContext';

type RealtimeStatus = 'offline' | 'connecting' | 'connected' | 'error';

interface RealtimeContextValue {
  status: RealtimeStatus;
  lastConnectedAt: string | null;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'offline',
  lastConnectedAt: null,
});

function getSocketOrigin(): string {
  const base = import.meta.env.VITE_API_BASE_URL || '/api';
  return new URL(base, window.location.origin).origin;
}

export const RealtimeProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(UserContext);
  const [status, setStatus] = useState<RealtimeStatus>('offline');
  const [lastConnectedAt, setLastConnectedAt] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user || !getAccessToken()) {
      setStatus('offline');
      return undefined;
    }

    setStatus('connecting');
    const socket = io(getSocketOrigin(), {
      path: '/api/v2/events',
      transports: ['websocket', 'polling'],
      auth: { token: getAccessToken() },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      setLastConnectedAt(new Date().toISOString());
    });
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('error'));
    socket.on('notification', (event) => {
      window.dispatchEvent(new CustomEvent('vca:notification', { detail: event }));
    });
    socket.on('domain-event', (event) => {
      window.dispatchEvent(new CustomEvent('vca:domain-event', { detail: event }));
    });

    const updateToken = () => {
      socket.auth = { token: getAccessToken() };
      if (socket.connected) {
        socket.disconnect().connect();
      }
    };
    window.addEventListener('vca:token-updated', updateToken);

    return () => {
      window.removeEventListener('vca:token-updated', updateToken);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;

    const heartbeat = async () => {
      try {
        const deviceId = await getCurrentDeviceId();
        if (active) {
          await axiosInstance.patch('/v2/devices/heartbeat', { deviceId });
        }
      } catch (error) {
        // Realtime status already communicates connectivity to the user.
      }
    };

    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user]);

  const value = useMemo(() => ({ status, lastConnectedAt }), [lastConnectedAt, status]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
};

export const useRealtime = () => useContext(RealtimeContext);
