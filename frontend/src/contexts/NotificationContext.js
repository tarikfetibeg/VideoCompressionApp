import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import axiosInstance from '../axiosConfig';
import { UserContext } from './UserContext';
import { showNativeNotification } from '../desktop/runtime';

const POLL_INTERVAL_MS = 30000;

const NotificationContext = createContext({
  notifications: [],
  unreadCount: 0,
  loading: false,
  latestNotification: null,
  refreshNotifications: () => Promise.resolve(),
  markRead: () => Promise.resolve(),
  markJobRead: () => Promise.resolve(),
  markAllRead: () => Promise.resolve(),
  acknowledge: () => Promise.resolve(),
  dismissLatest: () => {},
});

export const NotificationProvider = ({ children }) => {
  const { user } = useContext(UserContext);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [latestNotification, setLatestNotification] = useState(null);
  const initializedRef = useRef(false);
  const knownUnreadIdsRef = useRef(new Set());
  const criticalRepeatTimersRef = useRef(new Map());

  const refreshNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    if (!silent) setLoading(true);

    try {
      const response = await axiosInstance.get('/v2/notifications', {
        params: { limit: 30 },
      });
      const items = Array.isArray(response.data?.items) ? response.data.items : [];
      const unreadItems = items.filter((item) => !item.readAt);

      if (initializedRef.current) {
        const newNotification = unreadItems.find(
          (item) => !knownUnreadIdsRef.current.has(item._id)
        );
        if (newNotification) setLatestNotification(newNotification);
      } else {
        initializedRef.current = true;
      }

      knownUnreadIdsRef.current = new Set(unreadItems.map((item) => item._id));
      setNotifications(items);
      setUnreadCount(Number(response.data?.unreadCount || 0));
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    initializedRef.current = false;
    knownUnreadIdsRef.current = new Set();
    setLatestNotification(null);

    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }

    refreshNotifications();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshNotifications({ silent: true });
      }
    }, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshNotifications({ silent: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshNotifications, user]);

  useEffect(() => {
    if (!user) return undefined;

    const handleRealtimeNotification = (event) => {
      const envelope = event.detail || {};
      const payload = envelope.payload || {};
      const item = {
        _id: envelope.id,
        kind: envelope.type,
        severity: envelope.severity || 'info',
        state: 'unread',
        title: payload.title || 'Nova notifikacija',
        bodyPreview: payload.bodyPreview || '',
        deepLink: payload.deepLink || '',
        createdAt: envelope.occurredAt || new Date().toISOString(),
        entityType: envelope.entity?.type,
        entityId: envelope.entity?.id,
        payload,
      };

      setNotifications((current) => [item, ...current.filter((entry) => entry._id !== item._id)].slice(0, 30));
      setUnreadCount((current) => current + (knownUnreadIdsRef.current.has(item._id) ? 0 : 1));
      knownUnreadIdsRef.current.add(item._id);
      setLatestNotification(item);

      showNativeNotification({
        id: item._id,
        title: item.title,
        body: item.bodyPreview,
        severity: item.severity,
        deepLink: item.deepLink,
      }).catch((error) => console.error('Windows notification failed:', error));

      if (item.severity === 'critical' && !criticalRepeatTimersRef.current.has(item._id)) {
        const timer = window.setTimeout(() => {
          showNativeNotification({
            id: item._id,
            title: `Nije potvrđeno: ${item.title}`,
            body: item.bodyPreview,
            severity: 'critical',
            deepLink: item.deepLink,
          }).catch(() => {});
          criticalRepeatTimersRef.current.delete(item._id);
        }, 90_000);
        criticalRepeatTimersRef.current.set(item._id, timer);
      }
    };

    window.addEventListener('vca:notification', handleRealtimeNotification);
    return () => window.removeEventListener('vca:notification', handleRealtimeNotification);
  }, [user]);

  useEffect(() => () => {
    criticalRepeatTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    criticalRepeatTimersRef.current.clear();
  }, []);

  const markRead = useCallback(async (notificationId) => {
    if (!notificationId) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => (
      item._id === notificationId ? { ...item, readAt } : item
    )));
    setUnreadCount((current) => Math.max(current - 1, 0));

    try {
      await axiosInstance.patch(`/v2/notifications/${notificationId}/read`);
    } catch (error) {
      console.error('Error marking notification read:', error);
      refreshNotifications({ silent: true });
    }
  }, [refreshNotifications]);

  const markJobRead = useCallback(async (jobId) => {
    if (!jobId) return;

    try {
      const response = await axiosInstance.patch(`/notifications/read-job/${jobId}`);
      const updated = Number(response.data?.updated || 0);
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => (
        (item.job?._id || item.job) === jobId ? { ...item, readAt } : item
      )));
      setUnreadCount((current) => Math.max(current - updated, 0));
    } catch (error) {
      console.error('Error marking job notifications read:', error);
      refreshNotifications({ silent: true });
    }
  }, [refreshNotifications]);

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    try {
      await axiosInstance.patch('/v2/notifications/read-all');
      setNotifications((current) => current.map((item) => (
        item.severity === 'critical' ? item : { ...item, state: 'read', readAt }
      )));
      await refreshNotifications({ silent: true });
    } catch (error) {
      console.error('Error marking all notifications read:', error);
      refreshNotifications({ silent: true });
    }
  }, [refreshNotifications]);

  const acknowledge = useCallback(async (notificationId) => {
    if (!notificationId) return;
    try {
      const response = await axiosInstance.post(`/v2/notifications/${notificationId}/ack`);
      const timer = criticalRepeatTimersRef.current.get(notificationId);
      if (timer) window.clearTimeout(timer);
      criticalRepeatTimersRef.current.delete(notificationId);
      setNotifications((current) => current.map((item) => (
        item._id === notificationId ? response.data : item
      )));
      setLatestNotification((current) => current?._id === notificationId ? null : current);
      await refreshNotifications({ silent: true });
    } catch (error) {
      console.error('Error acknowledging notification:', error);
    }
  }, [refreshNotifications]);

  const value = useMemo(() => ({
    notifications,
    unreadCount,
    loading,
    latestNotification,
    refreshNotifications,
    markRead,
    markJobRead,
    markAllRead,
    acknowledge,
    dismissLatest: () => setLatestNotification(null),
  }), [
    latestNotification,
    loading,
    markAllRead,
    acknowledge,
    markJobRead,
    markRead,
    notifications,
    refreshNotifications,
    unreadCount,
  ]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);

export default NotificationContext;
