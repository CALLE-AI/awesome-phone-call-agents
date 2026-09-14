import { Router } from 'express';
import { quoteStore } from '../store.js';
import { quoteOrchestrator } from '../services/orchestrator.js';
import { CreateHuntRequest } from '../types.js';

export const quotesRouter = Router();

/**
 * Helper to determine if a request originates from loopback (localhost)
 */
const isLoopbackRequest = (req: any): boolean => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const host = req.hostname || req.headers?.host || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.includes('127.0.0.1') ||
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1')
  );
};

/**
 * Helper to verify authorized access for protected remote call / private-job endpoints
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

// GET all jobs (protected private-job access or loopback-only)
quotesRouter.get('/', (req, res) => {
  if (!isAuthorizedRequest(req)) {
    return res.status(403).json({ success: false, error: 'Job listing access is restricted to loopback or authorized requests.' });
  }
  const jobs = quoteStore.getAllJobs();
  res.json({ success: true, jobs });
});

// GET specific job by ID (protected private-job access or loopback-only)
quotesRouter.get('/:id', (req, res) => {
  if (!isAuthorizedRequest(req)) {
    return res.status(403).json({ success: false, error: 'Job details access is restricted to loopback or authorized requests.' });
  }
  const job = quoteStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, job });
});

// POST cancel specific job by ID (protected private-job access or loopback-only)
quotesRouter.post('/:id/cancel', (req, res) => {
  if (!isAuthorizedRequest(req)) {
    return res.status(403).json({ success: false, error: 'Job cancellation is restricted to loopback or authorized requests.' });
  }
  const job = quoteStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  quoteOrchestrator.cancelQuoteHunt(req.params.id);
  res.json({
    success: true,
    message: 'Cancellation signal dispatched. Note: in-flight carrier disconnect is advisory and subject to telecom propagation latency.',
  });
});

// POST launch new quote hunt
quotesRouter.post('/', async (req, res) => {
  try {
    const { category, description, vendors, dryRunSimulate, mode, authorizedLiveIntent, liveIntent } = req.body as CreateHuntRequest & {
      mode?: string;
      authorizedLiveIntent?: boolean;
      liveIntent?: boolean;
    };

    if (!category || !description || !vendors || !Array.isArray(vendors) || vendors.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: category, description, and at least 1 vendor with name and phone.',
      });
    }

    // Default the documented workflow to simulation; require explicit authorized live intent for real calls
    const isLiveRequested = mode === 'live';
    const isSimulate = !isLiveRequested || Boolean(dryRunSimulate);

    if (isLiveRequested) {
      // Require loopback-only operation or protected remote access
      if (!isAuthorizedRequest(req)) {
        return res.status(403).json({
          success: false,
          error: 'Live carrier calls require loopback-only operation or an authorized remote header (x-quotehunter-auth).',
        });
      }

      // Require explicit authorized live intent
      const hasLiveIntent = Boolean(authorizedLiveIntent || liveIntent);
      if (!hasLiveIntent) {
        return res.status(400).json({
          success: false,
          error: 'Explicit authorized live intent is required to initiate live carrier calls. Pass authorizedLiveIntent: true.',
        });
      }
    }

    // Validate phone number format and enforce unique destinations
    const destinationPhones = new Set<string>();
    for (const v of vendors) {
      const cleaned = (v.phone || '').replace(/[\s\(\)\-\.]/g, '').trim();
      if (!cleaned.startsWith('+') || !/^\+[1-9]\d{7,14}$/.test(cleaned)) {
        return res.status(400).json({
          success: false,
          error: `Invalid phone number "${v.phone}" for ${v.name || 'vendor'}. Phone numbers must include country code starting with '+' followed by 8-15 digits (e.g. +15550100100).`,
        });
      }
      if (destinationPhones.has(cleaned)) {
        return res.status(400).json({
          success: false,
          error: `Duplicate destination phone number detected: "${v.phone}". Each vendor call must have a unique destination.`,
        });
      }
      destinationPhones.add(cleaned);
      v.phone = cleaned;
    }

    const job = await quoteOrchestrator.startQuoteHunt({
      category,
      description,
      vendors,
      dryRunSimulate: isSimulate,
    });

    res.status(201).json({
      success: true,
      message: isSimulate ? 'Simulated quote hunt initiated.' : 'Parallel live quote hunt initiated.',
      job,
    });
  } catch (err: any) {
    console.error('Failed to create quote hunt:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});
