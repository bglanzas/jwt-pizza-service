const { createAuthorizationHeader, createGrafanaPayload, createLogEntry, sanitize } = require('./logger.js');

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
  expect(entry.error.message).toBe('failed for [REDACTED_EMAIL]');
  expect(entry.error.stack).toContain('[REDACTED_EMAIL]');
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
