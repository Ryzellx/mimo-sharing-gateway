import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { getDb } from '../db/client.js';
import { adminUsers, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { signJwt, verifyJwt, type JwtPayload } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: JwtPayload;
  }
}

export async function loginAdmin(input: {
  email: string;
  password: string;
}): Promise<{ token: string; username: string }> {
  const rows = await getDb()
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, input.email))
    .limit(1);
  const admin = rows[0];
  if (!admin || !(await verifyPassword(admin.passwordHash, input.password))) {
    throw errors.invalidCredentials();
  }
  await getDb()
    .update(adminUsers)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminUsers.id, admin.id));
  return {
    token: signJwt({ sub: admin.id, role: 'admin', username: admin.username }, config.env.JWT_SECRET, config.env.JWT_TTL_SECONDS),
    username: admin.username,
  };
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ token: string; username: string; userId: string }> {
  const rows = await getDb().select().from(users).where(eq(users.email, input.email)).limit(1);
  const user = rows[0];
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    throw errors.invalidCredentials();
  }
  return {
    token: signJwt({ sub: user.id, role: 'user', username: user.username }, config.env.JWT_SECRET, config.env.JWT_TTL_SECONDS),
    username: user.username,
    userId: user.id,
  };
}

export function authenticateRequest(req: FastifyRequest): JwtPayload {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw errors.invalidApiKey();
  const payload = verifyJwt(header.slice(7), config.env.JWT_SECRET);
  if (!payload) throw errors.invalidApiKey();
  req.auth = payload;
  return payload;
}

export function requireAdmin(req: FastifyRequest): JwtPayload {
  const payload = authenticateRequest(req);
  if (payload.role !== 'admin') throw errors.forbidden('Admin access required');
  return payload;
}

export function requireUser(req: FastifyRequest): JwtPayload {
  return authenticateRequest(req);
}

export async function ensureBootstrapAdmin() {
  const db = getDb();
  const existing = await db.select({ id: adminUsers.id }).from(adminUsers).limit(1);
  if (existing.length > 0) return;
  await db.insert(adminUsers).values({
    username: config.env.BOOTSTRAP_ADMIN_USERNAME,
    email: config.env.BOOTSTRAP_ADMIN_EMAIL,
    passwordHash: await hashPassword(config.env.BOOTSTRAP_ADMIN_PASSWORD),
    role: 'super_admin',
  });
}

export function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: { message: 'Unauthorized', type: 'invalid_api_key', code: 'INVALID_API_KEY' } });
}
