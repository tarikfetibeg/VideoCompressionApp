import { z } from 'zod';

export const roleSchema = z.enum([
  'Reporter',
  'Editor',
  'VideoEditor',
  'Producer',
  'Realizator',
  'Archivist',
  'Admin',
]);

export const notificationSeveritySchema = z.enum(['info', 'action_required', 'critical']);
export const notificationStateSchema = z.enum(['unread', 'read', 'acknowledged', 'resolved']);

export const entityReferenceSchema = z.object({
  type: z.enum(['edit_job', 'video', 'show_day', 'correction', 'transfer', 'system']),
  id: z.string().min(1),
});

export const realtimeEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  severity: notificationSeveritySchema,
  entity: entityReferenceSchema,
  version: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const roughCutItemSchema = z.object({
  videoId: z.string().min(1),
  inMs: z.number().int().nonnegative(),
  outMs: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  note: z.string().max(1000).default(''),
}).refine((item) => item.outMs > item.inMs, {
  message: 'OUT tačka mora biti poslije IN tačke.',
  path: ['outMs'],
});

export const roughCutSchema = z.object({
  jobId: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'submitted', 'locked', 'superseded']),
  items: z.array(roughCutItemSchema).max(200),
  updatedAt: z.iso.datetime().optional(),
  submittedAt: z.iso.datetime().nullable().optional(),
});

export const transferStatusSchema = z.enum([
  'queued',
  'preparing',
  'transferring',
  'paused',
  'verifying',
  'completed',
  'failed',
  'cancelled',
]);

export const mediaAssetKindSchema = z.enum([
  'raw',
  'master',
  'final',
  'mp4_preview',
  'hls',
  'thumbnail',
  'scrub',
  'off_audio',
]);

export type UserRole = z.infer<typeof roleSchema>;
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;
export type NotificationState = z.infer<typeof notificationStateSchema>;
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
export type RoughCut = z.infer<typeof roughCutSchema>;
export type RoughCutItem = z.infer<typeof roughCutItemSchema>;
export type TransferStatus = z.infer<typeof transferStatusSchema>;
export type MediaAssetKind = z.infer<typeof mediaAssetKindSchema>;
