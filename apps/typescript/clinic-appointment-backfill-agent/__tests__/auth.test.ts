import { authMiddleware, requireAuth, AuthenticatedRequest } from '../src/middleware/auth';
import { Request, Response, NextFunction } from 'express';

describe('Authentication Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: NextFunction;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.API_AUTH_TOKEN;

    mockReq = { headers: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('authMiddleware', () => {
    it('rejects requests without Authorization header', () => {
      authMiddleware(mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('authenticates a non-empty Bearer token when API_AUTH_TOKEN is not configured', () => {
      mockReq.headers = { authorization: 'Bearer sk_live_abc123def456' };

      authMiddleware(mockReq as Request, mockRes as Response, nextFn);

      const authReq = mockReq as AuthenticatedRequest;
      expect(authReq.auth.isAuthenticated).toBe(true);
      expect(authReq.auth.apiKeyPrefix).toBe('sk_live_ab...');
      expect(authReq.auth.credentialOrigin).toBe('bearer');
      expect(nextFn).toHaveBeenCalled();
    });

    it('rejects the wrong Bearer token when API_AUTH_TOKEN is configured', () => {
      process.env.API_AUTH_TOKEN = 'expected-token';
      mockReq.headers = { authorization: 'Bearer wrong-token' };

      authMiddleware(mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(nextFn).not.toHaveBeenCalled();
    });

    it('accepts the exact Bearer token when API_AUTH_TOKEN is configured', () => {
      process.env.API_AUTH_TOKEN = 'expected-token';
      mockReq.headers = { authorization: 'Bearer expected-token' };

      authMiddleware(mockReq as Request, mockRes as Response, nextFn);

      expect((mockReq as AuthenticatedRequest).auth.isAuthenticated).toBe(true);
      expect(nextFn).toHaveBeenCalled();
    });

    it('rejects unauthenticated requests even when DEMO_MODE=true', () => {
      process.env.DEMO_MODE = 'true';

      authMiddleware(mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(nextFn).not.toHaveBeenCalled();
    });
  });

  describe('requireAuth', () => {
    it('calls next when authenticated', () => {
      (mockReq as AuthenticatedRequest).auth = { isAuthenticated: true };

      requireAuth(mockReq as Request, mockRes as Response, nextFn);

      expect(nextFn).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('returns 401 when not authenticated', () => {
      (mockReq as AuthenticatedRequest).auth = { isAuthenticated: false };

      requireAuth(mockReq as Request, mockRes as Response, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
      expect(nextFn).not.toHaveBeenCalled();
    });
  });
});
