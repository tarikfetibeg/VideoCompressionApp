const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const Video = require('../models/Video');
const EditJob = require('../models/EditJob');
const Feedback = require('../models/Feedback');
const AuditLog = require('../models/AuditLog');
const ShowDay = require('../models/ShowDay');
const CorrectionRequest = require('../models/CorrectionRequest');
const DownloadTicket = require('../models/DownloadTicket');
const MediaTicket = require('../models/MediaTicket');
const Notification = require('../models/Notification');
const Session = require('../models/Session');
const Device = require('../models/Device');
const EventOutbox = require('../models/EventOutbox');
const EscalationPolicy = require('../models/EscalationPolicy');
const MediaNode = require('../models/MediaNode');
const MediaAsset = require('../models/MediaAsset');
const MediaTask = require('../models/MediaTask');
const RoughCut = require('../models/RoughCut');
const TransferSession = require('../models/TransferSession');

const models = [
  Video,
  EditJob,
  Feedback,
  AuditLog,
  ShowDay,
  CorrectionRequest,
  DownloadTicket,
  MediaTicket,
  Notification,
  Session,
  Device,
  EventOutbox,
  EscalationPolicy,
  MediaNode,
  MediaAsset,
  MediaTask,
  RoughCut,
  TransferSession,
];

async function listIndexNames(model) {
  const indexes = await model.collection.indexes();
  return indexes.map((index) => index.name).sort();
}

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    throw new Error('MONGODB_URI is required.');
  }

  await mongoose.connect(mongoURI, {
    autoIndex: false,
  });

  for (const model of models) {
    const before = await listIndexNames(model);
    await model.createIndexes();
    const after = await listIndexNames(model);
    const created = after.filter((name) => !before.includes(name));

    console.log(`${model.modelName}: ${created.length ? `created ${created.join(', ')}` : 'no new indexes'}`);
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
