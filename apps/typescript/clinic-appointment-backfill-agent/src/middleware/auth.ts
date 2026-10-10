/**
 * Authentication & Authorization middleware
 *
 * Patient-record and call-control API routes must not have a live demo-auth
 * bypass. A non-empty Bearer token is required on every API request. When
 * API_AUTH_TOKEN is configured, the token must match it exactly.
 */

import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  auth: {
    isAuthenticated: boolean;
    apiKeyPrefix?: string;
    credentialOrigin?: 'bearer';
  };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const expectedToken = process.env.API_AUTH_TOKEN?.trim();

  const authReq = req as AuthenticatedRequest;
  authReq.auth = {
    isAuthenticated: false,
  };

  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch || !bearerMatch[1]?.trim()) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authorization header with Bearer token required.',
    });
    return;
  }

  const token = bearerMatch[1].trim();
  if (expectedToken && token !== expectedToken) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'A valid Bearer token is required.',
    });
    return;
  }

  authReq.auth.apiKeyPrefix = token.substring(0, 10) + '...';
  authReq.auth.isAuthenticated = true;
  authReq.auth.credentialOrigin = 'bearer';

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;

  if (!authReq.auth?.isAuthenticated) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'This endpoint requires authentication.',
    });
    return;
  }

  next();
}
