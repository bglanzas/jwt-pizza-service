const request = require('supertest');

jest.mock('../database/database.js', () => {
  return {
    Role: { Diner: 'diner', Franchisee: 'franchisee', Admin: 'admin' },
    DB: {
      addUser: jest.fn(),
      getUser: jest.fn(),
      loginUser: jest.fn(),
      logoutUser: jest.fn(),
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

const baseUser = { id: 12, name: 'pizza diner', email: 'reg@test.com', roles: [{ role: 'diner' }] };

beforeEach(() => {
  jest.clearAllMocks();
});

test('register rejects missing fields', async () => {
  const res = await request(app).post('/api/auth').send({ name: 'n' });
  expect(res.status).toBe(400);
  expect(res.body.message).toBe('name, email, and password are required');
});

test('register returns user and token', async () => {
  DB.addUser.mockResolvedValueOnce(baseUser);
  const res = await request(app).post('/api/auth').send({ name: 'pizza diner', email: 'reg@test.com', password: 'a' });

  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject(baseUser);
  expect(res.body.token).toBe('signed.jwt.token');
  expect(DB.addUser).toHaveBeenCalled();
  expect(DB.loginUser).toHaveBeenCalledWith(baseUser.id, 'signed.jwt.token');
});

test('login returns user and token', async () => {
  DB.getUser.mockResolvedValueOnce(baseUser);
  const res = await request(app).put('/api/auth').send({ email: 'reg@test.com', password: 'a' });

  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject(baseUser);
  expect(res.body.token).toBe('signed.jwt.token');
  expect(DB.getUser).toHaveBeenCalledWith('reg@test.com', 'a');
  expect(DB.loginUser).toHaveBeenCalledWith(baseUser.id, 'signed.jwt.token');
});

test('logout clears auth token', async () => {
  DB.isLoggedIn.mockResolvedValueOnce(true);
  jwt.verify.mockReturnValueOnce(baseUser);

  const res = await request(app).delete('/api/auth').set('Authorization', 'Bearer test.token.value');
  expect(res.status).toBe(200);
  expect(res.body.message).toBe('logout successful');
  expect(DB.logoutUser).toHaveBeenCalledWith('test.token.value');
});
