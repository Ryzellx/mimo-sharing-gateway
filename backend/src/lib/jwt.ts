import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtPayload {
  sub: string;
  role: 'admin' | 'user';
  username: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signJwt(
  payload: { sub: string; role: 'admin' | 'user'; username: string },
  secret: string,
  ttlSeconds = 86_400,
): string {
  const now = Math.floor(Date.now() / 1000);
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const encoded = b64url(JSON.stringify(body));
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const signature = sign(`${header}.${encoded}`, secret);
  return `${header}.${encoded}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, encoded, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${encoded}`, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
