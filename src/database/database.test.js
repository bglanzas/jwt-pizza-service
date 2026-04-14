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

describe('DB.addDinerOrder', () => {
  test('persists menu pricing from the database instead of the request body', async () => {
    const db = Object.create(DBClass.prototype);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      end: jest.fn(),
    };

    db.getConnection = jest.fn().mockResolvedValue(connection);
    db.getMenuItem = jest.fn().mockResolvedValue({ id: 3, description: 'A garden of delight', price: 12.99 });
    db.query = jest
      .fn()
      .mockResolvedValueOnce({ insertId: 77 })
      .mockResolvedValueOnce({});

    const order = await db.addDinerOrder(
      { id: 4 },
      {
        franchiseId: 1,
        storeId: 2,
        items: [{ menuId: 3, description: 'tampered', price: -500 }],
      }
    );

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(db.getMenuItem).toHaveBeenCalledWith(connection, 3);
    expect(db.query).toHaveBeenNthCalledWith(
      1,
      connection,
      'INSERT INTO dinerOrder (dinerId, franchiseId, storeId, date) VALUES (?, ?, ?, now())',
      [4, 1, 2]
    );
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      connection,
      'INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)',
      [77, 3, 'A garden of delight', 12.99]
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(order).toEqual({
      franchiseId: 1,
      storeId: 2,
      items: [{ menuId: 3, description: 'A garden of delight', price: 12.99 }],
      id: 77,
    });
  });

  test('rejects empty orders before creating rows', async () => {
    const db = Object.create(DBClass.prototype);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      end: jest.fn(),
    };

    db.getConnection = jest.fn().mockResolvedValue(connection);
    db.query = jest.fn();

    await expect(
      db.addDinerOrder(
        { id: 4 },
        {
          franchiseId: 1,
          storeId: 2,
          items: [],
        }
      )
    ).rejects.toMatchObject({ message: 'order must include at least one item', statusCode: 400 });

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
});
