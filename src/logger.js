const config = require('./config.js');

const SENSITIVE_KEY_PATTERNS = {
  secret: /(authorization|password|token|jwt|secret|api[-_]?key|cookie|set-cookie|signature)/i,
  email: /email/i,
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const BASIC_PATTERN = /\bBasic\s+[A-Za-z0-9+/=]+\b/gi;
const SAFE_KEYS = new Set(['hasAuthorizationHeader']);
const DEFAULT_SERVICE_NAME = 'jwt-pizza-service';

function isSecretKey(key = '') {
  if (SAFE_KEYS.has(key)) {
    return false;
  }

  return SENSITIVE_KEY_PATTERNS.secret.test(key);
}

function isEmailKey(key = '') {
  return SENSITIVE_KEY_PATTERNS.email.test(key);
}

function redactString(value) {
  return String(value)
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(BASIC_PATTERN, 'Basic [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
}

function sanitize(value, key, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (isSecretKey(key)) {
    return '[REDACTED]';
  }

  if (isEmailKey(key)) {
    return '[REDACTED_EMAIL]';
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return redactString(value.toString('utf8'));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return sanitize(
      {
        name: value.name,
        message: value.message,
        stack: value.stack,
      },
      key,
      seen
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, undefined, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    const sanitizedObject = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitizedObject[entryKey] = sanitize(entryValue, entryKey, seen);
    }
    return sanitizedObject;
  }

  return String(value);
}

function createLogEntry(event, payload = {}) {
  const summaryFields = extractSummaryFields(payload);

  return sanitize({
    timestamp: new Date().toISOString(),
    event,
    type: event,
    ...summaryFields,
    ...payload,
  });
}

function extractSummaryFields(payload) {
  return {
    name: findFirstValueByKey(payload, 'name'),
    email: findFirstValueByKey(payload, 'email'),
  };
}

function findFirstValueByKey(value, targetKey, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== 'object') {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }

  seen.add(value);

  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, targetKey)) {
    return value[targetKey];
  }

  const values = Array.isArray(value) ? value : Object.values(value);
  for (const entry of values) {
    const match = findFirstValueByKey(entry, targetKey, seen);
    if (match !== undefined) {
      return match;
    }
  }

  return undefined;
}

function createAuthorizationHeader(accountId, apiKey) {
  const credentials = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
  return `Basic ${credentials}`;
}

function createGrafanaPayload(entry, options = {}) {
  const parsedTimestamp = Date.parse(entry.timestamp);
  const timeUnixNano = Number.isFinite(parsedTimestamp)
    ? String(parsedTimestamp * 1_000_000)
    : String(Date.now() * 1_000_000);

  return {
    streams: [
      {
        stream: {
          service: options.serviceName || DEFAULT_SERVICE_NAME,
          source: options.source || DEFAULT_SERVICE_NAME,
          event: entry.event,
          level: options.level || 'info',
        },
        values: [[timeUnixNano, JSON.stringify(entry)]],
      },
    ],
  };
}

async function readResponseText(response) {
  if (typeof response.text !== 'function') {
    return '';
  }

  try {
    return await response.text();
  } catch {
    return '';
  }
}

class LoggerService {
  constructor(loggingConfig = config.logging ?? {}) {
    this.config = loggingConfig;
    this.serviceName = DEFAULT_SERVICE_NAME;

    this.httpLogger = this.httpLogger.bind(this);
  }

  httpLogger(req, res, next) {
    let responseBody;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.send = (body) => {
      if (responseBody === undefined) {
        responseBody = body;
      }
      return originalSend(body);
    };

    res.on('finish', () => {
      this.logHttpRequest({
        method: req.method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        hasAuthorizationHeader: Boolean(req.headers.authorization),
        requestBody: req.body,
        responseBody,
      });
    });

    next();
  }

  isTestEnvironment() {
    return process.env.NODE_ENV === 'test';
  }

  canSendToGrafana() {
    return Boolean(this.config.endpointUrl && this.config.accountId && this.config.apiKey) && !this.isTestEnvironment();
  }

  emit(event, payload = {}, level = 'info') {
    const entry = createLogEntry(event, payload);
    const serializedEntry = JSON.stringify(entry);

    if (level === 'error') {
      console.error(serializedEntry);
    } else {
      console.log(serializedEntry);
    }

    void this.sendToGrafana(entry, level);
  }

  async sendToGrafana(entry, level = 'info') {
    if (!this.canSendToGrafana()) {
      return;
    }

    try {
      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: createAuthorizationHeader(this.config.accountId, this.config.apiKey),
        },
        body: JSON.stringify(
          createGrafanaPayload(entry, {
            serviceName: this.serviceName,
            source: this.config.source || this.serviceName,
            level,
          })
        ),
      });

      if (!response.ok) {
        const text = await readResponseText(response);
        console.warn(`Failed to send log to Grafana: status=${response.status} body=${redactString(text)}`);
      }
    } catch (error) {
      console.warn(`Failed to send log to Grafana: ${redactString(error.message)}`);
    }
  }

  logHttpRequest(payload) {
    this.emit('http_request', payload);
  }

  logDatabaseRequest(payload) {
    this.emit('database_request', payload);
  }

  logFactoryRequest(payload) {
    this.emit('factory_request', payload);
  }

  logUnhandledException(error, req) {
    this.emit(
      'unhandled_exception',
      {
        method: req?.method,
        path: req?.originalUrl || req?.path,
        statusCode: error?.statusCode ?? 500,
        error,
      },
      'error'
    );
  }
}

const logger = new LoggerService();

module.exports = {
  LoggerService,
  createAuthorizationHeader,
  createGrafanaPayload,
  createLogEntry,
  emit: logger.emit.bind(logger),
  httpLogger: logger.httpLogger,
  logDatabaseRequest: logger.logDatabaseRequest.bind(logger),
  logFactoryRequest: logger.logFactoryRequest.bind(logger),
  logHttpRequest: logger.logHttpRequest.bind(logger),
  logUnhandledException: logger.logUnhandledException.bind(logger),
  sanitize,
};
