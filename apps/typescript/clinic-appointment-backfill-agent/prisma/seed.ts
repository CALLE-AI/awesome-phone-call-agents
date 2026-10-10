/// <reference types="node" />
import prisma from '../src/prismaClient';
import { ensureSeedData } from '../src/seed';

async function main() {
  const result = await ensureSeedData();
  console.log('Seeding complete:', result);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
