const EscalationPolicy = require('../models/EscalationPolicy');
const Notification = require('../models/Notification');
const { enqueueDomainEvent } = require('./domainEventService');

const DEFAULT_ESCALATION_ROLES = ['Producer', 'Realizator', 'Admin'];

async function escalateUnacknowledgedNotifications(limit = 50) {
  const notifications = await Notification.find({
    severity: 'critical',
    state: { $nin: ['acknowledged', 'resolved'] },
    ackDeadlineAt: { $lte: new Date() },
    escalationLevel: { $lt: 2 },
  }).sort({ ackDeadlineAt: 1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const result = { escalated: 0, failed: 0 };
  for (const notification of notifications) {
    try {
      const policy = await EscalationPolicy.findOne({ eventType: notification.kind, enabled: true });
      const nextLevel = Number(notification.escalationLevel || 0) + 1;
      const roles = policy?.escalationRoles?.length
        ? policy.escalationRoles
        : DEFAULT_ESCALATION_ROLES;
      const ackSeconds = Number(policy?.acknowledgeAfterSeconds || 180);

      await enqueueDomainEvent({
        type: `${notification.kind}.escalated`,
        severity: 'critical',
        actor: notification.actor,
        recipientRoles: roles,
        entityType: notification.entityType,
        entityId: notification.entityId,
        title: `Nije potvrđeno: ${notification.title}`,
        bodyPreview: notification.bodyPreview,
        deepLink: notification.deepLink,
        payload: {
          sourceNotificationId: notification._id,
          escalationLevel: nextLevel,
        },
        dedupeKey: `${notification._id}:escalation:${nextLevel}`,
      });

      notification.escalationLevel = nextLevel;
      notification.escalatedAt = new Date();
      notification.ackDeadlineAt = new Date(Date.now() + ackSeconds * 1000);
      await notification.save();
      result.escalated += 1;
    } catch (error) {
      console.error('Notification escalation failed:', error);
      result.failed += 1;
    }
  }
  return result;
}

module.exports = { escalateUnacknowledgedNotifications };
