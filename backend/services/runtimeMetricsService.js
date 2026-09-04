const { monitorEventLoopDelay, performance } = require('perf_hooks');

const MAX_ROUTES = 200;
const SLOW_REQUEST_LIMIT = 40;
const requestRoutes = new Map();
const slowRequests = [];
const operationMetrics = new Map();
const startedAt = new Date();
let activeRequests = 0;
let previousCpuUsage = process.cpuUsage();
let previousCpuTimestamp = performance.now();

const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

function finiteMilliseconds(value) {
  return Number.isFinite(value) ? Math.max(Math.round(value * 10) / 10, 0) : 0;
}

function percentileNanosecondsToMs(value) {
  return Number.isFinite(value) ? finiteMilliseconds(value / 1e6) : 0;
}

function routeKey(req) {
  const routePath = req.route?.path;
  if (routePath) return `${req.method} ${req.baseUrl || ''}${routePath}`;
  return `${req.method} ${String(req.path || req.originalUrl || '/').split('?')[0]}`;
}

function getOrCreateRoute(key) {
  if (requestRoutes.has(key)) return requestRoutes.get(key);
  if (requestRoutes.size >= MAX_ROUTES) return null;
  const metric = {
    key,
    count: 0,
    errors: 0,
    totalMs: 0,
    maxMs: 0,
    buckets: { under50: 0, under250: 0, under1000: 0, under3000: 0, over3000: 0 },
  };
  requestRoutes.set(key, metric);
  return metric;
}

function recordRequest(req, res, durationMs) {
  const key = routeKey(req);
  const metric = getOrCreateRoute(key);
  if (metric) {
    metric.count += 1;
    metric.totalMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    if (res.statusCode >= 500) metric.errors += 1;
    if (durationMs < 50) metric.buckets.under50 += 1;
    else if (durationMs < 250) metric.buckets.under250 += 1;
    else if (durationMs < 1000) metric.buckets.under1000 += 1;
    else if (durationMs < 3000) metric.buckets.under3000 += 1;
    else metric.buckets.over3000 += 1;
  }

  if (durationMs >= 750 || res.statusCode >= 500) {
    slowRequests.unshift({
      route: key,
      statusCode: res.statusCode,
      durationMs: finiteMilliseconds(durationMs),
      occurredAt: new Date(),
    });
    slowRequests.splice(SLOW_REQUEST_LIMIT);
  }
}

function requestMetricsMiddleware(req, res, next) {
  if (!String(req.originalUrl || '').startsWith('/api/')) return next();
  const started = performance.now();
  activeRequests += 1;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    activeRequests = Math.max(activeRequests - 1, 0);
    recordRequest(req, res, performance.now() - started);
  };
  res.once('finish', finish);
  res.once('close', finish);
  return next();
}

function recordOperation(name, durationMs, status = 'completed') {
  const key = String(name || 'unknown').slice(0, 100);
  const current = operationMetrics.get(key) || {
    name: key,
    count: 0,
    failed: 0,
    totalMs: 0,
    maxMs: 0,
    lastStatus: '',
    lastCompletedAt: null,
  };
  current.count += 1;
  current.totalMs += Number(durationMs) || 0;
  current.maxMs = Math.max(current.maxMs, Number(durationMs) || 0);
  if (status === 'failed') current.failed += 1;
  current.lastStatus = status;
  current.lastCompletedAt = new Date();
  operationMetrics.set(key, current);
}

function cpuSnapshot() {
  const now = performance.now();
  const elapsedMicros = Math.max((now - previousCpuTimestamp) * 1000, 1);
  const usage = process.cpuUsage(previousCpuUsage);
  previousCpuUsage = process.cpuUsage();
  previousCpuTimestamp = now;
  return finiteMilliseconds(((usage.user + usage.system) / elapsedMicros) * 100);
}

function snapshotRuntimeMetrics() {
  const memory = process.memoryUsage();
  const routes = Array.from(requestRoutes.values())
    .map((item) => ({
      ...item,
      totalMs: finiteMilliseconds(item.totalMs),
      averageMs: finiteMilliseconds(item.count ? item.totalMs / item.count : 0),
      maxMs: finiteMilliseconds(item.maxMs),
    }))
    .sort((a, b) => b.averageMs - a.averageMs);
  const operations = Array.from(operationMetrics.values())
    .map((item) => ({
      ...item,
      totalMs: finiteMilliseconds(item.totalMs),
      averageMs: finiteMilliseconds(item.count ? item.totalMs / item.count : 0),
      maxMs: finiteMilliseconds(item.maxMs),
    }))
    .sort((a, b) => b.averageMs - a.averageMs);

  return {
    startedAt,
    generatedAt: new Date(),
    uptimeSeconds: Math.round(process.uptime()),
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuPercentSinceLastSnapshot: cpuSnapshot(),
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
    },
    eventLoop: {
      p50Ms: percentileNanosecondsToMs(eventLoopHistogram.percentile(50)),
      p95Ms: percentileNanosecondsToMs(eventLoopHistogram.percentile(95)),
      p99Ms: percentileNanosecondsToMs(eventLoopHistogram.percentile(99)),
      maxMs: percentileNanosecondsToMs(eventLoopHistogram.max),
    },
    requests: {
      active: activeRequests,
      total: routes.reduce((sum, item) => sum + item.count, 0),
      errors: routes.reduce((sum, item) => sum + item.errors, 0),
      slowestRoutes: routes.slice(0, 12),
      recentSlowOrFailed: slowRequests.slice(0, 20),
    },
    operations,
  };
}

function resetRuntimeMetricsForTests() {
  requestRoutes.clear();
  slowRequests.splice(0);
  operationMetrics.clear();
  activeRequests = 0;
  eventLoopHistogram.reset();
}

module.exports = {
  recordOperation,
  requestMetricsMiddleware,
  resetRuntimeMetricsForTests,
  snapshotRuntimeMetrics,
};
