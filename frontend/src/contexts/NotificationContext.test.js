import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axiosInstance from '../axiosConfig';
import { UserContext } from './UserContext';
import {
  NotificationProvider,
  useNotifications,
} from './NotificationContext';

jest.mock('../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const NotificationProbe = () => {
  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
  } = useNotifications();

  return (
    <div>
      <span>Unread: {unreadCount}</span>
      <span>{notifications[0]?.title || 'Empty'}</span>
      <button type="button" onClick={() => markRead(notifications[0]?._id)}>Read first</button>
      <button type="button" onClick={markAllRead}>Read all</button>
    </div>
  );
};

const renderNotifications = () => render(
  <UserContext.Provider value={{
    user: { id: 'user-1', role: 'Reporter', username: 'reporter' },
  }}
  >
    <NotificationProvider>
      <NotificationProbe />
    </NotificationProvider>
  </UserContext.Provider>
);

describe('NotificationContext', () => {
  beforeEach(() => {
    axiosInstance.get.mockReset();
    axiosInstance.patch.mockReset();
    axiosInstance.get.mockResolvedValue({
      data: {
        items: [{
          _id: 'notification-1',
          title: 'Novi komentar: Jutarnji prilog',
          readAt: null,
          job: { _id: 'job-1' },
        }],
        unreadCount: 1,
      },
    });
    axiosInstance.patch.mockResolvedValue({ data: { updated: 1 } });
  });

  it('loads unread notifications and marks one as read', async () => {
    renderNotifications();

    await waitFor(() => {
      expect(screen.getByText('Unread: 1')).toBeInTheDocument();
      expect(screen.getByText('Novi komentar: Jutarnji prilog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Read first' }));

    await waitFor(() => {
      expect(axiosInstance.patch).toHaveBeenCalledWith('/notifications/notification-1/read');
      expect(screen.getByText('Unread: 0')).toBeInTheDocument();
    });
  });

  it('marks all notifications as read', async () => {
    renderNotifications();

    await waitFor(() => expect(screen.getByText('Unread: 1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Read all' }));

    await waitFor(() => {
      expect(axiosInstance.patch).toHaveBeenCalledWith('/notifications/read-all');
      expect(screen.getByText('Unread: 0')).toBeInTheDocument();
    });
  });

  it('does not decrement again when opening an already-read notification', async () => {
    axiosInstance.get.mockResolvedValue({ data: { items: [{ _id: 'notification-1', title: 'Read', readAt: '2026-10-10T10:00:00Z' }], unreadCount: 2 } });
    renderNotifications();
    await screen.findByText('Unread: 2');
    fireEvent.click(screen.getByRole('button', { name: 'Read first' }));
    await waitFor(() => expect(axiosInstance.patch).toHaveBeenCalled());
    expect(screen.getByText('Unread: 2')).toBeInTheDocument();
  });

  it('keeps unread state when a read write fails', async () => {
    axiosInstance.patch.mockRejectedValue(new Error('Session expired'));
    renderNotifications();
    await screen.findByText('Unread: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Read first' }));
    await waitFor(() => expect(axiosInstance.get).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Unread: 1')).toBeInTheDocument();
  });
});
