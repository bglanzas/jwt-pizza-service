const os = require('os');
const config = require('./config');

const metricsConfig = config.metrics || {};
const enabled = Boolean(metricsConfig.endpointUrl && metricsConfig.accountId && metricsConfig.apiKey);
const source = metricsConfig.source || 'jwt-pizza-service';

const RESOURCE_ATTRIBUTES = [
  { key: 'service.name', value: { stringValue: source } },
  { key: 'service.instance.id', value: { stringValue: os.hostname() } },
];

const SCOPE = { name: source };
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 200;

const counters = new Map();
const pendingMetrics = [];
const SYSTEM_METRICS_INTERVAL_MS = 10000;

function nowUnixNano() {
  return Date.now() * 1_000_000;
}

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return Number(memoryUsage.toFixed(2));
}

function toAttributes(attributes = {}) {
  return Object.entries(attributes).map(([key, value]) => {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return { key, value: { intValue: value } };
    }
    if (typeof value === 'number') {
      return { key, value: { doubleValue: value } };
    }
    if (typeof value === 'boolean') {
      return { key, value: { boolValue: value } };
    }
    return { key, value: { stringValue: String(value) } };
  });
}

function buildMetric(metricName, metricValue, type, unit, attributes) {
  const dataPoint = {
    timeUnixNano: nowUnixNano(),
    attributes: toAttributes(attributes),
  };

  if (typeof metricValue === 'number' && Number.isInteger(metricValue)) {
    dataPoint.asInt = metricValue;
  } else {
    dataPoint.asDouble = metricValue;
  }

  const metric = {
    name: metricName,
    unit: unit || '1',
    [type]: {
      dataPoints: [dataPoint],
    },
  };

  if (type === 'sum') {
    metric[type].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric[type].isMonotonic = true;
  }

  return metric;
}

function enqueueMetric(metric) {
  if (!enabled) return;
  pendingMetrics.push(metric);
  if (pendingMetrics.length >= MAX_BATCH) {
    void flushMetrics();
  }
}

async function flushMetrics() {
  if (!enabled || pendingMetrics.length === 0) return;

  const batch = pendingMetrics.splice(0, pendingMetrics.length);
  const payload = {
    resourceMetrics: [
      {
        resource: { attributes: RESOURCE_ATTRIBUTES },
        scopeMetrics: [
          {
            scope: SCOPE,
            metrics: batch,
          },
        ],
      },
    ],
  };

  try {
    const response = await fetch(metricsConfig.endpointUrl, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${metricsConfig.accountId}:${metricsConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Grafana metrics push failed: ${response.status} ${text}`);
    }
  } catch (error) {
    console.error('Grafana metrics push error:', error);
  }
}

if (enabled) {
  const timer = setInterval(() => {
    void flushMetrics();
  }, FLUSH_INTERVAL_MS);
  timer.unref();

  const systemTimer = setInterval(() => {
    recordGauge('system_cpu_percent', getCpuUsagePercentage(), {}, '%');
    recordGauge('system_memory_percent', getMemoryUsagePercentage(), {}, '%');
  }, SYSTEM_METRICS_INTERVAL_MS);
  systemTimer.unref();
}

function incrementCounter(name, delta = 1, attributes = {}, unit = '1') {
  const current = counters.get(name) || 0;
  const next = current + delta;
  counters.set(name, next);
  enqueueMetric(buildMetric(name, next, 'sum', unit, attributes));
  return next;
}

function recordGauge(name, value, attributes = {}, unit = '1') {
  enqueueMetric(buildMetric(name, value, 'gauge', unit, attributes));
}

function recordDuration(baseName, durationMs, attributes = {}) {
  incrementCounter(`${baseName}_count`, 1, attributes, '1');
  incrementCounter(`${baseName}_ms_sum`, durationMs, attributes, 'ms');
}

function pizzaPurchase(success, latencyMs, price, count = 1) {
  incrementCounter('pizza_purchases_total', 1, {}, '1');
  incrementCounter(success ? 'pizza_purchases_success_total' : 'pizza_purchases_failure_total', 1, {}, '1');
  incrementCounter('pizza_purchases_items_total', count, {}, '1');
  incrementCounter('pizza_purchases_revenue_total', price, {}, 'usd');
  recordDuration('pizza_purchase_latency', latencyMs, {});
}

function createHttpMetricsMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const attributes = {
        method: req.method,
        route: req.route?.path || req.path,
        status_code: res.statusCode,
      };

      incrementCounter('http_requests_total', 1, attributes, '1');
      recordDuration('http_request_duration', durationMs, attributes);
      if (res.statusCode >= 500) {
        incrementCounter('http_requests_error_total', 1, attributes, '1');
      }
    });

    next();
  };
}

module.exports = {
  enabled,
  flushMetrics,
  incrementCounter,
  recordGauge,
  recordDuration,
  pizzaPurchase,
  requestTracker: createHttpMetricsMiddleware(),
  createHttpMetricsMiddleware,
};
