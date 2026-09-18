const { isLoopbackAddress, localOnlyMiddleware } = require('../src/local-only');

describe('isLoopbackAddress', () => {
  test('accepts IPv4 and IPv6 loopback forms', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
  });

  test('refuses a real, non-loopback address', () => {
    expect(isLoopbackAddress('10.0.0.5')).toBe(false);
    expect(isLoopbackAddress('192.168.1.42')).toBe(false);
    expect(isLoopbackAddress('8.8.8.8')).toBe(false);
  });

  test('refuses undefined/empty input rather than defaulting to trusted', () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });
});

describe('localOnlyMiddleware', () => {
  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
  }

  test('calls next() for a loopback request and never touches the response', () => {
    const req = { socket: { remoteAddress: '127.0.0.1' } };
    const res = mockRes();
    const next = jest.fn();

    localOnlyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  test('refuses with 403 for a non-loopback request and never calls next()', () => {
    const req = { socket: { remoteAddress: '203.0.113.7' } };
    const res = mockRes();
    const next = jest.fn();

    localOnlyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/local connections/i);
  });

  test('refuses when the socket carries no remote address at all', () => {
    const req = { socket: {} };
    const res = mockRes();
    const next = jest.fn();

    localOnlyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
