import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// The documented example value from .env.example. Fine for a purely local
// dry-run demo; must never guard a deployment that can dial real customers
// or be reached from outside this machine.
const KNOWN_FALLBACK_KEYS = new Set(['changeme_dev_only']);

function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const normalized = ip.replace('::ffff:', '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const rawProvided = req.headers['x-api-key'];
    const provided = (Array.isArray(rawProvided) ? rawProvided[0] : rawProvided)?.trim();
    const expected = this.config.get<string>('DASHBOARD_API_KEY')?.trim();
    const mode = this.config.get<string>('CALLE_MODE', 'dry_run');
    const requestIp: string | undefined = req.ip ?? req.socket?.remoteAddress;

    if (!expected) {
      throw new UnauthorizedException('Server misconfigured: DASHBOARD_API_KEY not set.');
    }

    if (KNOWN_FALLBACK_KEYS.has(expected) && (mode === 'live' || !isLoopbackAddress(requestIp))) {
      throw new UnauthorizedException(
        'DASHBOARD_API_KEY is still set to the documented example value. ' +
          'Set a real, unique secret before running in live mode or accepting non-local requests.',
      );
    }

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing X-API-Key header.');
    }
    return true;
  }
}