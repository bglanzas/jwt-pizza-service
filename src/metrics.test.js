jest.mock('./database/database.js', () => ({
  DB: {
    getActiveUserCount: jest.fn(),
  },
}));

const { DB } = require('./database/database.js');
const { MetricsService } = require('./metrics.js');

describe('MetricsService active_users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reads the active user count from the shared auth store', async () => {
    const metrics = new MetricsService();
    DB.getActiveUserCount.mockResolvedValueOnce(1);

    const metric = await metrics.makeActiveUsersGauge('123');

    expect(DB.getActiveUserCount).toHaveBeenCalledTimes(1);
    expect(metric).toEqual(
      expect.objectContaining({
        name: 'active_users',
        unit: undefined,
      })
    );
    expect(metric.gauge.dataPoints[0]).toEqual(
      expect.objectContaining({
        asDouble: 1,
        timeUnixNano: '123',
      })
    );
  });

  test('returns null when active user collection fails', async () => {
    const metrics = new MetricsService();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    DB.getActiveUserCount.mockRejectedValueOnce(new Error('db down'));

    const metric = await metrics.makeActiveUsersGauge('123');

    expect(metric).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  test('exports active_users without a unit suffix trigger', async () => {
    const metrics = new MetricsService();
    DB.getActiveUserCount.mockResolvedValueOnce(2);
    const metric = await metrics.makeActiveUsersGauge('123');

    expect(metric.name).toBe('active_users');
    expect(metric.unit).toBeUndefined();
  });
});
