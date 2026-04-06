const { MetricsService } = require('./metrics.js');

describe('MetricsService active_users', () => {
  test('counts distinct authenticated users active in the rolling window', () => {
    const metrics = new MetricsService();
    const now = 1_000_000;

    metrics.trackActiveUser(
      {
        user: { id: 42 },
        headers: { 'user-agent': 'browser-a' },
        ip: '10.0.0.1',
      },
      now
    );

    metrics.trackActiveUser(
      {
        user: { id: 42 },
        headers: { 'user-agent': 'browser-b' },
        ip: '10.0.0.9',
      },
      now + 1_000
    );

    metrics.trackActiveUser(
      {
        user: { id: 7 },
        headers: { 'user-agent': 'browser-c' },
        ip: '10.0.0.2',
      },
      now + 2_000
    );

    expect(metrics.getActiveUserCount(now + 2_000)).toBe(2);
  });

  test('ignores unauthenticated requests', () => {
    const metrics = new MetricsService();
    const now = 1_000_000;

    metrics.trackActiveUser(
      {
        headers: { 'user-agent': 'browser-a' },
        ip: '10.0.0.1',
      },
      now
    );

    expect(metrics.getActiveUserCount(now)).toBe(0);
  });

  test('expires users after five minutes of inactivity', () => {
    const metrics = new MetricsService();
    const now = 1_000_000;

    metrics.trackActiveUser(
      {
        user: { id: 42 },
        headers: { 'user-agent': 'browser-a' },
        ip: '10.0.0.1',
      },
      now
    );

    expect(metrics.getActiveUserCount(now + 5 * 60 * 1000 - 1)).toBe(1);
    expect(metrics.getActiveUserCount(now + 5 * 60 * 1000 + 1)).toBe(0);
  });

  test('removes a user immediately when they log out', () => {
    const metrics = new MetricsService();

    metrics.markUserActive(42);
    expect(metrics.getActiveUserCount()).toBe(1);

    metrics.markUserInactive(42);
    expect(metrics.getActiveUserCount()).toBe(0);
  });

  test('exports active_users without a unit suffix trigger', () => {
    const metrics = new MetricsService();
    const metric = metrics.makeActiveUsersGauge('123');

    expect(metric.name).toBe('active_users');
    expect(metric.unit).toBeUndefined();
  });
});
