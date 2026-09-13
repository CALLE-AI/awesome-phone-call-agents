import { Router } from 'express';
import { quoteStore } from '../store.js';
import { quoteOrchestrator } from '../services/orchestrator.js';
import { CreateHuntRequest } from '../types.js';

export const quotesRouter = Router();

// GET all jobs
quotesRouter.get('/', (_req, res) => {
  const jobs = quoteStore.getAllJobs();
  res.json({ success: true, jobs });
});

// GET specific job by ID
quotesRouter.get('/:id', (req, res) => {
  const job = quoteStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, job });
});

// POST cancel specific job by ID
quotesRouter.post('/:id/cancel', (req, res) => {
  const job = quoteStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  quoteOrchestrator.cancelQuoteHunt(req.params.id);
  res.json({ success: true, message: 'Quote hunt canceled successfully.' });
});

// POST launch new quote hunt
quotesRouter.post('/', async (req, res) => {
  try {
    const { category, description, vendors, dryRunSimulate, mode } = req.body as CreateHuntRequest & { mode?: string };

    if (!category || !description || !vendors || !Array.isArray(vendors) || vendors.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: category, description, and at least 1 vendor with name and phone.',
      });
    }

    // Validate phone number format for each vendor
    for (const v of vendors) {
      const cleaned = (v.phone || '').replace(/[\s\(\)\-\.]/g, '').trim();
      if (!cleaned.startsWith('+') || !/^\+[1-9]\d{7,14}$/.test(cleaned)) {
        return res.status(400).json({
          success: false,
          error: `Invalid phone number "${v.phone}" for ${v.name || 'vendor'}. Phone numbers must include country code starting with '+' followed by 8-15 digits (e.g. +15550100100 or +15550100101).`,
        });
      }
      v.phone = cleaned;
    }

    const isSimulate = mode === 'simulate' || Boolean(dryRunSimulate);

    const job = await quoteOrchestrator.startQuoteHunt({
      category,
      description,
      vendors,
      dryRunSimulate: isSimulate,
    });

    res.status(201).json({
      success: true,
      message: 'Parallel quote hunt initiated.',
      job,
    });
  } catch (err: any) {
    console.error('Failed to create quote hunt:', err);
    res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
});
