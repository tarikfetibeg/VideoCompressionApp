import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axiosInstance from '../axiosConfig';
import {
  BackgroundDownloadProvider,
  useBackgroundDownloads,
} from './BackgroundDownloadContext';
import { vi } from 'vitest';

const desktopMocks = vi.hoisted(() => ({
  active: false,
  listener: null,
  start: vi.fn(() => Promise.resolve({ id: 'native', path: 'C:/Downloads/test.mp4', bytes: 0 })),
  cancel: vi.fn(() => Promise.resolve()),
}));

vi.mock('../axiosConfig', () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: '/api' },
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../desktop/runtime', () => ({
  isDesktopRuntime: () => desktopMocks.active,
  startNativeDownload: desktopMocks.start,
  cancelNativeDownload: desktopMocks.cancel,
  listenForNativeTransferProgress: (listener) => {
    desktopMocks.listener = listener;
    return Promise.resolve(() => {});
  },
}));

const TriggerDownload = ({ descriptor }) => {
  const { startDownload } = useBackgroundDownloads();

  return (
    <button type="button" onClick={() => startDownload(descriptor).catch(() => {})}>
      Start download
    </button>
  );
};

const renderDownloadManager = (descriptor = {
  kind: 'video-single',
  payload: { videoId: 'video-1' },
  label: 'Test klip',
}) =>
  render(
    <BackgroundDownloadProvider>
      <TriggerDownload descriptor={descriptor} />
    </BackgroundDownloadProvider>
  );

describe('BackgroundDownloadContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    axiosInstance.get.mockReset();
    axiosInstance.post.mockReset();
    desktopMocks.active = false;
    desktopMocks.listener = null;
    desktopMocks.start.mockClear();
    desktopMocks.cancel.mockClear();
    document.body.querySelectorAll('iframe').forEach((frame) => frame.remove());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('creates a ticket, hands off to browser download, and polls status', async () => {
    axiosInstance.post.mockResolvedValue({
      data: {
        ticketId: 'ticket-1',
        downloadUrl: '/api/downloads/tickets/token-1',
        expiresAt: '2026-06-17T12:15:00.000Z',
      },
    });
    axiosInstance.get.mockResolvedValue({
      data: {
        status: 'completed',
        finishedAt: '2026-06-17T12:01:00.000Z',
      },
    });

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => {
      expect(axiosInstance.post).toHaveBeenCalledWith('/downloads/tickets', {
        kind: 'video-single',
        payload: { videoId: 'video-1' },
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(document.body.querySelector('iframe')?.getAttribute('src')).toBe(
        `${window.location.origin}/api/downloads/tickets/token-1`
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(1300);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith('/downloads/tickets/ticket-1/status');
      expect(screen.getAllByText(/Završeno/i).length).toBeGreaterThan(0);
    });
  });

  it('shows a failed ticket creation in the panel', async () => {
    axiosInstance.post.mockRejectedValue(new Error('network down'));

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => {
      expect(screen.getByText(/Nema odgovora servera/i)).toBeInTheDocument();
    });
  });

  it('guards tab close while the download ticket is being prepared', async () => {
    let resolveTicket;
    axiosInstance.post.mockImplementation(() => new Promise((resolve) => {
      resolveTicket = resolve;
    }));

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Pripremam siguran download link/i).length).toBeGreaterThan(0);
    });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await act(async () => {
      resolveTicket({
        data: {
          ticketId: 'ticket-2',
          downloadUrl: '/api/downloads/tickets/token-2',
        },
      });
      await Promise.resolve();
    });
  });

  it('shows precise native bytes, speed, percentage and remaining time', async () => {
    desktopMocks.active = true;
    axiosInstance.post.mockResolvedValue({
      data: {
        ticketId: 'ticket-native',
        downloadUrl: '/api/downloads/tickets/token-native',
      },
    });

    renderDownloadManager();
    fireEvent.click(screen.getByRole('button', { name: /start download/i }));

    await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledTimes(1));
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    await waitFor(() => expect(desktopMocks.start).toHaveBeenCalledTimes(1));

    const downloadId = desktopMocks.start.mock.calls[0][0].id;
    await act(async () => {
      desktopMocks.listener({
        id: downloadId,
        status: 'transferring',
        transferredBytes: 1024 * 1024,
        totalBytes: 4 * 1024 * 1024,
        path: 'C:/Downloads/test.mp4',
        error: '',
      });
      vi.advanceTimersByTime(1000);
      desktopMocks.listener({
        id: downloadId,
        status: 'transferring',
        transferredBytes: 2 * 1024 * 1024,
        totalBytes: 4 * 1024 * 1024,
        path: 'C:/Downloads/test.mp4',
        error: '',
      });
    });

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('2.00 MB od 4.00 MB')).toBeInTheDocument();
    expect(screen.getAllByText('1.00 MB/s').length).toBeGreaterThan(0);
    expect(screen.getByText('Preostalo oko 2 s')).toBeInTheDocument();
  });
});
