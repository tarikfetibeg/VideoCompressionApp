import axiosInstance from '../axiosConfig';

const TUS_VERSION = '1.0.0';
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

export type ResumableUploadState = {
  clientUploadId?: string;
  transferId?: string;
  videoId?: string;
  programFinalId?: string;
  uploadUrl?: string;
  offset?: number;
};

type UploadCallbacks = {
  signal?: AbortSignal;
  onPrepared?: (state: ResumableUploadState) => void;
  onProgress?: (offset: number, total: number) => void;
};

function absoluteUrl(value: string, base?: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const apiAnchor = new URL(String(axiosInstance.defaults.baseURL || '/api'), window.location.origin);
  if (value.startsWith('/')) return new URL(value, apiAnchor.origin).toString();
  const anchor = base || apiAnchor.toString();
  return new URL(value, anchor.endsWith('/') ? anchor : `${anchor}/`).toString();
}

export async function uploadProgramFinalResumable(
  programFinalId: string,
  file: File,
  replacementReason: string,
  current: ResumableUploadState,
  callbacks: UploadCallbacks = {}
) {
  let transfer: any;
  if (current.transferId) {
    transfer = (await axiosInstance.post(`/v2/uploads/transfers/${current.transferId}/resume`)).data;
  } else {
    const fingerprint = current.clientUploadId || `${programFinalId}:${file.name}:${file.size}:${file.lastModified}`;
    transfer = (await axiosInstance.post(`/v2/program-finals/${programFinalId}/upload-session`, {
      idempotencyKey: `program-final:${fingerprint}`,
      originalFilename: file.name,
      totalBytes: file.size,
      lastModified: file.lastModified,
      replacementReason,
    })).data;
  }

  if (transfer.status === 'completed') {
    callbacks.onProgress?.(file.size, file.size);
    return { ...transfer, uploadUrl: current.uploadUrl, offset: file.size };
  }

  const baseUrl = absoluteUrl(transfer.resumableUrl);
  let uploadUrl = current.uploadUrl;
  let offset = uploadUrl
    ? await readOffset(uploadUrl, transfer.authorization, callbacks.signal)
    : null;
  if (offset == null) {
    uploadUrl = await createTusResource(baseUrl, transfer.authorization, transfer.transferId, file, callbacks.signal);
    offset = 0;
  }
  callbacks.onPrepared?.({
    transferId: transfer.transferId,
    programFinalId,
    uploadUrl,
    offset,
  });

  let lastServerProgressAt = 0;
  while (offset < file.size) {
    const end = Math.min(offset + DEFAULT_CHUNK_SIZE, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PATCH',
      signal: callbacks.signal,
      headers: {
        Authorization: transfer.authorization,
        'Tus-Resumable': TUS_VERSION,
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: file.slice(offset, end),
    });
    if (response.status !== 204) {
      throw new Error((await responseMessage(response)) || `Upload chunk je vratio ${response.status}.`);
    }
    const nextOffset = Number(response.headers.get('Upload-Offset'));
    offset = Number.isFinite(nextOffset) ? nextOffset : end;
    callbacks.onProgress?.(offset, file.size);
    callbacks.onPrepared?.({ transferId: transfer.transferId, programFinalId, uploadUrl, offset });
    if (Date.now() - lastServerProgressAt >= 2000 || offset >= file.size) {
      lastServerProgressAt = Date.now();
      axiosInstance.patch(`/v2/uploads/transfers/${transfer.transferId}/progress`, {
        status: offset >= file.size ? 'verifying' : 'transferring',
        transferredBytes: offset,
      }).catch(() => {});
    }
  }

  const completed = await waitForServerCompletion(transfer.transferId);
  return { ...transfer, ...completed, programFinalId, uploadUrl, offset };
}

function base64Metadata(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary);
}

function responseMessage(response: Response): Promise<string> {
  return response.text().then((body) => {
    try {
      return JSON.parse(body)?.message || body;
    } catch {
      return body;
    }
  });
}

