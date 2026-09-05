import { Router, Request, Response } from 'express';
import prisma from '../prismaClient';

const router = Router();

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [booked, cancelled, waiting, totalPatients, appointments, queue, recentCalls, patients] = await Promise.all([
      prisma.appointment.count({ where: { status: 'BOOKED' } }),
      prisma.appointment.count({ where: { status: 'CANCELLED' } }),
      prisma.waitlist.count({ where: { status: 'WAITING' } }),
      prisma.patient.count(),
      prisma.appointment.findMany({
        orderBy: { scheduled_at: 'asc' },
        include: { patient: true },
        take: 20,
      }),
      prisma.waitlist.findMany({
        where: { status: 'WAITING' },
        orderBy: [{ priority_score: 'desc' }, { created_at: 'asc' }],
        include: { patient: true },
        take: 10,
      }),
      prisma.callLog.findMany({
        orderBy: { created_at: 'desc' },
        include: { patient: true },
        take: 8,
      }),
      prisma.patient.findMany({
        orderBy: { last_name: 'asc' },
        take: 50,
      }),
    ]);

    return res.json({
      booked,
      cancelled,
      waiting,
      totalPatients,
      patients: patients.map((patient) => ({
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        phone_number: patient.phone_number,
        label: `${patient.first_name} ${patient.last_name}`,
      })),
      appointments: appointments.map((entry) => ({
        id: entry.id,
        scheduled_at: entry.scheduled_at,
        provider_name: entry.provider_name,
        department: entry.department,
        status: entry.status,
        patient: entry.patient ? `${entry.patient.first_name} ${entry.patient.last_name}` : null,
        patient_id: entry.patient_id,
      })),
      queue: queue.map((entry) => ({
        id: entry.id,
        patient: `${entry.patient.first_name} ${entry.patient.last_name}`,
        priority_score: entry.priority_score,
        preferred_department: entry.preferred_department,
        status: entry.status,
        phone_number: entry.patient.phone_number,
      })),
      recent_calls: recentCalls.map((call) => ({
        id: call.id,
        patient: call.patient ? `${call.patient.first_name} ${call.patient.last_name}` : 'Unknown patient',
        direction: call.direction,
        status: call.status,
        transcript_summary: call.transcript_summary || 'No summary yet',
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'dashboard stats failed' });
  }
});

export default router;
