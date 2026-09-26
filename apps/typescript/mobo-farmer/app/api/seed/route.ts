import { NextResponse } from 'next/server';
import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { mockStats, mockCrops, mockWaterManagement, mockActiveCalls, mockRecentResults, mockCallHistory } from '@/lib/mockData';

export async function POST() {
  try {
    const batch = writeBatch(db);

    // Seed dashboard/stats
    const statsRef = doc(db, 'dashboard', 'stats');
    batch.set(statsRef, mockStats);

    // Seed dashboard/waterManagement
    const waterRef = doc(db, 'dashboard', 'waterManagement');
    batch.set(waterRef, mockWaterManagement);

    // Seed crops
    mockCrops.forEach((crop) => {
      const cropRef = doc(collection(db, 'crops'), crop.id.toString());
      batch.set(cropRef, crop);
    });

    // Seed activeCalls
    mockActiveCalls.forEach((call) => {
      const callRef = doc(collection(db, 'activeCalls'), call.id.toString());
      batch.set(callRef, call);
    });

    // Seed recentResults
    mockRecentResults.forEach((result) => {
      const resultRef = doc(collection(db, 'recentResults'), result.id.toString());
      batch.set(resultRef, result);
    });

    // Seed callHistory
    mockCallHistory.forEach((history) => {
      const historyRef = doc(collection(db, 'callHistory'), history.id.toString());
      batch.set(historyRef, history);
    });

    await batch.commit();

    return NextResponse.json({ message: 'Database seeded successfully' }, { status: 200 });
  } catch (error: any) {
    console.error('Error seeding database:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
