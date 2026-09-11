import prisma from './prismaClient';

export async function ensureSeedData() {
  const existingPatients = await prisma.patient.count();
  if (existingPatients > 0) {
    return { seeded: false, count: existingPatients };
  }

  const provider = 'Dr. Emily Smith';
  const department = 'Cardiology';

  const patients = await Promise.all([
    prisma.patient.create({
      data: {
        first_name: 'Aarav',
        last_name: 'Sharma',
        phone_number: '+15555550101',
        date_of_birth: new Date('1991-05-18T00:00:00.000Z'),
        email: 'aarav.sharma@example.com',
      },
    }),
    prisma.patient.create({
      data: {
        first_name: 'Priya',
        last_name: 'Nair',
        phone_number: '+15555550102',
        date_of_birth: new Date('1986-11-02T00:00:00.000Z'),
        email: 'priya.nair@example.com',
      },
    }),
    prisma.patient.create({
      data: {
        first_name: 'Rohan',
        last_name: 'Patel',
        phone_number: '+15555550103',
        date_of_birth: new Date('1979-08-21T00:00:00.000Z'),
        email: 'rohan.patel@example.com',
      },
    }),
    prisma.patient.create({
      data: {
        first_name: 'Meera',
        last_name: 'Iyer',
        phone_number: '+15555550104',
        date_of_birth: new Date('1994-02-14T00:00:00.000Z'),
        email: 'meera.iyer@example.com',
      },
    }),
    prisma.patient.create({
      data: {
        first_name: 'Kabir',
        last_name: 'Singh',
        phone_number: '+15555550105',
        date_of_birth: new Date('1982-09-28T00:00:00.000Z'),
        email: 'kabir.singh@example.com',
      },
    }),
  ]);

  await Promise.all([
    prisma.appointment.create({
      data: {
        patient_id: patients[0].id,
        provider_name: provider,
        department,
        scheduled_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        status: 'BOOKED',
        is_backfill_eligible: true,
      },
    }),
    prisma.appointment.create({
      data: {
        patient_id: patients[1].id,
        provider_name: provider,
        department,
        scheduled_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        status: 'BOOKED',
        is_backfill_eligible: true,
      },
    }),
    prisma.appointment.create({
      data: {
        patient_id: patients[2].id,
        provider_name: provider,
        department,
        scheduled_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: 'BOOKED',
        is_backfill_eligible: true,
      },
    }),
    prisma.appointment.create({
      data: {
        patient_id: patients[3].id,
        provider_name: provider,
        department,
        scheduled_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        status: 'BOOKED',
        is_backfill_eligible: true,
      },
    }),
    prisma.appointment.create({
      data: {
        patient_id: patients[4].id,
        provider_name: provider,
        department,
        scheduled_at: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000),
        status: 'BOOKED',
        is_backfill_eligible: true,
      },
    }),
  ]);

  const w_patients = await Promise.all([
    prisma.patient.create({
      data: {
        first_name: 'Ananya',
        last_name: 'Verma',
        phone_number: '+15555550106',
        date_of_birth: new Date('1995-03-22T00:00:00.000Z'),
        email: 'ananya.verma@example.com',
      },
    }),
    prisma.patient.create({
      data: {
        first_name: 'Rahul',
        last_name: 'Joshi',
        phone_number: '+15555550107',
        date_of_birth: new Date('1988-07-10T00:00:00.000Z'),
        email: 'rahul.joshi@example.com',
      },
    }),
    prisma.patient.create({
      data: {
        first_name: 'Sneha',
        last_name: 'Gupta',
        phone_number: '+15555550108',
        date_of_birth: new Date('1992-11-05T00:00:00.000Z'),
        email: 'sneha.gupta@example.com',
      },
    }),
  ]);

  await Promise.all([
    prisma.waitlist.create({
      data: {
        patient_id: w_patients[0].id,
        preferred_department: department,
        target_provider: provider,
        priority_score: 95,
        status: 'WAITING',
      },
    }),
    prisma.waitlist.create({
      data: {
        patient_id: w_patients[1].id,
        preferred_department: department,
        target_provider: provider,
        priority_score: 80,
        status: 'WAITING',
      },
    }),
    prisma.waitlist.create({
      data: {
        patient_id: w_patients[2].id,
        preferred_department: department,
        target_provider: provider,
        priority_score: 70,
        status: 'WAITING',
      },
    }),
  ]);

  return { seeded: true, count: patients.length };
}
