const request = require('supertest');

jest.mock('../database/database.js', () => {
  return {
    Role: { Diner: 'diner', Franchisee: 'franchisee', Admin: 'admin' },
    DB: {
      isLoggedIn: jest.fn(),
      updateUser: jest.fn(),
      loginUser: jest.fn(),
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

const dinerUser = { id: 7, name: 'diner', email: 'd@jwt.com', roles: [{ role: 'diner' }] };
const adminUser = { id: 1, name: 'admin', email: 'a@jwt.com', roles: [{ role: 'admin' }] };

function mockAuth(user) {
  DB.isLoggedIn.mockResolvedValueOnce(true);
  jwt.verify.mockReturnValueOnce(user);
}

test('get /api/user/me returns authenticated user', async () => {
  mockAuth(dinerUser);
  const res = await request(app).get('/api/user/me').set('Authorization', 'Bearer diner.token');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject(dinerUser);
});

test('update user rejects non-owner non-admin', async () => {
  mockAuth(dinerUser);
  const res = await request(app)
    .put('/api/user/99')
    .set('Authorization', 'Bearer diner.token')
    .send({ name: 'new' });
  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unauthorized');
  expect(DB.updateUser).not.toHaveBeenCalled();
});

test('update user returns updated user and token', async () => {
  mockAuth(adminUser);
  const updatedUser = { id: 2, name: 'new', email: 'new@jwt.com', roles: [{ role: 'diner' }] };
  DB.updateUser.mockResolvedValueOnce(updatedUser);

  const res = await request(app)
    .put('/api/user/2')
    .set('Authorization', 'Bearer admin.token')
    .send({ name: 'new', email: 'new@jwt.com', password: 'pw' });

  expect(res.status).toBe(200);
  expect(res.body.user).toEqual(updatedUser);
  expect(res.body.token).toBe('signed.jwt.token');
  expect(DB.updateUser).toHaveBeenCalledWith(2, 'new', 'new@jwt.com', 'pw');
  expect(DB.loginUser).toHaveBeenCalledWith(2, 'signed.jwt.token');
});

test('delete user returns not implemented message', async () => {
  mockAuth(adminUser);
  const res = await request(app).delete('/api/user/2').set('Authorization', 'Bearer admin.token');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('not implemented');
});

test('list users returns not implemented payload', async () => {
  mockAuth(adminUser);
  const res = await request(app).get('/api/user').set('Authorization', 'Bearer admin.token');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'not implemented', users: [], more: false });
});
