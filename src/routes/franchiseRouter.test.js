const request = require('supertest');

jest.mock('../database/database.js', () => {
  return {
    Role: { Diner: 'diner', Franchisee: 'franchisee', Admin: 'admin' },
    DB: {
      createFranchise: jest.fn(),
      createStore: jest.fn(),
      deleteFranchise: jest.fn(),
      deleteStore: jest.fn(),
      getFranchise: jest.fn(),
      getFranchises: jest.fn(),
      getUserFranchises: jest.fn(),
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

const adminUser = { id: 1, name: 'admin', email: 'a@jwt.com', roles: [{ role: 'admin' }] };
const franchiseeUser = { id: 4, name: 'franchisee', email: 'f@jwt.com', roles: [{ role: 'franchisee' }] };

function mockAuth(user) {
  DB.isLoggedIn.mockResolvedValueOnce(true);
  jwt.verify.mockReturnValueOnce(user);
}

test('list franchises returns franchises and more flag', async () => {
  DB.getFranchises.mockResolvedValueOnce([[{ id: 1, name: 'pizzaPocket' }], true]);
  const res = await request(app).get('/api/franchise');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ franchises: [{ id: 1, name: 'pizzaPocket' }], more: true });
});

test('get user franchises returns empty array for unauthorized user', async () => {
  mockAuth(franchiseeUser);
  const res = await request(app).get('/api/franchise/999').set('Authorization', 'Bearer user.token');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
  expect(DB.getUserFranchises).not.toHaveBeenCalled();
});

test('get user franchises returns franchises for same user', async () => {
  mockAuth(franchiseeUser);
  DB.getUserFranchises.mockResolvedValueOnce([{ id: 2, name: 'slice' }]);
  const res = await request(app).get('/api/franchise/4').set('Authorization', 'Bearer user.token');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([{ id: 2, name: 'slice' }]);
  expect(DB.getUserFranchises).toHaveBeenCalledWith(4);
});

test('create franchise rejects non-admin', async () => {
  mockAuth(franchiseeUser);
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', 'Bearer user.token')
    .send({ name: 'pizzaPocket', admins: [{ email: 'f@jwt.com' }] });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a franchise');
  expect(DB.createFranchise).not.toHaveBeenCalled();
});

test('create franchise succeeds for admin', async () => {
  mockAuth(adminUser);
  DB.createFranchise.mockResolvedValueOnce({ id: 1, name: 'pizzaPocket' });
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', 'Bearer admin.token')
    .send({ name: 'pizzaPocket', admins: [{ email: 'f@jwt.com' }] });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: 1, name: 'pizzaPocket' });
});

test('delete franchise rejects non-admin users', async () => {
  mockAuth(franchiseeUser);
  const res = await request(app).delete('/api/franchise/5').set('Authorization', 'Bearer user.token');

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to delete a franchise');
  expect(DB.deleteFranchise).not.toHaveBeenCalled();
});

test('delete franchise calls db and returns message for admin', async () => {
  mockAuth(adminUser);
  DB.deleteFranchise.mockResolvedValueOnce();
  const res = await request(app).delete('/api/franchise/5').set('Authorization', 'Bearer admin.token');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('franchise deleted');
  expect(DB.deleteFranchise).toHaveBeenCalledWith(5);
});

test('create store rejects non-admin and non-owner', async () => {
  mockAuth(franchiseeUser);
  DB.getFranchise.mockResolvedValueOnce({ id: 1, admins: [{ id: 9 }] });
  const res = await request(app)
    .post('/api/franchise/1/store')
    .set('Authorization', 'Bearer user.token')
    .send({ name: 'SLC' });

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a store');
  expect(DB.createStore).not.toHaveBeenCalled();
});

test('create store succeeds for franchise admin', async () => {
  mockAuth(franchiseeUser);
  DB.getFranchise.mockResolvedValueOnce({ id: 1, admins: [{ id: 4 }] });
  DB.createStore.mockResolvedValueOnce({ id: 3, name: 'SLC', totalRevenue: 0 });

  const res = await request(app)
    .post('/api/franchise/1/store')
    .set('Authorization', 'Bearer user.token')
    .send({ name: 'SLC' });

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: 3, name: 'SLC', totalRevenue: 0 });
});

test('delete store rejects non-admin and non-owner', async () => {
  mockAuth(franchiseeUser);
  DB.getFranchise.mockResolvedValueOnce({ id: 1, admins: [{ id: 9 }] });
  const res = await request(app).delete('/api/franchise/1/store/5').set('Authorization', 'Bearer user.token');

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to delete a store');
  expect(DB.deleteStore).not.toHaveBeenCalled();
});

test('delete store succeeds for admin', async () => {
  mockAuth(adminUser);
  DB.getFranchise.mockResolvedValueOnce({ id: 1, admins: [] });
  DB.deleteStore.mockResolvedValueOnce();

  const res = await request(app).delete('/api/franchise/1/store/5').set('Authorization', 'Bearer admin.token');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('store deleted');
  expect(DB.deleteStore).toHaveBeenCalledWith(1, 5);
});
