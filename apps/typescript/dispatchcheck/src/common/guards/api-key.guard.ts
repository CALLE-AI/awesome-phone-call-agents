import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const rawProvided = req.headers['x-api-key'];
    const provided = (Array.isArray(rawProvided) ? rawProvided[0] : rawProvided)?.trim();
    const expected = this.config.get<string>('DASHBOARD_API_KEY')?.trim();

    if (!expected) {
      throw new UnauthorizedException('Server misconfigured: DASHBOARD_API_KEY not set.');
    }
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing X-API-Key header.');
    }
    return true;
  }
}