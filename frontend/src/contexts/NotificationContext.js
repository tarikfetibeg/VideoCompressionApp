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

  const refreshNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    if (!silent) setLoading(true);

    try {
      const response = await axiosInstance.get('/notifications/workspace', {
        params: { page: 1, limit: 20 },
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

  const markRead = useCallback(async (notificationId) => {
    if (!notificationId) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => (
      item._id === notificationId ? { ...item, readAt } : item
    )));
    setUnreadCount((current) => Math.max(current - 1, 0));

    try {
      await axiosInstance.patch(`/notifications/${notificationId}/read`);
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
    setNotifications((current) => current.map((item) => ({ ...item, readAt })));
    setUnreadCount(0);

    try {
      await axiosInstance.patch('/notifications/read-all');
    } catch (error) {
      console.error('Error marking all notifications read:', error);
      refreshNotifications({ silent: true });
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
    dismissLatest: () => setLatestNotification(null),
  }), [
    latestNotification,
    loading,
    markAllRead,
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
