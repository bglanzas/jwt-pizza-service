const request = require('supertest');

jest.mock('../database/database.js', () => {
  return {
    Role: { Diner: 'diner', Franchisee: 'franchisee', Admin: 'admin' },
    DB: {
      addMenuItem: jest.fn(),
      addDinerOrder: jest.fn(),
      getMenu: jest.fn(),
      getOrders: jest.fn(),
      isLoggedIn: jest.fn(),
    },
  };
});

jest.mock('jsonwebtoken', () => {
  return {
    sign: jest.fn(() => 'signed.jwt.token'),
    verify: jest.fn(),
  };
});

const jwt = require('jsonwebtoken');
const { DB } = require('../database/database.js');
const app = require('../service');

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

const dinerUser = { id: 7, name: 'diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] };
const adminUser = { id: 1, name: 'admin', email: 'a@jwt.com', roles: [{ role: 'admin' }] };

function mockAuth(user) {
  DB.isLoggedIn.mockResolvedValueOnce(true);
  jwt.verify.mockReturnValueOnce(user);
}

test('get menu returns menu items', async () => {
  DB.getMenu.mockResolvedValueOnce([{ id: 1, title: 'Veggie' }]);
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ id: 1, title: 'Veggie' }]);
});

test('add menu item rejects non-admin', async () => {
  mockAuth(dinerUser);
  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', 'Bearer diner.token')
    .send({ title: 'Student', description: 'Carbs', image: 'pizza.png', price: 0.01 });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to add menu item');
  expect(DB.addMenuItem).not.toHaveBeenCalled();
});

test('add menu item returns updated menu for admin', async () => {
  mockAuth(adminUser);
  DB.addMenuItem.mockResolvedValueOnce({ id: 1, title: 'Student' });
  DB.getMenu.mockResolvedValueOnce([{ id: 1, title: 'Student' }]);

  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', 'Bearer admin.token')
    .send({ title: 'Student', description: 'Carbs', image: 'pizza.png', price: 0.01 });

  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ id: 1, title: 'Student' }]);
  expect(DB.addMenuItem).toHaveBeenCalled();
});

test('get orders returns user orders', async () => {
  mockAuth(dinerUser);
  DB.getOrders.mockResolvedValueOnce({ dinerId: 7, orders: [], page: '2' });

  const res = await request(app).get('/api/order?page=2').set('Authorization', 'Bearer diner.token');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ dinerId: 7, orders: [], page: '2' });
  expect(DB.getOrders).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), '2');
});

test('create order returns factory jwt on success', async () => {
  mockAuth(dinerUser);
  DB.addDinerOrder.mockResolvedValueOnce({ id: 10, franchiseId: 1, storeId: 2, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] });
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ reportUrl: 'https://factory/report', jwt: 'factory.jwt' }),
  });

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', 'Bearer diner.token')
    .send({ franchiseId: 1, storeId: 2, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    order: { id: 10, franchiseId: 1, storeId: 2, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] },
    followLinkToEndChaos: 'https://factory/report',
    jwt: 'factory.jwt',
  });
});

test('create order returns 500 when factory fails', async () => {
  mockAuth(dinerUser);
  DB.addDinerOrder.mockResolvedValueOnce({ id: 11, franchiseId: 1, storeId: 2, items: [] });
  global.fetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ reportUrl: 'https://factory/fail' }),
  });

  const res = await request(app)
    .post('/api/order')
    .set('Authorization', 'Bearer diner.token')
    .send({ franchiseId: 1, storeId: 2, items: [] });

  expect(res.status).toBe(500);
  expect(res.body.message).toBe('Failed to fulfill order at factory');
  expect(res.body.followLinkToEndChaos).toBe('https://factory/fail');
});
