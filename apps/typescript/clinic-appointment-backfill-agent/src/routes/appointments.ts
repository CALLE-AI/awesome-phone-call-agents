import { Router, Request, Response } from 'express';
import prisma from '../prismaClient';
import BackfillOrchestrator from '../services/BackfillOrchestrator';
import CalleService from '../services/CalleService';
import { ensureSeedData } from '../seed';
import { requireAuth } from '../middleware/auth';

const router = Router();
const calle = new CalleService();
const orchestrator = new BackfillOrchestrator(calle);

async function findVerifiedAppointment(appointmentId: string, patientId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true },
  });

  if (!appointment) {
    return { error: 'appointment not found' as const };
  }

  if (!appointment.patient_id || appointment.patient_id !== patientId) {
    return { error: 'selected patient does not match appointment' as const };
  }

  return { appointment };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const appts = await prisma.appointment.findMany({ include: { patient: true }, orderBy: { scheduled_at: 'asc' } });
    return res.json(appts);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'failed to list appointments' });
  }
});

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

router.post('/reset-demo', requireAuth, async (_req: Request, res: Response) => {
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

router.post('/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { appointment_id, patient_id, action, reason } = req.body as {
      appointment_id?: string;
      patient_id?: string;
      action?: string;
      reason?: string;
    };

    if (!appointment_id || !patient_id || action !== 'CANCEL') {
      return res.status(400).json({ error: 'invalid payload: appointment_id, patient_id, and action=CANCEL are required' });
    }

    const verified = await findVerifiedAppointment(appointment_id, patient_id);
    if ('error' in verified) {
      return res.status(verified.error === 'appointment not found' ? 404 : 409).json({ error: verified.error });
    }

    await prisma.appointment.update({
      where: { id: appointment_id },
      data: { status: 'CANCELLED' },
    });

    await prisma.callLog.create({
      data: {
        calle_call_id: `manual-${appointment_id}-${Date.now()}`,
        direction: 'INBOUND',
        patient_id,
        status: 'COMPLETED',
        transcript_summary: reason || 'Inbound cancellation request handled',
        structured_output: JSON.stringify({
          action,
          appointment_id,
          patient_id,
          reason: reason || 'No reason provided',
          verified: true,
        }),
      },
    });

    orchestrator.triggerBackfill(appointment_id).catch((error) => {
      console.error('Orchestrator error', error);
    });

    return res.json({ ok: true, appointment_id, patient_id, action, reason });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'server error' });
  }
});

export default router;
