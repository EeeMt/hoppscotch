import { Prisma } from 'src/generated/prisma/client';

/** All login methods must hold this lock through email lookup and account writes. */
export async function lockLoginEmail(
  tx: Prisma.TransactionClient,
  email: string,
) {
  const canonical = email.trim().toLowerCase();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonical}, 0))`;
}
