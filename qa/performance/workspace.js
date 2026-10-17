const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { explainQuery } = require('../helpers/explain');

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(Math.ceil(values.length * p) - 1, values.length - 1)];

module.exports = async (qa, f, test) => {
  const { models, api } = qa;
  const search = qa.load('utils/searchText');
  const measurements = [];
  const explains = [];
  for (const count of [10000, 50000]) {
    const current = await models.Video.countDocuments();
    const template = f.videos[1].toObject();
    delete template._id; delete template.__v;
    delete template.sourceJob; delete template.hlsPreview; delete template.scrubPreview;
    for (let start = current; start < count; start += 1000) {
      const documents = [];
      for (let i = start; i < Math.min(start + 1000, count); i += 1) {
        const document = { ...template, originalFilename: `Biblioteka ${i} insert Sarajevo.mp4`, finalTitle: `Prilog ${i}`, uploadDate: new Date(Date.now() - i * 1000), timecodes: [], correctionReports: [], keywords: ['insert', 'Sarajevo'], contentType: i % 3 ? f.categories.prilog._id : f.categories.insert._id, finalCategory: i % 3 ? 'prilog' : 'insert' };
        document.searchText = search.buildVideoSearchText(document);
        document.searchPrefixes = search.buildVideoSearchPrefixes(document);
        documents.push(document);
      }
      await models.Video.collection.insertMany(documents);
    }
    const jobTarget = count === 10000 ? 1000 : 5000;
    const jobCount = await models.EditJob.countDocuments();
    if (jobCount < jobTarget) {
      const jobDocuments = [];
      for (let i = jobCount; i < jobTarget; i += 1) jobDocuments.push({ title: `Veliki QA job ${i}`, reporter: f.users.Reporter._id, contentType: f.categories.prilog._id, workspaceState: 'active', status: 'submitted', jobKind: 'standard', priority: 'normal', segments: [{ video: f.videos[0]._id, order: 0, required: true }], comments: [], changeLog: [], viewerStates: [], downloadStates: [], updatedAt: new Date(Date.now() - i * 1000), createdAt: new Date(), searchText: `veliki qa job ${i}` });
      await models.EditJob.collection.insertMany(jobDocuments);
    }
    if (count === 50000) {
      const feedbackCount = await models.Feedback.countDocuments();
      const feedback = [];
      for (let i = feedbackCount; i < 1000; i += 1) feedback.push({ title: `QA prijava ${i}`, description: 'Veliki testni skup', status: 'new', priority: 'normal', area: 'other', type: 'bug', submittedBy: f.users.Reporter._id, updatedAt: new Date(Date.now() - i * 1000), createdAt: new Date(), comments: [], searchText: `qa prijava ${i}` });
      if (feedback.length) await models.Feedback.collection.insertMany(feedback);
      const auditCount = await models.AuditLog.countDocuments();
      for (let start = auditCount; start < 100000; start += 5000) {
        const logs = [];
        for (let i = start; i < Math.min(start + 5000, 100000); i += 1) logs.push({ action: i % 3 ? 'QA Video View' : 'QA Job Update', performedBy: f.users.Admin._id, details: { videoId: f.videos[1]._id, sequence: i }, timestamp: new Date(Date.now() - i * 1000) });
        await models.AuditLog.collection.insertMany(logs);
      }
    }
    console.log(`Performance dataset: ${count} videos`);
    const cases = [
      ['video-list', 'Editor', '/api/videos/workspace?limit=30', 500],
      ['archive', 'Archivist', '/api/archive/videos/workspace?limit=30', 1000],
      ['prefix', 'Producer', '/api/broadcast/library-search?search=inse&limit=30', 1000],
      ['jobs', 'Editor', '/api/edit-jobs/workspace?workspaceState=active&limit=30', 1000],
      ...(count === 50000 ? [
        ['feedback-1000', 'Admin', '/api/feedback/workspace?limit=30', 1000],
        ['audit-100000', 'Admin', '/api/admin/audit-logs/workspace?limit=30', 1000],
      ] : []),
    ];
    for (const [name, role, route, target10k] of cases) {
      await test(`PERF-${count}-${name}`, `${name}: full endpoint p95 at ${count} records, 10 sessions`, async () => {
        for (let i = 0; i < 5; i += 1) await api(role, route);
        const samples = [];
        for (let batch = 0; batch < 10; batch += 1) {
          await Promise.all(Array.from({ length: 10 }, async () => {
            const start = performance.now(); const response = await api(role, route);
            samples.push(performance.now() - start);
            assert.equal(response.status, 200); assert.ok(response.data.items.length <= 30);
            if (name === 'video-list') assert.equal(response.data.total, count);
          }));
        }
        const measurement = { count, endpoint: name, sessions: 10, samples: samples.length, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), target: count === 10000 ? target10k : 1500 };
        measurements.push(measurement);
        fs.writeFileSync(path.join(qa.output, 'performance.json'), JSON.stringify(measurements, null, 2));
        assert.ok(measurement.p95 <= measurement.target, `p95 ${Math.round(measurement.p95)}ms > ${measurement.target}ms`);
        return measurement;
      });
    }
    const filters = [{ processingStatus: 'completed', status: 'edited' }, { searchPrefixes: { $all: ['inse', 'sar'] } }, { uploader: f.users.Reporter._id }];
    for (const [index, filter] of filters.entries()) {
      await test(`EXPLAIN-${count}-${index}`, 'Primary query executionStats avoids COLLSCAN', async () => {
        const explain = await explainQuery(models.Video, filter, { uploadDate: -1 });
        explains.push({ count, filter, ...explain });
        assert.ok(!JSON.stringify(explain.queryPlanner).includes('COLLSCAN'), 'Winning plan contains COLLSCAN');
        return { metadataEncodingWarning: explain.metadataEncodingWarning, keysExamined: explain.stats.totalKeysExamined, docsExamined: explain.stats.totalDocsExamined };
      });
    }
    const archiveSearch = {};
    qa.load('utils/archiveEligibility').applyApprovedArchiveEligibility(archiveSearch);
    search.addVideoPrefixSearchFilter(archiveSearch, 'inse sar');
    await test(`EXPLAIN-${count}-archive-prefix-fallback`, 'Archive eligibility plus real prefix/legacy fallback query avoids COLLSCAN', async () => {
      const explain = await explainQuery(models.Video, archiveSearch, { uploadDate: -1 });
      explains.push({ count, filter: archiveSearch, ...explain });
      assert.ok(!JSON.stringify(explain.queryPlanner).includes('COLLSCAN'), 'Archive/prefix/legacy winning plan contains COLLSCAN');
      return { keysExamined: explain.stats.totalKeysExamined, docsExamined: explain.stats.totalDocsExamined };
    });
    const page = await api('Editor', `/api/videos/workspace?limit=30&page=${Math.ceil(count / 30)}`);
    await test(`PERF-${count}-last-page`, `Last page is reachable at ${count} videos`, async () => { assert.equal(page.status, 200); assert.equal(page.data.total, count); assert.ok(page.data.items.length > 0); });
  }
  await test('PERF-storage-cached', 'Cached storage overview p95 <=200ms over 100 serial warmed requests', async () => {
    const route = '/api/admin/storage/overview';
    for (let i = 0; i < 5; i += 1) await api('Admin', route);
    const samples = [];
    for (let i = 0; i < 100; i += 1) {
      const started = performance.now(); const response = await api('Admin', route);
      assert.equal(response.status, 200); samples.push(performance.now() - started);
    }
    const measurement = { endpoint: 'storage-cached', sessions: 1, samples: 100, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), target: 200 };
    measurements.push(measurement); assert.ok(measurement.p95 <= 200, `p95 ${measurement.p95}ms > 200ms`);
    return measurement;
  });
  fs.writeFileSync(path.join(qa.output, 'performance.json'), JSON.stringify(measurements, null, 2));
  fs.writeFileSync(path.join(qa.output, 'query-explain.json'), JSON.stringify(explains, null, 2));
  fs.writeFileSync(path.join(qa.output, 'PERFORMANCE_PRIJE_POSLIJE.csv'), 'count,endpoint,sessions,samples,p50ms,p95ms,targetms\n' + measurements.map((m) => [m.count, m.endpoint, m.sessions, m.samples, m.p50.toFixed(1), m.p95.toFixed(1), m.target].join(',')).join('\n'));
};
