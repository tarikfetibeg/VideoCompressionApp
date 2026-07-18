const path = require('path');
const dotenvFlow = require('dotenv-flow');
const mongoose = require('mongoose');

dotenvFlow.config({ cwd: path.resolve(__dirname, '..', '..') });

const { processOutboxBatch } = require('../services/domainEventService');
const { escalateUnacknowledgedNotifications } = require('../services/notificationEscalationService');

let stopping = false;

async function tick() {
  const outbox = await processOutboxBatch(100);
  const escalation = await escalateUnacknowledgedNotifications(50);
  if (outbox.processed || outbox.failed || escalation.escalated || escalation.failed) {
    console.log('Event worker tick:', { outbox, escalation });
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  console.log('Event outbox worker connected.');

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      console.error('Event worker tick failed:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await mongoose.disconnect();
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

main().catch((error) => {
  console.error('Event worker failed:', error);
  process.exitCode = 1;
});
