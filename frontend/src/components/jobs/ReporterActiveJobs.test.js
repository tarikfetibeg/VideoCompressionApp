import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import axiosInstance from '../../axiosConfig';
import theme from '../../theme';
import ReporterActiveJobs from './ReporterActiveJobs';
import { vi } from 'vitest';

vi.mock('../../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const activeJob = {
  _id: 'job-1',
  title: 'Jutarnji prilog',
  status: 'needs_info',
  priority: 'high',
  workspaceState: 'active',
  deadlineState: 'due_soon',
  segments: [],
  comments: [{
    _id: 'comment-1',
    body: 'Treba još jedan insert.',
    author: { username: 'montazer' },
    createdAt: '2026-06-28T08:00:00.000Z',
  }],
  viewerMeta: {
    hasUnreadChanges: true,
    unreadChangeCount: 1,
  },
};

describe('ReporterActiveJobs', () => {
  beforeEach(() => {
    axiosInstance.get.mockReset();
    axiosInstance.post.mockReset();
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/edit-jobs/workspace') {
        return Promise.resolve({
          data: {
            items: [activeJob],
            summary: { total: 1, needsInfo: 1 },
          },
        });
      }
      if (url === '/edit-jobs/job-1') {
        return Promise.resolve({
          data: {
            ...activeJob,
            viewerMeta: { hasUnreadChanges: false, unreadChangeCount: 0 },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  it('shows priority actions and opens the quick comment panel', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <ReporterActiveJobs />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Jutarnji prilog')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Dodaj klipove' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Komentari' }));

    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith('/edit-jobs/job-1');
      expect(screen.getByText('Treba još jedan insert.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pošalji komentar' })).toBeInTheDocument();
    });

    const drawerRoot = document.querySelector('.MuiDrawer-root');
    expect(drawerRoot).toHaveStyle({ zIndex: '1301' });

    const backdrop = document.querySelector('.MuiBackdrop-root');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop);

    await waitFor(() => {
      expect(screen.queryByText('Brzi pregled joba')).not.toBeInTheDocument();
    });
  });
});
