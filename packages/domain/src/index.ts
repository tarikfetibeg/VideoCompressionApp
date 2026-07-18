export type NotificationSeverity = 'info' | 'action_required' | 'critical';

export interface NotificationPolicyInput {
  type: string;
  showStartsAt?: string | null;
  changedAfterDownload?: boolean;
}

const CRITICAL_TYPES = new Set([
  'broadcast.rundown.asset_failed',
  'broadcast.rundown.asset_removed',
  'broadcast.rundown.asset_replaced',
  'correction.current_show_reported',
]);

export function classifyNotification(input: NotificationPolicyInput): NotificationSeverity {
  if (input.changedAfterDownload || CRITICAL_TYPES.has(input.type)) return 'critical';
  if (
    input.type.startsWith('edit_job.')
    || input.type.startsWith('correction.')
    || input.type.endsWith('.deadline_soon')
  ) {
    return 'action_required';
  }
  return 'info';
}

export function calculateRoughCutDuration(items: Array<{ inMs: number; outMs: number }>): number {
  return items.reduce((total, item) => total + Math.max(item.outMs - item.inMs, 0), 0);
}
