import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    isValidE164,
    maskPhone,
    isAllowedOrigin,
    assertTrustedBaseUrl,
    escapeHtml,
    getExpectedApiKey,
    createSessionCookie,
    verifySessionCookie,
    OFFICIAL_CALLE_API_URL
} from '../src/security.js';
import { idempotencyManager } from '../src/idempotency.js';

describe('Security & Validation: E.164 Phone Formatting', () => {
    test('accepts valid standards-reserved E.164 phone numbers', () => {
        assert.equal(isValidE164('+15555550100'), true);
        assert.equal(isValidE164('+15555550101'), true);
        assert.equal(isValidE164('+15555550102'), true);
        assert.equal(isValidE164('+15555550103'), true);
        assert.equal(isValidE164('+15555550199'), true);
    });

    test('rejects non-E.164 or malformed phone strings', () => {
        assert.equal(isValidE164('15555550100'), false, 'Missing leading +');
        assert.equal(isValidE164('+05555550100'), false, 'Country code cannot start with 0');
        assert.equal(isValidE164('+1555'), false, 'Too short (min 7 digits)');
        assert.equal(isValidE164('+15555550100123456'), false, 'Too long (max 15 digits)');
        assert.equal(isValidE164('+1 555 555 0100'), false, 'Cannot contain whitespace');
        assert.equal(isValidE164('<script>alert(1)</script>'), false, 'Injection string rejected');
        assert.equal(isValidE164(''), false);
        assert.equal(isValidE164(null as any), false);
        assert.equal(isValidE164(undefined as any), false);
    });
});

describe('Security & Privacy: PII Phone Masking', () => {
    test('masks phone numbers keeping prefix and last 4 digits', () => {
        assert.equal(maskPhone('+15555550100'), '+155****0100');
        assert.equal(maskPhone('+15555550199'), '+155****0199');
    });

    test('masks invalid, short, and malformed phone strings safely', () => {
        assert.equal(maskPhone('5550100'), '55****00');
        assert.equal(maskPhone('15555550199'), '1555****0199');
        assert.equal(maskPhone('+155500'), '+1****00');
        assert.equal(maskPhone('1234'), '****');
        assert.equal(maskPhone('123'), '****');
        assert.equal(maskPhone(''), '');
        assert.equal(maskPhone(null as any), '');
    });
});

describe('Security & SSRF: Exact Official CALL-E API HTTPS Origin', () => {
    test('permits exact approved official CALL-E HTTPS origin only', () => {
        assert.equal(isAllowedOrigin(OFFICIAL_CALLE_API_URL), true);
        assert.equal(isAllowedOrigin('https://api.heycall-e.com'), true);
        assert.equal(isAllowedOrigin('https://api.heycall-e.com/'), true);
        assert.equal(assertTrustedBaseUrl(OFFICIAL_CALLE_API_URL), OFFICIAL_CALLE_API_URL);
    });

    test('blocks non-default ports on official hostname', () => {
        assert.equal(isAllowedOrigin('https://api.heycall-e.com:8443'), false, 'Port 8443 rejected');
        assert.equal(isAllowedOrigin('https://api.heycall-e.com:8080'), false, 'Port 8080 rejected');
        assert.equal(isAllowedOrigin('https://api.heycall-e.com:3000'), false, 'Port 3000 rejected');
        assert.equal(isAllowedOrigin('https://api.heycall-e.com:80'), false, 'HTTP port 80 rejected');
        assert.throws(() => assertTrustedBaseUrl('https://api.heycall-e.com:8443'));
        assert.throws(() => assertTrustedBaseUrl('https://api.heycall-e.com:8080'));
    });

    test('blocks subpaths, query parameters, credentials, and hash on base URL', () => {
        assert.equal(isAllowedOrigin('https://api.heycall-e.com/v1/calls'), false);
        assert.equal(isAllowedOrigin('https://api.heycall-e.com?query=1'), false);
        assert.equal(isAllowedOrigin('https://api.heycall-e.com#fragment'), false);
        assert.equal(isAllowedOrigin('https://user:pass@api.heycall-e.com'), false);
        assert.throws(() => assertTrustedBaseUrl('https://api.heycall-e.com/v1'));
        assert.throws(() => assertTrustedBaseUrl('https://user:pass@api.heycall-e.com'));
    });

    test('blocks plaintext HTTP loopback, unofficial domains, MCP endpoints, and SSRF targets', () => {
        assert.equal(isAllowedOrigin('http://localhost:3000'), false, 'Plaintext loopback rejected');
        assert.equal(isAllowedOrigin('http://127.0.0.1:8080'), false, 'Plaintext IPv4 loopback rejected');
        assert.equal(isAllowedOrigin('http://[::1]:8080'), false, 'Plaintext IPv6 loopback rejected');
        assert.equal(isAllowedOrigin('https://seleven-mcp-sg.airudder.com'), false, 'MCP origin rejected for SDK API');
        assert.equal(isAllowedOrigin('https://untrusted.heycall-e.com'), false, 'Wildcard subdomain rejected');
        assert.equal(isAllowedOrigin('https://evil-call-e.com'), false, 'Lookalike domain rejected');
        assert.equal(isAllowedOrigin('http://attacker.com'), false);
        assert.equal(isAllowedOrigin('https://malicious-webhook.site/log'), false);
        assert.equal(isAllowedOrigin('http://169.254.169.254/latest/meta-data'), false);
        assert.equal(isAllowedOrigin('javascript:alert(1)'), false);
        assert.equal(isAllowedOrigin('file:///etc/passwd'), false);
        assert.equal(isAllowedOrigin(''), false);
        assert.equal(isAllowedOrigin(null as any), false);
        assert.throws(() => assertTrustedBaseUrl('http://localhost:3000'));
        assert.throws(() => assertTrustedBaseUrl('http://127.0.0.1:8080'));
        assert.throws(() => assertTrustedBaseUrl('http://attacker.com'));
    });
});

