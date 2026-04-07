const { LoggerService, createAuthorizationHeader, createGrafanaPayload, createLogEntry, sanitize } = require('./logger.js');

test('sanitize redacts confidential fields and string content', () => {
  const result = sanitize({
    email: 'user@example.com',
    password: 'super-secret',
    token: 'signed.jwt.token',
    nested: {
      jwt: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      text: 'Bearer abc.def.ghi user@example.com',
    },
  });

  expect(result).toEqual({
    email: '[REDACTED_EMAIL]',
    password: '[REDACTED]',
    token: '[REDACTED]',
    nested: {
      jwt: '[REDACTED]',
      text: 'Bearer [REDACTED] [REDACTED_EMAIL]',
    },
  });
});

test('createLogEntry sanitizes errors in emitted payloads', () => {
  const entry = createLogEntry('unhandled_exception', {
    error: new Error('failed for user@example.com'),
  });

  expect(entry.event).toBe('unhandled_exception');
  expect(entry.type).toBe('unhandled_exception');
  expect(entry.error.message).toBe('failed for [REDACTED_EMAIL]');
  expect(entry.error.stack).toContain('[REDACTED_EMAIL]');
});

test('createLogEntry promotes name and email to top-level fields', () => {
  const entry = createLogEntry('http_request', {
    requestBody: {
      diner: {
        name: 'pizza eater',
        email: 'diner@example.com',
      },
    },
  });

  expect(entry.type).toBe('http_request');
  expect(entry.name).toBe('pizza eater');
  expect(entry.email).toBe('[REDACTED_EMAIL]');
});

test('createAuthorizationHeader uses basic auth for Grafana', () => {
  expect(createAuthorizationHeader('12345', 'glc_test_key')).toBe(`Basic ${Buffer.from('12345:glc_test_key').toString('base64')}`);
});

test('createGrafanaPayload builds a loki stream payload', () => {
  const entry = createLogEntry('http_request', { method: 'GET', path: '/' });
  const payload = createGrafanaPayload(entry, { source: 'jwt-pizza-service-dev', serviceName: 'jwt-pizza-service', level: 'info' });

  expect(payload).toEqual({
    streams: [
      {
        stream: {
          service: 'jwt-pizza-service',
          source: 'jwt-pizza-service-dev',
          event: 'http_request',
          level: 'info',
        },
        values: [[expect.any(String), JSON.stringify(entry)]],
      },
    ],
  });
});

test('httpLogger records protocol host and full request url', () => {
  const logger = new LoggerService({});
  const logHttpRequest = jest.spyOn(logger, 'logHttpRequest').mockImplementation(() => {});
  const req = {
    method: 'GET',
    originalUrl: '/api/order/menu?page=1',
    path: '/api/order/menu',
    protocol: 'http',
    headers: {
      host: 'localhost:3000',
      'x-forwarded-proto': 'https',
    },
    body: undefined,
    get: jest.fn((header) => req.headers[header]),
  };
  const finishHandlers = [];
  const res = {
    statusCode: 200,
    json: jest.fn((body) => body),
    send: jest.fn((body) => body),
    on: jest.fn((event, handler) => {
      if (event === 'finish') {
        finishHandlers.push(handler);
      }
    }),
  };
  const next = jest.fn();

  logger.httpLogger(req, res, next);
  res.json({ ok: true });
  finishHandlers[0]();

  expect(next).toHaveBeenCalled();
  expect(logHttpRequest).toHaveBeenCalledWith({
    method: 'GET',
    protocol: 'https',
    host: 'localhost:3000',
    path: '/api/order/menu?page=1',
    url: 'https://localhost:3000/api/order/menu?page=1',
    statusCode: 200,
    hasAuthorizationHeader: false,
    requestBody: undefined,
    responseBody: { ok: true },
  });
});
