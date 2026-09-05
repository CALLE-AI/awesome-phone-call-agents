import { Router, Request, Response } from 'express';
import prisma from '../prismaClient';
import BackfillOrchestrator from '../services/BackfillOrchestrator';
import CalleService from '../services/CalleService';
import { ensureSeedData } from '../seed';

const router = Router();
const calle = new CalleService();
const orchestrator = new BackfillOrchestrator(calle);

// GET endpoint for dashboard - list all appointments
router.get('/', async (_req: Request, res: Response) => {
  try {
    const appts = await prisma.appointment.findMany({ include: { patient: true }, orderBy: { scheduled_at: 'asc' } });
    return res.json(appts);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'failed to list appointments' });
  }
});

// GET endpoint for waitlist
router.get('/waitlist', async (_req: Request, res: Response) => {
  try {
    const waitlist = await prisma.waitlist.findMany({ include: { patient: true }, orderBy: [{ priority_score: 'desc' }, { created_at: 'asc' }] });
    return res.json(waitlist);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'failed to list waitlist' });
  }
});

router.get('/list', async (_req: Request, res: Response) => {
  try {
    const appts = await prisma.appointment.findMany({ include: { patient: true }, orderBy: { scheduled_at: 'asc' } });
    return res.json(appts);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'failed to list appointments' });
  }
});

router.post('/reset-demo', async (_req: Request, res: Response) => {
  try {
    await prisma.callLog.deleteMany();
    await prisma.waitlist.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.patient.deleteMany();
    await ensureSeedData();
    return res.json({ ok: true, message: 'Demo data reset and reseeded' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'failed to reset demo data' });
  }
});

router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const { appointment_id, action, reason } = req.body as {
      appointment_id?: string;
      action?: string;
      reason?: string;
    };

    if (!appointment_id || action !== 'CANCEL') {
      return res.status(400).json({ error: 'invalid payload' });
    }

    await prisma.appointment.update({
      where: { id: appointment_id },
      data: {
        status: 'CANCELLED',
      },
    });

    if (req.body.patient_id) {
      await prisma.callLog.create({
        data: {
          calle_call_id: `manual-${appointment_id}`,
          direction: 'INBOUND',
          patient_id: req.body.patient_id,
          status: 'COMPLETED',
          transcript_summary: reason || 'Inbound cancellation request handled',
          structured_output: JSON.stringify({
            action,
            appointment_id,
            reason: reason || 'No reason provided',
          }),
        },
      });
    }

    orchestrator.triggerBackfill(appointment_id).catch((error) => {
      console.error('Orchestrator error', error);
    });

    return res.json({ ok: true, appointment_id, action, reason });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'server error' });
  }
});

export default router;
