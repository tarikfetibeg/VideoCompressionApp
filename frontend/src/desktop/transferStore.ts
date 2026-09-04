import { isDesktopRuntime } from './runtime';

export type StoredDownload = {
  id: string;
  userId: string;
  kind: string;
  payload: Record<string, unknown>;
  label: string;
  status: string;
  ticketId?: string;
  downloadUrl?: string;
  targetPath?: string;
  transferredBytes?: number;
  totalBytes?: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredUpload = {
  id: string;
  userId: string;
  filename: string;
  size: number;
  lastModified: number;
  status: string;
  progress: number;
  transferredBytes: number;
  transferId?: string;
  videoId?: string;
  uploadUrl?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

let databasePromise: Promise<any> | null = null;

async function database() {
  if (!isDesktopRuntime()) return null;
  if (!databasePromise) {
    databasePromise = import('@tauri-apps/plugin-sql').then(async ({ default: Database }) => {
      const db = await Database.load('sqlite:v2-transfers.db');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS download_queue (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          label TEXT NOT NULL,
          status TEXT NOT NULL,
          ticket_id TEXT,
          download_url TEXT,
          target_path TEXT,
          transferred_bytes INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execute('CREATE INDEX IF NOT EXISTS download_queue_user_status_idx ON download_queue(user_id, status, updated_at)');
      await db.execute(`
        CREATE TABLE IF NOT EXISTS upload_queue (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          size INTEGER NOT NULL,
          last_modified INTEGER NOT NULL,
          status TEXT NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          transferred_bytes INTEGER NOT NULL DEFAULT 0,
          transfer_id TEXT,
          video_id TEXT,
          upload_url TEXT,
          metadata_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await db.execute('CREATE INDEX IF NOT EXISTS upload_queue_user_status_idx ON upload_queue(user_id, status, updated_at)');
      return db;
    });
  }
  return databasePromise;
}

export async function persistUploads(records: StoredUpload[]): Promise<void> {
  const db = await database();
  if (!db) return;
  for (const item of records) {
    await db.execute(
      `INSERT INTO upload_queue (
        id, user_id, filename, size, last_modified, status, progress,
        transferred_bytes, transfer_id, video_id, upload_url, metadata_json,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
        progress=excluded.progress,
        transferred_bytes=excluded.transferred_bytes,
        transfer_id=excluded.transfer_id,
        video_id=excluded.video_id,
        upload_url=excluded.upload_url,
        metadata_json=excluded.metadata_json,
        updated_at=excluded.updated_at`,
      [
        item.id,
        item.userId,
        item.filename,
        Number(item.size || 0),
        Number(item.lastModified || 0),
        item.status,
        Number(item.progress || 0),
        Number(item.transferredBytes || 0),
        item.transferId || null,
        item.videoId || null,
        item.uploadUrl || null,
        JSON.stringify(item.metadata || {}),
        item.createdAt,
        item.updatedAt,
      ]
    );
  }
}

export async function loadRecoverableUploads(userId: string): Promise<StoredUpload[]> {
  const db = await database();
  if (!db || !userId) return [];
  const rows = await db.select(
    `SELECT * FROM upload_queue
     WHERE user_id = $1 AND status IN ('pending','preparing','uploading','paused','verifying','error')
     ORDER BY updated_at ASC LIMIT 30`,
    [userId]
  );
  return rows.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    size: Number(row.size || 0),
    lastModified: Number(row.last_modified || 0),
    status: 'paused',
    progress: Number(row.progress || 0),
    transferredBytes: Number(row.transferred_bytes || 0),
    transferId: row.transfer_id || '',
    videoId: row.video_id || '',
    uploadUrl: row.upload_url || '',
    metadata: JSON.parse(row.metadata_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function pruneFinishedUploads(userId: string): Promise<void> {
  const db = await database();
  if (!db || !userId) return;
  await db.execute(
    `DELETE FROM upload_queue
     WHERE user_id = $1 AND status IN ('done','cancelled')
       AND id NOT IN (
         SELECT id FROM upload_queue WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 30
       )`,
    [userId]
  );
}

export async function persistDownloads(records: StoredDownload[]): Promise<void> {
  const db = await database();
  if (!db) return;
  await db.execute('BEGIN');
  try {
    for (const item of records) {
      await db.execute(
        `INSERT INTO download_queue (
          id, user_id, kind, payload_json, label, status, ticket_id, download_url,
          target_path, transferred_bytes, total_bytes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status,
          ticket_id=excluded.ticket_id,
          download_url=excluded.download_url,
          target_path=excluded.target_path,
          transferred_bytes=excluded.transferred_bytes,
          total_bytes=excluded.total_bytes,
          updated_at=excluded.updated_at`,
        [
          item.id,
          item.userId,
          item.kind,
          JSON.stringify(item.payload || {}),
          item.label,
          item.status,
          item.ticketId || null,
          item.downloadUrl || null,
          item.targetPath || null,
          Number(item.transferredBytes || 0),
          Number(item.totalBytes || 0),
          item.createdAt,
          item.updatedAt,
        ]
      );
    }
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function loadRecoverableDownloads(userId: string): Promise<StoredDownload[]> {
  const db = await database();
  if (!db || !userId) return [];
  const rows = await db.select(
    `SELECT * FROM download_queue
     WHERE user_id = $1 AND status IN ('creating_ticket','opening','streaming','transferring','verifying','paused')
     ORDER BY updated_at ASC LIMIT 20`,
    [userId]
  );
  return rows.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json || '{}'),
    label: row.label,
    status: 'paused',
    ticketId: row.ticket_id || '',
    downloadUrl: row.download_url || '',
    targetPath: row.target_path || '',
    transferredBytes: Number(row.transferred_bytes || 0),
    totalBytes: Number(row.total_bytes || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function pruneFinishedDownloads(userId: string): Promise<void> {
  const db = await database();
  if (!db || !userId) return;
  await db.execute(
    `DELETE FROM download_queue
     WHERE user_id = $1 AND status IN ('completed','failed','aborted','expired','cancelled')
       AND id NOT IN (
         SELECT id FROM download_queue WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 30
       )`,
    [userId]
  );
}
