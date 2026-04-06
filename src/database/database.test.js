jest.mock('mysql2/promise', () => ({}));
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
jest.mock('../config.js', () => ({
  db: {
    connection: {
      host: '127.0.0.1',
      user: 'root',
      password: 'test',
      database: 'pizza',
      connectTimeout: 60000,
    },
    listPerPage: 10,
  },
}));
jest.mock('../logger.js', () => ({
  emit: jest.fn(),
  logDatabaseRequest: jest.fn(),
}));

const { DBClass } = require('./database.js');

describe('DB.loginUser', () => {
  test('replaces existing auth rows for the user before inserting the new token', async () => {
    const db = Object.create(DBClass.prototype);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      end: jest.fn(),
    };

    db.getTokenSignature = jest.fn(() => 'token-signature');
    db.getConnection = jest.fn().mockResolvedValue(connection);
    db.query = jest.fn().mockResolvedValue({});

    await db.loginUser(42, 'raw.token.value');

    expect(db.getTokenSignature).toHaveBeenCalledWith('raw.token.value');
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenNthCalledWith(1, connection, 'DELETE FROM auth WHERE userId=?', [42]);
    expect(db.query).toHaveBeenNthCalledWith(2, connection, 'INSERT INTO auth (token, userId) VALUES (?, ?)', ['token-signature', 42]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
});

describe('DB.invalidateAllSessions', () => {
  test('deletes every auth row', async () => {
    const db = Object.create(DBClass.prototype);
    const connection = {
      end: jest.fn(),
    };

    db.getConnection = jest.fn().mockResolvedValue(connection);
    db.query = jest.fn().mockResolvedValue({});

    await db.invalidateAllSessions();

    expect(db.query).toHaveBeenCalledWith(connection, 'DELETE FROM auth');
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
});
