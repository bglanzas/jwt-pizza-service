const os = require('os');
const config = require('./config.js');

class MetricsService {
  constructor() {
    this.reportingPeriodMs = 60000;
    this.timer = null;
    this.started = false;
    this.reset();

    this.requestTracker = this.requestTracker.bind(this);
  }

  reset() {
    this.http = {
      activeRequests: 0,
      requestsByRoute: new Map(),
      latencyByRoute: new Map(),
    };
    this.auth = new Map();
    this.user = new Map();
    this.purchase = {
      countByResult: new Map(),
      latencyByResult: new Map(),
      revenueByResult: new Map(),
      pizzasByResult: new Map(),
    };
  }

  startReporting(periodMs = this.reportingPeriodMs) {
    if (this.started || this.isTestEnvironment()) {
      return;
    }

    this.started = true;
    this.timer = setInterval(() => {
      this.sendMetrics().catch((error) => {
        console.error('Error sending metrics', error);
      });
    }, periodMs);
    this.timer.unref?.();
  }

  stopReporting() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  requestTracker(req, res, next) {
    const startedAt = process.hrtime.bigint();
    this.http.activeRequests += 1;

    res.on('finish', () => {
      const latencyMs = this.elapsedMilliseconds(startedAt);
      const route = this.getRouteLabel(req);
      const status = String(res.statusCode);
      const labels = { method: req.method, route, status };

      this.incrementLabeledMetric(this.http.requestsByRoute, labels, 1);
      this.incrementLabeledMetric(this.http.latencyByRoute, labels, latencyMs);
      this.http.activeRequests = Math.max(0, this.http.activeRequests - 1);
    });

    next();
  }

  authEvent(action, success) {
    this.incrementLabeledMetric(this.auth, { action, result: success ? 'success' : 'failure' }, 1);
  }

  userEvent(action, success) {
    this.incrementLabeledMetric(this.user, { action, result: success ? 'success' : 'failure' }, 1);
  }

  pizzaPurchase(success, latencyMs, totalPrice, pizzaCount) {
    const labels = { result: success ? 'success' : 'failure' };
    this.incrementLabeledMetric(this.purchase.countByResult, labels, 1);
    this.incrementLabeledMetric(this.purchase.latencyByResult, labels, latencyMs);
    this.incrementLabeledMetric(this.purchase.revenueByResult, labels, totalPrice);
    this.incrementLabeledMetric(this.purchase.pizzasByResult, labels, pizzaCount);
  }

  async sendMetrics() {
    if (!this.canSendMetrics()) {
      return;
    }

    const payload = this.buildPayload();
    if (payload.resourceMetrics[0].scopeMetrics[0].metrics.length === 0) {
      return;
    }

    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Failed to push metrics data to Grafana: ${text}`);
    }
  }

  buildPayload() {
    const timeUnixNano = String(Date.now() * 1000000);
    const metrics = [
      this.makeGauge('system_cpu_usage_percent', this.getCpuUsagePercentage(), '%', timeUnixNano),
      this.makeGauge('system_memory_usage_percent', this.getMemoryUsagePercentage(), '%', timeUnixNano),
      this.makeGauge('http_active_requests', this.http.activeRequests, '1', timeUnixNano),
      this.makeSum('http_requests_total', this.http.requestsByRoute, '1', timeUnixNano),
      this.makeSum('http_request_duration_ms_total', this.http.latencyByRoute, 'ms', timeUnixNano),
      this.makeSum('auth_events_total', this.auth, '1', timeUnixNano),
      this.makeSum('user_events_total', this.user, '1', timeUnixNano),
      this.makeSum('pizza_purchases_total', this.purchase.countByResult, '1', timeUnixNano),
      this.makeSum('pizza_purchase_latency_ms_total', this.purchase.latencyByResult, 'ms', timeUnixNano),
      this.makeSum('pizza_purchase_revenue_total', this.purchase.revenueByResult, 'USD', timeUnixNano),
      this.makeSum('pizza_items_total', this.purchase.pizzasByResult, '1', timeUnixNano),
    ].filter(Boolean);

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: [
              this.attribute('service.name', config.metrics.source || 'jwt-pizza-service'),
              this.attribute('service.instance.id', os.hostname()),
            ],
          },
          scopeMetrics: [
            {
              scope: {
                name: 'jwt-pizza-service.metrics',
                version: '1.0.0',
              },
              metrics,
            },
          ],
        },
      ],
    };
  }

  makeGauge(name, value, unit, timeUnixNano) {
    if (!Number.isFinite(value)) {
      return null;
    }

    return {
      name,
      unit,
      gauge: {
        dataPoints: [
          {
            asDouble: value,
            timeUnixNano,
          },
        ],
      },
    };
  }

  makeSum(name, values, unit, timeUnixNano) {
    if (values.size === 0) {
      return null;
    }

    return {
      name,
      unit,
      sum: {
        aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
        isMonotonic: true,
        dataPoints: [...values.entries()].map(([serializedLabels, value]) => ({
          attributes: this.deserializeLabels(serializedLabels),
          asDouble: value,
          timeUnixNano,
        })),
      },
    };
  }

  incrementLabeledMetric(store, labels, delta) {
    const key = JSON.stringify(labels);
    store.set(key, (store.get(key) || 0) + delta);
  }

  deserializeLabels(serializedLabels) {
    const labels = JSON.parse(serializedLabels);
    return Object.entries(labels).map(([key, value]) => this.attribute(key, value));
  }

  attribute(key, value) {
    return {
      key,
      value: { stringValue: String(value) },
    };
  }

  getRouteLabel(req) {
    if (req.baseUrl && req.route?.path) {
      return `${req.baseUrl}${req.route.path}`;
    }
    if (req.route?.path) {
      return req.route.path;
    }
    if (req.baseUrl) {
      return req.baseUrl;
    }
    return req.path || 'unknown';
  }

  elapsedMilliseconds(startedAt) {
    return Number(process.hrtime.bigint() - startedAt) / 1000000;
  }

  getCpuUsagePercentage() {
    const coreCount = os.cpus().length || 1;
    const cpuUsage = os.loadavg()[0] / coreCount;
    return Number((cpuUsage * 100).toFixed(2));
  }

  getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    return Number(((usedMemory / totalMemory) * 100).toFixed(2));
  }

  canSendMetrics() {
    return Boolean(config.metrics?.endpointUrl && config.metrics?.accountId && config.metrics?.apiKey);
  }

  isTestEnvironment() {
    return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  }
}

module.exports = new MetricsService();
