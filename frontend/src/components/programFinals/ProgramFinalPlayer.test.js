import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ProgramFinalPlayer from './ProgramFinalPlayer';
import axiosInstance from '../../axiosConfig';

vi.mock('../../axiosConfig', () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: '/api' },
    post: vi.fn(),
  },
}));

vi.mock('hls.js', () => ({
  default: {
    isSupported: () => false,
  },
}));

describe('ProgramFinalPlayer', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    axiosInstance.post.mockReset();
    axiosInstance.post.mockResolvedValue({
      data: {
        manifestUrl: '/api/program-finals/media/token/hls/master.m3u8',
        fallbackUrl: '/api/program-finals/media/token/access.mp4',
        thumbnailUrl: '/api/program-finals/media/token/thumbnail.jpg',
      },
    });
  });

  it('traži ticket samo za odabrani final i skriva download kontrolu', async () => {
    render(<ProgramFinalPlayer programFinalId="final-1" versionId="version-2" />);
    await waitFor(() => {
      expect(axiosInstance.post).toHaveBeenCalledWith('/program-finals/final-1/media-ticket', { versionId: 'version-2' });
    });
    const player = screen.getByText('Pripremam zaštićeni stream...').parentElement.parentElement.querySelector('video');
    expect(player).toHaveAttribute('controlsList', 'nodownload');
    await waitFor(() => {
      expect(player).toHaveAttribute('poster', '/api/program-finals/media/token/thumbnail.jpg');
    });
  });
});
