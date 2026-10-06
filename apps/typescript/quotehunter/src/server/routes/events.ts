import { Router } from 'express';
import { quoteStore } from '../store.js';
import { maskPhoneNumber, maskSensitiveText } from '../services/calle.js';

export const eventsRouter = Router();

/**
 * Helper to determine if a request originates from loopback (localhost).
 * Only trusts the socket-level remote address (req.ip / req.socket.remoteAddress),
 * never caller-controlled headers like Host or X-Forwarded-For.
 */
const isLoopbackRequest = (req: any): boolean => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1'
  );
};

/**
 * Helper to verify authorized access for protected event stream endpoints.
 */
const isAuthorizedRequest = (req: any): boolean => {
  if (isLoopbackRequest(req)) return true;
  const secret = process.env.QUOTEHUNTER_API_SECRET || process.env.CALLE_API_KEY;
  if (!secret) return false;
  const authHeader = req.headers['x-quotehunter-auth'] || req.headers['authorization'];
  if (!authHeader) return false;
  const token = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
  return token === secret;
};

/**
 * Sanitize event payloads before sending to clients:
 * - Mask raw vendor phone numbers
 * - Strip raw provider diagnostics from transcripts/notes/evidence
 */
function sanitizeEventPayload(event: any): any {
  if (!event) return event;
  const sanitized = { ...event };

  // Sanitize vendor objects embedded in events
  if (sanitized.vendor) {
    sanitized.vendor = sanitizeVendor(sanitized.vendor);
  }

  // Sanitize full job objects embedded in events
  if (sanitized.job) {
    sanitized.job = sanitizeJob(sanitized.job);
  }

  return sanitized;
}

function sanitizeVendor(v: any): any {
  if (!v) return v;
  return {
    ...v,
    phone: maskPhoneNumber(v.phone),
    providerNotes: v.providerNotes ? maskSensitiveText(v.providerNotes) : v.providerNotes,
    transcriptSummary: v.transcriptSummary ? maskSensitiveText(v.transcriptSummary) : v.transcriptSummary,
    evidenceSnippet: v.evidenceSnippet ? maskSensitiveText(v.evidenceSnippet) : v.evidenceSnippet,
  };
}

function sanitizeJob(job: any): any {
  if (!job) return job;
  const sanitized = { ...job };
  if (Array.isArray(sanitized.vendors)) {
    sanitized.vendors = sanitized.vendors.map(sanitizeVendor);
  }
  return sanitized;
}

// SSE stream for a specific job (protected — requires authorization or loopback)
eventsRouter.get('/:id', (req, res) => {
  if (!isAuthorizedRequest(req)) {
    return res.status(403).json({ success: false, error: 'Event stream access is restricted to loopback or authorized requests.' });
  }

  const jobId = req.params.id;
  const initialJob = quoteStore.getJob(jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial state (sanitized)
  if (initialJob) {
    res.write(`data: ${JSON.stringify(sanitizeEventPayload({ type: 'initial', job: initialJob }))}\n\n`);
  }

  const listener = (event: any) => {
    res.write(`data: ${JSON.stringify(sanitizeEventPayload(event))}\n\n`);
  };

  const eventName = `job:${jobId}`;
  quoteStore.on(eventName, listener);

  // Send keepalive comments every 15s to prevent browser/proxy timeouts during long calls
  const keepAlive = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    quoteStore.off(eventName, listener);
    res.end();
  });
});

// SSE global stream for dashboard updates (protected — requires authorization or loopback)
eventsRouter.get('/', (req, res) => {
  if (!isAuthorizedRequest(req)) {
    return res.status(403).json({ success: false, error: 'Event stream access is restricted to loopback or authorized requests.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const listener = (event: any) => {
    res.write(`data: ${JSON.stringify(sanitizeEventPayload(event))}\n\n`);
  };

  quoteStore.on('global', listener);

  const keepAlive = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (_) {}
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    quoteStore.off('global', listener);
    res.end();
  });
});
