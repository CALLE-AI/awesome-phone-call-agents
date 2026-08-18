import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// ==========================================
// 1. STRICT E.164 PHONE VALIDATION & PII MASKING
// ==========================================

// Standard ITU-T E.164 format: starts with +, followed by 1-9, total 7 to 15 digits
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export function isValidE164(phone: string): boolean {
    if (!phone || typeof phone !== 'string') return false;
    return E164_REGEX.test(phone.trim());
}

export function maskPhone(phone: string): string {
    if (!phone || typeof phone !== 'string') return '';
    const clean = phone.trim();
    if (clean.length <= 4) return '****';
    if (clean.length <= 7) return `${clean.slice(0, 2)}****${clean.slice(-2)}`;
    const prefix = clean.slice(0, Math.min(4, Math.floor(clean.length / 2)));
    const suffix = clean.slice(-4);
    return `${prefix}****${suffix}`;
}

export function maskAddress(address: string): string {
    if (!address || typeof address !== 'string') return '';
    return address.trim();
}

// ==========================================
// 2. EXACT OFFICIAL CALL-E HTTPS API ORIGIN
// ==========================================

export const OFFICIAL_CALLE_API_URL = "https://api.heycall-e.com";

export function isAllowedOrigin(urlString: string): boolean {
    if (!urlString || typeof urlString !== 'string') return false;
    try {
        const url = new URL(urlString.trim());
        return (
            url.protocol === "https:" &&
            url.hostname.toLowerCase() === "api.heycall-e.com" &&
            url.username === "" &&
            url.password === "" &&
            url.search === "" &&
            url.hash === "" &&
            url.port === "" &&
            new Set(["", "/"]).has(url.pathname)
        );
    } catch {
        return false;
    }
}

export function assertTrustedBaseUrl(baseUrl: string): string {
    let url: URL;
    try {
        url = new URL(baseUrl.trim());
    } catch {
        throw new Error(`CALL-E base URL '${baseUrl}' is not a URL; CALLE_API_KEY was not sent.`);
    }

    if (
        url.protocol !== "https:" ||
        url.hostname.toLowerCase() !== "api.heycall-e.com" ||
        url.username !== "" ||
        url.password !== "" ||
        url.search !== "" ||
        url.hash !== "" ||
        url.port !== "" ||
        !new Set(["", "/"]).has(url.pathname)
    ) {
        throw new Error(
            `CALL-E base URL must be exactly ${OFFICIAL_CALLE_API_URL} with default HTTPS port. Non-standard ports, HTTP, and unofficial origins are not permitted.`
        );
    }

    return url.toString().replace(/\/$/, "");
}

// ==========================================
// 3. CRYPTOGRAPHIC SESSION COOKIE & AUTH
// ==========================================

// CALLE_API_KEY is strictly server-only for CALL-E telephony calls.
// Dashboard and API authorization strictly requires a separate application secret (API_SECRET_KEY / DISPATCH_API_KEY).
export function getExpectedApiKey(): string | null {
    const configured = process.env.API_SECRET_KEY || process.env.DISPATCH_API_KEY;
    if (configured && configured.trim()) {
        return configured.trim();
    }
    if (process.env.NODE_ENV === 'test') {
        return 'test_internal_secret_key_fixed';
    }
    return null;
}

export function createSessionCookie(secret: string): string {
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac('sha256', secret).update(timestamp).digest('hex');
    return `${timestamp}.${signature}`;
}

export function verifySessionCookie(cookieValue: string | undefined, secret: string): boolean {
    if (!cookieValue || typeof cookieValue !== 'string') return false;
    const parts = cookieValue.split('.');
    if (parts.length !== 2) return false;
    const [timestampStr, signature] = parts;
    if (!timestampStr || !signature) return false;

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;

    // Session valid for 24 hours
    const maxAgeMs = 24 * 60 * 60 * 1000;
    if (Date.now() - timestamp > maxAgeMs || timestamp > Date.now() + 60000) {
        return false;
    }

    const expectedSignature = crypto.createHmac('sha256', secret).update(timestampStr).digest('hex');
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch {
        return false;
    }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length >= 2) {
            const key = parts[0]?.trim();
            const val = parts.slice(1).join('=').trim();
            if (key) {
                cookies[key] = decodeURIComponent(val);
            }
        }
    });
    return cookies;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const expectedKey = getExpectedApiKey();
    if (!expectedKey) {
        return res.status(500).json({
            error: 'ServerConfigurationError',
            message: 'API_SECRET_KEY must be configured in server environment before handling API requests.'
        });
    }

    // 1. Check direct headers
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];

    let providedKey = '';
    if (apiKeyHeader && typeof apiKeyHeader === 'string') {
        providedKey = apiKeyHeader.trim();
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.slice(7).trim();
    }

    if (providedKey && providedKey === expectedKey) {
        return next();
    }

    // 2. Check cryptographically signed HMAC session cookie
    const cookies = parseCookies(req.headers['cookie']);
    const sessionCookie = cookies['dp_session'];
    if (sessionCookie && verifySessionCookie(sessionCookie, expectedKey)) {
        return next();
    }

    return res.status(401).json({
        error: 'Unauthorized',
        message: 'A valid API key or signed session cookie is required to access DispatchPulse endpoints.'
    });
}

// ==========================================
// 4. HTML / XSS SANITIZATION
// ==========================================

export function escapeHtml(unsafe: string): string {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
