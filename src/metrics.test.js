const { MetricsService } = require('./metrics.js');

describe('MetricsService active_users', () => {
  test('counts distinct authenticated and guest visitors active in the rolling window', () => {
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
        headers: { 'user-agent': 'browser-b' },
        ip: '10.0.0.2',
      },
      now + 1_000
    );

    metrics.trackActiveUser(
      {
        headers: { 'user-agent': 'browser-b' },
        ip: '10.0.0.2',
      },
      now + 2_000
    );

    expect(metrics.getActiveUserCount(now + 2_000)).toBe(2);
  });

  test('expires visitors after five minutes of inactivity', () => {
    const metrics = new MetricsService();
    const now = 1_000_000;

    metrics.trackActiveUser(
      {
        headers: { 'user-agent': 'browser-a' },
        ip: '10.0.0.1',
      },
      now
    );

    expect(metrics.getActiveUserCount(now + 5 * 60 * 1000 - 1)).toBe(1);
    expect(metrics.getActiveUserCount(now + 5 * 60 * 1000 + 1)).toBe(0);
  });
});
