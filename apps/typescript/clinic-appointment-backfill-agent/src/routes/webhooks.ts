import { Router, Request, Response } from 'express';
import prisma from '../prismaClient';
import CalleService from '../services/CalleService';

const router = Router();
const calle = new CalleService();

router.post('/calle', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, any>;
    const parsed = calle.parseWebhook(body);

    const patientId = typeof body.patient_id === 'string' ? body.patient_id : null;

    if (patientId) {
      await prisma.callLog.create({
        data: {
          calle_call_id: parsed.calle_call_id || body.call_id || 'unknown-call',
          direction: body.direction === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND',
          patient_id: patientId,
          status:
            parsed.response_status === 'FAILED'
              ? 'FAILED'
              : parsed.response_status === 'NO_ANSWER'
                ? 'NO_ANSWER'
                : 'COMPLETED',
          transcript_summary: parsed.notes || body.transcript_summary || null,
          structured_output: JSON.stringify(parsed),
        },
      });
    }

    if (body.action === 'CANCEL' && body.appointment_id) {
      await prisma.appointment.update({
        where: { id: body.appointment_id },
        data: { status: 'CANCELLED' },
      });
    }

    return res.json({ ok: true, parsed });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'webhook handler failed' });
  }
});

export default router;
