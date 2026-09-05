import { Router, Request, Response } from 'express';
import prisma from '../prismaClient';
import BackfillOrchestrator from '../services/BackfillOrchestrator';
import CalleService from '../services/CalleService';

const router = Router();
const calle = new CalleService();
const orchestrator = new BackfillOrchestrator(calle);

router.post('/mock', async (req: Request, res: Response) => {
  try {
    const { appointment_id, patient_id, action, reason } = req.body as {
      appointment_id?: string;
      patient_id?: string;
      action?: string;
      reason?: string;
    };

    if (!appointment_id || action !== 'CANCEL') {
      return res.status(400).json({ error: 'invalid payload: appointment_id and action=CANCEL are required' });
    }

    let patient = null as Awaited<ReturnType<typeof prisma.patient.findUnique>>;
    if (patient_id) {
      patient = await prisma.patient.findUnique({ where: { id: patient_id } });
    }

    if (!patient) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointment_id },
        include: { patient: true },
      });
      patient = appointment?.patient ?? null;
    }

    if (!patient) {
      return res.status(404).json({ error: 'patient not found' });
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointment_id },
      include: { patient: true },
    });

    if (!appointment) {
      return res.status(404).json({ error: 'appointment not found' });
    }

    if (appointment.patient_id && appointment.patient_id !== patient.id) {
      return res.status(401).json({ error: 'selected patient does not match appointment' });
    }

    await prisma.appointment.update({
      where: { id: appointment_id },
      data: { status: 'CANCELLED' },
    });

    await prisma.callLog.create({
      data: {
        calle_call_id: `mock-inbound-${appointment_id}`,
        direction: 'INBOUND',
        patient_id: patient.id,
        status: 'COMPLETED',
        transcript_summary: reason || 'Mock inbound cancellation handled',
        structured_output: JSON.stringify({
          action: 'CANCEL',
          appointment_id,
          patient_id: patient.id,
          reason: reason || 'No reason provided',
          verified: true,
        }),
      },
    });

    orchestrator.triggerBackfill(appointment_id).catch((error) => {
      console.error('Mock inbound backfill error', error);
    });

    return res.json({
      ok: true,
      message: 'Inbound cancellation mock handled successfully',
      appointment_id,
      patient_id: patient.id,
      verified: true,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'mock inbound handler failed' });
  }
});

router.post('/call-completed', async (req: Request, res: Response) => {
  try {
    const { patient_id, appointment_id, action, reason } = req.body as {
      patient_id?: string;
      appointment_id?: string;
      action?: string;
      reason?: string;
    };

    if (!appointment_id || !patient_id || action !== 'CANCEL') {
      return res.status(400).json({ error: 'invalid payload' });
    }

    await prisma.appointment.update({
      where: { id: appointment_id },
      data: { status: 'CANCELLED' },
    });

    await prisma.callLog.create({
      data: {
        calle_call_id: `inbound-${appointment_id}`,
        direction: 'INBOUND',
        patient_id,
        status: 'COMPLETED',
        transcript_summary: reason || 'Inbound completion handled',
        structured_output: JSON.stringify({ action, appointment_id, patient_id, reason }),
      },
    });

    orchestrator.triggerBackfill(appointment_id).catch((error) => {
      console.error('Inbound backfill error', error);
    });

    return res.json({ ok: true, message: 'Inbound cancellation processed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'inbound completion handler failed' });
  }
});

export default router;