describe('Security & Cryptography: HMAC Signed Session Cookies & Key Separation', () => {
    const testSecret = 'super_secret_test_key_12345';

    test('generates valid HMAC session token verifiable with secret', () => {
        const cookie = createSessionCookie(testSecret);
        assert.ok(cookie && cookie.includes('.'));
        assert.equal(verifySessionCookie(cookie, testSecret), true);
    });

    test('rejects forged static unsigned cookie', () => {
        assert.equal(verifySessionCookie('authenticated', testSecret), false);
        assert.equal(verifySessionCookie('dp_session=authenticated', testSecret), false);
        assert.equal(verifySessionCookie('true', testSecret), false);
    });

    test('rejects tampered signature or mismatched secret', () => {
        const validCookie = createSessionCookie(testSecret);
        const [timestamp] = validCookie.split('.');
        const forgedCookie = `${timestamp}.0000000000000000000000000000000000000000000000000000000000000000`;

        assert.equal(verifySessionCookie(forgedCookie, testSecret), false);
        assert.equal(verifySessionCookie(validCookie, 'wrong_secret_key'), false);
    });

    test('handles empty or malformed cookie input safely', () => {
        assert.equal(verifySessionCookie('', testSecret), false);
        assert.equal(verifySessionCookie(null as any, testSecret), false);
        assert.equal(verifySessionCookie(undefined as any, testSecret), false);
        assert.equal(verifySessionCookie('malformed.value.with.extra.parts', testSecret), false);
    });
});

describe('Security & XSS: HTML Entity Sanitizer', () => {
    test('escapes HTML tags and dangerous characters', () => {
        const raw = '<script>alert("XSS")</script>';
        const clean = escapeHtml(raw);
        assert.equal(clean, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    test('escapes attributes, single quotes, and ampersands', () => {
        assert.equal(escapeHtml('<img src=x onerror=\'alert(1)\'>'), '&lt;img src=x onerror=&#039;alert(1)&#039;&gt;');
        assert.equal(escapeHtml('Tom & Jerry "Special"'), 'Tom &amp; Jerry &quot;Special&quot;');
    });

    test('handles null and undefined safely', () => {
        assert.equal(escapeHtml(null as any), '');
        assert.equal(escapeHtml(undefined as any), '');
    });
});

describe('Reliability: Idempotency and In-Flight Locks', () => {
    test('prevents duplicate concurrent dispatches for the same order regardless of caller headers', () => {
        idempotencyManager.reset();

        const lock1 = idempotencyManager.acquireLock('ORD-TEST-1');
        assert.equal(lock1.success, true);

        // Immediate duplicate attempt on same order must be rejected
        const lock2 = idempotencyManager.acquireLock('ORD-TEST-1');
        assert.equal(lock2.success, false);
        assert.match(lock2.reason || '', /currently in progress/);

        // Case-insensitive order ID binding
        const lock3 = idempotencyManager.acquireLock('ord-test-1');
        assert.equal(lock3.success, false);

        // Release lock on clean completion
        idempotencyManager.releaseLock('ORD-TEST-1', 'completed');

        // Completed order cannot be re-dialed
        const lockAfterComplete = idempotencyManager.acquireLock('ORD-TEST-1');
        assert.equal(lockAfterComplete.success, false);
        assert.match(lockAfterComplete.reason || '', /already completed/);
    });

    test('preserves lock in unresolved state on ambiguous timeout/failure to prevent redial', () => {
        idempotencyManager.reset();

        const lock1 = idempotencyManager.acquireLock('ORD-TEST-AMBIGUOUS');
        assert.equal(lock1.success, true);

        // Simulate ambiguous error
        idempotencyManager.markUnresolved('ORD-TEST-AMBIGUOUS', 'Call timed out waiting for transcript');

        // Subsequent retry must be blocked
        const retryLock = idempotencyManager.acquireLock('ORD-TEST-AMBIGUOUS');
        assert.equal(retryLock.success, false);
        assert.match(retryLock.reason || '', /unresolved state/);
    });
});
