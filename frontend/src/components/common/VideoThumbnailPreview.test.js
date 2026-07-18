import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VideoThumbnailPreview from './VideoThumbnailPreview';
import axiosInstance from '../../axiosConfig';
import { vi } from 'vitest';

vi.mock('../../axiosConfig', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
  },
}));

const createBlob = (value) => new Blob([value], { type: 'image/jpeg' });

describe('VideoThumbnailPreview', () => {
  let objectUrlIndex = 0;

  beforeEach(() => {
    objectUrlIndex = 0;
    axiosInstance.get.mockReset();
    delete window.IntersectionObserver;

    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => {
        const objectUrl = `blob:mock-${objectUrlIndex}`;
        objectUrlIndex += 1;
        return objectUrl;
      }),
    });

    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
  });

  it('keeps the static thumbnail when scrub manifest is missing', async () => {
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/videos/thumbnail/video-1') {
        return Promise.resolve({ data: createBlob('thumbnail') });
      }

      if (url === '/videos/scrub-preview/video-1/manifest') {
        return Promise.reject(new Error('missing manifest'));
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<VideoThumbnailPreview videoId="video-1" enableScrubPreview />);

    await waitFor(() => {
      expect(screen.getByTestId('video-thumbnail-image')).toHaveAttribute('src', 'blob:mock-0');
    });

    expect(axiosInstance.get).toHaveBeenCalledWith('/videos/thumbnail/video-1', { responseType: 'blob' });
    expect(axiosInstance.get).toHaveBeenCalledWith('/videos/scrub-preview/video-1/manifest');
    expect(screen.queryByTestId('scrub-preview-indicator')).not.toBeInTheDocument();
  });

  it('loads a scrub frame from cursor position and resets on mouse leave', async () => {
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/videos/thumbnail/video-2') {
        return Promise.resolve({ data: createBlob('thumbnail') });
      }

      if (url === '/videos/scrub-preview/video-2/manifest') {
        return Promise.resolve({ data: { available: true, frameCount: 4 } });
      }

      if (url === '/videos/scrub-preview/video-2/frame/2') {
        return Promise.resolve({ data: createBlob('frame-2') });
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    render(<VideoThumbnailPreview videoId="video-2" enableScrubPreview />);

    const preview = screen.getByTestId('video-thumbnail-preview');
    preview.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      right: 100,
      bottom: 50,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    await waitFor(() => {
      expect(screen.getByTestId('video-thumbnail-image')).toHaveAttribute('src', 'blob:mock-0');
    });
    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith('/videos/scrub-preview/video-2/manifest');
    });

    fireEvent.mouseMove(preview, { clientX: 60 });

    await waitFor(() => {
      expect(screen.getByTestId('video-thumbnail-image')).toHaveAttribute('src', 'blob:mock-1');
    });
    expect(axiosInstance.get).toHaveBeenCalledWith('/videos/scrub-preview/video-2/frame/2', { responseType: 'blob' });
    expect(screen.getByTestId('scrub-preview-indicator')).toBeInTheDocument();

    fireEvent.mouseLeave(preview);

    await waitFor(() => {
      expect(screen.getByTestId('video-thumbnail-image')).toHaveAttribute('src', 'blob:mock-0');
    });
  });

  it('revokes thumbnail and scrub frame object URLs on unmount', async () => {
    axiosInstance.get.mockImplementation((url) => {
      if (url === '/videos/thumbnail/video-3') {
        return Promise.resolve({ data: createBlob('thumbnail') });
      }

      if (url === '/videos/scrub-preview/video-3/manifest') {
        return Promise.resolve({ data: { available: true, frameCount: 2 } });
      }

      if (url === '/videos/scrub-preview/video-3/frame/1') {
        return Promise.resolve({ data: createBlob('frame-1') });
      }

      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });

    const { unmount } = render(<VideoThumbnailPreview videoId="video-3" enableScrubPreview />);

    const preview = screen.getByTestId('video-thumbnail-preview');
    preview.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      right: 100,
      bottom: 50,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    await waitFor(() => {
      expect(screen.getByTestId('video-thumbnail-image')).toHaveAttribute('src', 'blob:mock-0');
    });

    fireEvent.mouseMove(preview, { clientX: 75 });

    await waitFor(() => {
      expect(screen.getByTestId('video-thumbnail-image')).toHaveAttribute('src', 'blob:mock-1');
    });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-0');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
  });
});
