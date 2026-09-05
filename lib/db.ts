/**
 * Prisma client singleton.
 *
 * In dev, Next.js hot-reloads modules on every save, which would otherwise
 * create a new PrismaClient (and a new connection pool) each time. Stashing
 * the instance on `globalThis` avoids exhausting the DB connection pooler.
 */
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
