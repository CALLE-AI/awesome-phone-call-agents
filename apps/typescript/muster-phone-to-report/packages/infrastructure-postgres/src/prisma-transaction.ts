import type { Prisma, PrismaClient } from "./generated/prisma/client.js";

export type PrismaRepositoryClient = PrismaClient | Prisma.TransactionClient;

export async function runInPrismaTransaction<T>(
  client: PrismaRepositoryClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in client) {
    return await client.$transaction(async (transaction) => await operation(transaction));
  }
  return await operation(client);
}
