const request = require('supertest');

jest.mock('../database/database.js', () => {
  return {
    Role: { Diner: 'diner', Franchisee: 'franchisee', Admin: 'admin' },
    DB: {
      addMenuItem: jest.fn(),
      getMenu: jest.fn(),
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
});

test('root endpoint returns welcome message', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('welcome to JWT Pizza');
  expect(res.body.version).toBeDefined();
});

test('docs endpoint returns config and endpoints', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.version).toBeDefined();
  expect(Array.isArray(res.body.endpoints)).toBe(true);
  expect(res.body.config).toEqual(expect.objectContaining({ factory: expect.any(String), db: expect.any(String) }));
});

test('unknown endpoint returns 404', async () => {
  const res = await request(app).get('/nope');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});

test('error handler returns statusCode from thrown error', async () => {
  DB.isLoggedIn.mockResolvedValueOnce(true);
  jwt.verify.mockReturnValueOnce({ id: 7, name: 'diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] });

  const res = await request(app)
    .put('/api/order/menu')
    .set('Authorization', 'Bearer admin.nope.token')
    .send({ title: 'A', description: 'B', image: 'pizza.png', price: 0.1 });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to add menu item');
});