async function createTusResource(baseUrl: string, authorization: string, transferId: string, file: File, signal?: AbortSignal) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    signal,
    headers: {
      Authorization: authorization,
      'Tus-Resumable': TUS_VERSION,
      'Upload-Length': String(file.size),
      'Upload-Metadata': [
        `transferId ${base64Metadata(transferId)}`,
        `filename ${base64Metadata(file.name)}`,
        `filetype ${base64Metadata(file.type || 'application/octet-stream')}`,
      ].join(','),
    },
  });
  if (response.status !== 201) {
    throw new Error((await responseMessage(response)) || `Upload server je vratio ${response.status}.`);
  }
  const location = response.headers.get('Location');
  if (!location) throw new Error('Upload server nije vratio resumable lokaciju.');
  return absoluteUrl(location, baseUrl);
}

async function readOffset(uploadUrl: string, authorization: string, signal?: AbortSignal): Promise<number | null> {
  const response = await fetch(uploadUrl, {
    method: 'HEAD',
    signal,
    headers: { Authorization: authorization, 'Tus-Resumable': TUS_VERSION },
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error((await responseMessage(response)) || `Upload provjera je vratila ${response.status}.`);
  const offset = Number(response.headers.get('Upload-Offset'));
  return Number.isFinite(offset) ? offset : 0;
}

async function waitForServerCompletion(transferId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await axiosInstance.get(`/v2/uploads/transfers/${transferId}`);
    if (response.data?.status === 'completed') return response.data;
    if (response.data?.status === 'failed') {
      throw new Error(response.data?.error || 'Server nije završio obradu resumable uploada.');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  return { status: 'verifying' };
}

export async function uploadDirectFinalResumable(
  file: File,
  metadata: Record<string, unknown>,
  current: ResumableUploadState,
  callbacks: UploadCallbacks = {}
) {
  let transfer: any;
  if (current.transferId) {
    transfer = (await axiosInstance.post(`/v2/uploads/transfers/${current.transferId}/resume`)).data;
  } else {
    const fingerprint = current.clientUploadId || `${file.name}:${file.size}:${file.lastModified}`;
    transfer = (await axiosInstance.post('/v2/uploads/direct-final', {
      idempotencyKey: `direct-final:${fingerprint}`,
      originalFilename: file.name,
      totalBytes: file.size,
      lastModified: file.lastModified,
      metadata,
    })).data;
  }

  if (transfer.status === 'completed') {
    callbacks.onProgress?.(file.size, file.size);
    return { ...transfer, uploadUrl: current.uploadUrl, offset: file.size };
  }

  const baseUrl = absoluteUrl(transfer.resumableUrl);
  let uploadUrl = current.uploadUrl;
  let offset = uploadUrl
    ? await readOffset(uploadUrl, transfer.authorization, callbacks.signal)
    : null;
  if (offset == null) {
    uploadUrl = await createTusResource(
      baseUrl,
      transfer.authorization,
      transfer.transferId,
      file,
      callbacks.signal
    );
    offset = 0;
  }
  callbacks.onPrepared?.({
    transferId: transfer.transferId,
    videoId: transfer.videoId,
    uploadUrl,
    offset,
  });

  let lastServerProgressAt = 0;
  while (offset < file.size) {
    const end = Math.min(offset + DEFAULT_CHUNK_SIZE, file.size);
    const response = await fetch(uploadUrl, {
      method: 'PATCH',
      signal: callbacks.signal,
      headers: {
        Authorization: transfer.authorization,
        'Tus-Resumable': TUS_VERSION,
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      body: file.slice(offset, end),
    });
    if (response.status !== 204) {
      throw new Error((await responseMessage(response)) || `Upload chunk je vratio ${response.status}.`);
    }
    const nextOffset = Number(response.headers.get('Upload-Offset'));
    offset = Number.isFinite(nextOffset) ? nextOffset : end;
    callbacks.onProgress?.(offset, file.size);
    callbacks.onPrepared?.({ transferId: transfer.transferId, videoId: transfer.videoId, uploadUrl, offset });
    if (Date.now() - lastServerProgressAt >= 2000 || offset >= file.size) {
      lastServerProgressAt = Date.now();
      axiosInstance.patch(`/v2/uploads/transfers/${transfer.transferId}/progress`, {
        status: offset >= file.size ? 'verifying' : 'transferring',
        transferredBytes: offset,
      }).catch(() => {});
    }
  }

  const completed = await waitForServerCompletion(transfer.transferId);
  return {
    ...transfer,
    ...completed,
    uploadUrl,
    offset,
  };
}
