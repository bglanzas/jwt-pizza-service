const { asyncHandler, StatusCodeError } = require('./endpointHelper');

test('StatusCodeError sets message and statusCode', () => {
  const err = new StatusCodeError('nope', 418);
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toBe('nope');
  expect(err.statusCode).toBe(418);
});

test('asyncHandler forwards errors to next', async () => {
  const err = new Error('boom');
  const next = jest.fn();
  const handler = asyncHandler(async () => {
    throw err;
  });

  await handler({}, {}, next);
  expect(next).toHaveBeenCalledWith(err);
});
