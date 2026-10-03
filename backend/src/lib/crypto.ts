import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { config } from '../config.js';

const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashed, password);
  } catch {
    return false;
  }
}

const KEY = createHash('sha256').update(config.env.ENCRYPTION_KEY).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(packed: string): string {
  const [version, ivB64, tagB64, dataB64] = packed.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomBase62(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += BASE62[bytes[i]! % BASE62.length];
  }
  return out;
}

export interface GeneratedApiKey {
  raw: string;
  hash: string;
  prefix: string;
  last4: string;
}

export const API_KEY_PREFIX = 'gw_live_';

export function generateApiKey(): GeneratedApiKey {
  const raw = `${API_KEY_PREFIX}${randomBase62(40)}`;
  const hash = hashApiKey(raw);
  return {
    raw,
    hash,
    prefix: raw.slice(0, API_KEY_PREFIX.length + 8),
    last4: raw.slice(-4),
  };
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function validateApiKeyFormat(raw: string): boolean {
  return /^gw_live_[A-Za-z0-9]{16,}$/.test(raw);
}

export const validateKeyish = validateApiKeyFormat;

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function maskApiKey(prefix: string, last4: string): string {
  return `${prefix}${'•'.repeat(8)}${last4}`;
}

export function maskMimoToken(token: string): string {
  const head = token.slice(0, 8);
  const tail = token.length > 4 ? token.slice(-4) : token;
  return `${head}${'•'.repeat(8)}${tail}`;
}
