import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';
import { UserContext } from '../../contexts/UserContext';

const mockRefreshNotifications = jest.fn();
jest.mock('../../contexts/BackgroundUploadContext', () => ({
  useBackgroundUploads: () => ({ activeUploads: [{}, {}], completedUploads: [{}], failedUploads: [{}], hasBlockingUploads: true }),
}));
jest.mock('../../contexts/BackgroundDownloadContext', () => ({
  useBackgroundDownloads: () => ({ activeDownloads: [{}], completedDownloads: [{}, {}], failedDownloads: [{}], hasBlockingDownloads: true }),
}));
jest.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ notifications: [], unreadCount: 0, loading: false, latestNotification: null,
    refreshNotifications: mockRefreshNotifications, markRead: jest.fn(), markAllRead: jest.fn(), dismissLatest: jest.fn() }),
}));

test('keeps navigation, notifications, logout and every transfer counter in the compact-capable shell', () => {
  render(
    <MemoryRouter initialEntries={['/reporter-dashboard']}>
      <UserContext.Provider value={{ user: { id: 'qa-reporter', username: 'qa_reporter', role: 'Reporter' }, logout: jest.fn() }}>
        <AppShell><h1>Radni materijal</h1></AppShell>
      </UserContext.Provider>
    </MemoryRouter>
  );
  expect(screen.getByRole('button', { name: 'Otvori navigaciju' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Odjava' })).toBeInTheDocument();
  for (const text of ['Upload u toku', '2 aktivno', '1 završeno', '1 greška', 'Download se priprema', '1 skidanje', '2 zavrseno', '1 problem']) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Radni materijal' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '0 nepročitanih notifikacija' }));
  expect(mockRefreshNotifications).toHaveBeenCalledWith({ silent: true });
  expect(screen.getByText('Nema novih notifikacija.')).toBeInTheDocument();
  expect(screen.getByText('Radni materijal')).toBeInTheDocument();
});
