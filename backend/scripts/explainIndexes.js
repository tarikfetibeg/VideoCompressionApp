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
const { buildMongoTextSearch, buildPrefixSearchTerms } = require('../utils/searchText');

function collectStages(plan, stages = []) {
  if (!plan || typeof plan !== 'object') return stages;
  if (plan.stage) stages.push(plan.stage);
  if (plan.inputStage) collectStages(plan.inputStage, stages);
  if (plan.inputStages) plan.inputStages.forEach((stage) => collectStages(stage, stages));
  if (plan.queryPlan) collectStages(plan.queryPlan, stages);
  if (plan.winningPlan) collectStages(plan.winningPlan, stages);
  if (plan.shards) {
    Object.values(plan.shards).forEach((shard) => collectStages(shard.winningPlan || shard, stages));
  }
  return stages;
}

function summarizeExplain(name, explain) {
  const executionStats = explain.executionStats || {};
  const queryPlanner = explain.queryPlanner || {};
  const stages = collectStages(queryPlanner.winningPlan || queryPlanner);

  return {
    name,
    winningStages: Array.from(new Set(stages)),
    executionTimeMillis: executionStats.executionTimeMillis,
    nReturned: executionStats.nReturned,
    totalKeysExamined: executionStats.totalKeysExamined,
    totalDocsExamined: executionStats.totalDocsExamined,
  };
}

async function explainQuery(name, query) {
  try {
    const explain = await query.explain('executionStats');
    return summarizeExplain(name, explain);
  } catch (error) {
    return {
      name,
      error: error.message,
    };
  }
}

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    throw new Error('MONGODB_URI is required.');
  }

  const search = buildMongoTextSearch(process.env.EXPLAIN_SEARCH || 'test materijal');
  const searchPrefixes = buildPrefixSearchTerms(process.env.EXPLAIN_PREFIX_SEARCH || 'ins');

  await mongoose.connect(mongoURI, {
    autoIndex: false,
  });

  const queries = [
    explainQuery(
      'videos.workspace.recent',
      Video.find({ status: 'edited', processingStatus: 'completed' })
        .sort({ uploadDate: -1 })
        .limit(50)
    ),
    explainQuery(
      'videos.workspace.prefixSearch',
      Video.find({
        status: 'edited',
        ...(searchPrefixes.length ? { searchPrefixes: { $all: searchPrefixes } } : {}),
      })
        .sort({ uploadDate: -1 })
        .limit(50)
    ),
    explainQuery(
      'editJobs.workspace.status',
      EditJob.find({ status: 'submitted' })
        .sort({ updatedAt: -1 })
        .limit(50)
    ),
    explainQuery(
      'editJobs.workspace.active',
      EditJob.find({ workspaceState: 'active' })
        .sort({ updatedAt: -1 })
        .limit(50)
    ),
    explainQuery(
      'feedback.workspace.open',
      Feedback.find({ status: { $in: ['new', 'reviewing', 'planned'] } })
        .sort({ updatedAt: -1 })
        .limit(50)
    ),
    explainQuery(
      'auditLogs.workspace.recent',
      AuditLog.find({})
        .sort({ timestamp: -1 })
        .limit(250)
    ),
  ];

  const results = await Promise.all(queries);
  console.log(JSON.stringify({
    search,
    searchPrefixes,
    results,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
