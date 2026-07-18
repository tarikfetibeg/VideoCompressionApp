import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import axiosInstance from '../axiosConfig';
import theme from '../theme';
import { UserContext } from '../contexts/UserContext';
import StoryboardPage from './StoryboardPage';

vi.mock('../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../components/common/VideoThumbnailPreview', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div aria-label={`Preview ${title}`} />,
}));

const mockedGet = vi.mocked(axiosInstance.get);
const mockedPut = vi.mocked(axiosInstance.put);
const mockedPost = vi.mocked(axiosInstance.post);

const job = {
  _id: 'job-1',
  title: 'Dnevnik - cijene goriva',
  segments: [
    {
      _id: 'segment-1',
      video: {
        _id: 'video-1',
        originalFilename: 'Izjava sagovornika.mp4',
        event: 'Cijene goriva',
        duration: 20,
      },
      startTime: 1,
      endTime: 12,
      notes: '',
    },
    {
      _id: 'segment-2',
      video: {
        _id: 'video-2',
        originalFilename: 'Insert pumpe.mp4',
        event: 'Cijene goriva',
        duration: 15,
      },
      startTime: 0,
      endTime: 8,
      notes: 'Pokriti prvi OFF.',
    },
  ],
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/edit-jobs/job-1/storyboard']}>
    <ThemeProvider theme={theme}>
      <UserContext.Provider value={{ user: { id: 'reporter-1', username: 'reporter', role: 'Reporter' } } as any}>
        <Routes>
          <Route path="/edit-jobs/:jobId/storyboard" element={<StoryboardPage />} />
        </Routes>
      </UserContext.Provider>
    </ThemeProvider>
  </MemoryRouter>
);

describe('StoryboardPage', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPut.mockReset();
    mockedPost.mockReset();
    mockedGet.mockImplementation((url: string) => {
      if (url === '/edit-jobs/job-1') return Promise.resolve({ data: job });
      if (url === '/v2/edit-jobs/job-1/rough-cut') {
        return Promise.resolve({ data: { roughCut: null, permissions: { view: true, edit: true, submit: true } } });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    mockedPut.mockResolvedValue({
      data: {
        roughCut: {
          version: 1,
          status: 'draft',
          updatedAt: '2026-07-18T12:00:00.000Z',
        },
      },
    });
    mockedPost.mockResolvedValue({
      data: {
        roughCut: {
          version: 1,
          status: 'submitted',
          updatedAt: '2026-07-18T12:01:00.000Z',
        },
      },
    });
  });

  it('shows a focused clip workspace and saves a new storyboard before submit', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Storyboard: Dnevnik - cijene goriva' })).toBeInTheDocument();
    expect(screen.getByText('Redoslijed')).toBeInTheDocument();
    expect(screen.getByText('Rez klipa')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Otvori klip 2' }));
    expect(screen.getByDisplayValue('0.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pokriti prvi OFF.')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Pošalji montaži' })[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pošalji montaži' }));

    await waitFor(() => {
      expect(axiosInstance.put).toHaveBeenCalledWith('/v2/edit-jobs/job-1/rough-cut', expect.objectContaining({
        version: 0,
        items: expect.arrayContaining([
          expect.objectContaining({ videoId: 'video-1', inMs: 1000, outMs: 12000 }),
          expect.objectContaining({ videoId: 'video-2', inMs: 0, outMs: 8000 }),
        ]),
      }));
      expect(axiosInstance.post).toHaveBeenCalledWith('/v2/edit-jobs/job-1/rough-cut/submit', { version: 1 });
    });
    expect(await screen.findByText(/Storyboard je poslan montaži/i)).toBeInTheDocument();
  });
});
