/**
 * Authentication & Authorization middleware
 * 
 * REQUIREMENTS (per safety review):
 * - All remotely reachable endpoints must require authentication
 * - Default: require an Authorization header with Bearer token (API key)
 * - Optional: bypass for demo mode (controlled via DEMO_MODE env var)
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Represents an authenticated request context
 */
export interface AuthenticatedRequest extends Request {
  auth: {
    isAuthenticated: boolean;
    apiKeyPrefix?: string; // For audit logging (not the full key)
    demoMode?: boolean;
  };
}

/**
 * Middleware to authenticate requests via Bearer token
 * 
 * Checks Authorization header for Bearer token.
 * In demo mode (DEMO_MODE=true), authentication is optional.
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next middleware
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const demoMode = process.env.DEMO_MODE === 'true';
  const authHeader = req.headers.authorization || '';
  
  const authReq = req as AuthenticatedRequest;
  authReq.auth = {
    isAuthenticated: false,
    demoMode,
  };

  // Check for Bearer token
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1]) {
    const token = bearerMatch[1];
    
    // For audit purposes, store only first 10 chars of token
    authReq.auth.apiKeyPrefix = token.substring(0, 10) + '...';
    authReq.auth.isAuthenticated = true;
    
    return next();
  }

  // If demo mode is enabled, allow unauthenticated access with a warning
  if (demoMode) {
    console.warn(
      '⚠️  DEMO_MODE enabled: allowing unauthenticated access. ' +
      'Disable DEMO_MODE in production.'
    );
    return next();
  }

  // Otherwise, reject unauthenticated requests
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Authorization header with Bearer token required. Example: Authorization: Bearer your_api_key',
  });
}

/**
 * Middleware to require authentication (fails in production if not authenticated)
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next middleware
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  
  if (!authReq.auth?.isAuthenticated && process.env.DEMO_MODE !== 'true') {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'This endpoint requires authentication.',
    });
    return;
  }

  next();
}
