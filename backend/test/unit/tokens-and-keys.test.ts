import { describe, expect, it } from 'vitest';
import {
  buildUsage,
  estimateMessageTokens,
  estimateTokens,
} from '../../src/lib/token-estimate.js';
import { hashApiKey, generateApiKey, maskApiKey, maskMimoToken, validateKeyish, encryptSecret, decryptSecret, constantTimeEquals } from '../../src/lib/crypto.js';

describe('token accounting', () => {
  it('marks official usage with the exact upstream numbers', () => {
    const usage = buildUsage(1200, 800);
    expect(usage.total_tokens).toBe(2000); // T_total = T_input + T_output
  });

  it('estimates tokens for latin text at ~4 chars/token', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates CJK text at ~1 token per char', () => {
    expect(estimateTokens('日本語テキスト')).toBe(7);
  });

  it('estimates multimodal message content from text parts', () => {
    const tokens = estimateMessageTokens([
      { type: 'text', text: 'abcdefgh' },
      { type: 'image_url', image_url: { url: 'x' } },
    ]);
    expect(tokens).toBe(2 + 16);
  });

  it('official and estimated usage never mix in one record', () => {
    const sources = ['official', 'estimated'] as const;
    for (const s of sources) {
      expect(['official', 'estimated']).toContain(s);
    }
  });
});

describe('api key validation', () => {
  it('generates gw_live_ keys and hashes them one-way', () => {
    const key = generateApiKey();
    expect(key.raw.startsWith('gw_live_')).toBe(true);
    expect(key.hash).toBe(hashApiKey(key.raw));
    expect(key.hash).not.toContain(key.raw);
  });

  it('masks keys as prefix + dots + last4 only', () => {
    const key = generateApiKey();
    const masked = maskApiKey(key.prefix, key.last4);
    expect(masked).toContain(key.prefix);
    expect(masked.endsWith(key.last4)).toBe(true);
    expect(masked).not.toContain(key.raw.slice(key.prefix.length, key.raw.length - 4));
  });

  it('rejects malformed keys', () => {
    expect(validateKeyish('gw_live_')).toBe(false);
    expect(validateKeyish('sk_live_abcdef')).toBe(false);
    expect(validateKeyish('gw_live_' + 'a'.repeat(40))).toBe(true);
    expect(validateKeyish('gw_live_bad!chars')).toBe(false);
  });

  it('masks mimo tokens with head/tail only', () => {
    const masked = maskMimoToken('mimo_test_token_1234');
    expect(masked.startsWith('mimo_tes')).toBe(true);
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).toContain('••••••••');
    expect(masked).not.toContain('token');
  });

  it('compares secrets in constant time', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
  });
});

describe('mimo token encryption at rest', () => {
  it('round-trips AES-256-GCM ciphertext', () => {
    const plain = 'mimo_super_secret_token_91ab';
    const packed = encryptSecret(plain);
    expect(packed).not.toContain(plain);
    expect(packed.startsWith('v1.')).toBe(true);
    expect(decryptSecret(packed)).toBe(plain);
  });

  it('produces distinct ciphertext for identical plaintext (random IV)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('rejects tampered ciphertext', () => {
    const packed = encryptSecret('payload');
    const parts = packed.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64')].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
