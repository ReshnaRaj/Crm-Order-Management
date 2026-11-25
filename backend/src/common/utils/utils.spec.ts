import { randomBytes } from 'crypto';
import { backoffMs } from '../../webhooks/webhook-processor.service';
import { decryptSecret, encryptSecret, safeEqual } from './crypto.util';
import { paginate } from './pagination.util';

describe('crypto utils', () => {
  const key = randomBytes(32);

  it('round-trips secrets with AES-256-GCM and random IVs', () => {
    const a = encryptSecret('shpat_secret', key);
    const b = encryptSecret('shpat_secret', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('shpat');
    expect(decryptSecret(a, key)).toBe('shpat_secret');
  });

  it('detects tampering and wrong keys', () => {
    const enc = encryptSecret('value', key);
    const [iv, tag, data] = enc.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join('.'), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
  });

  it('compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('paginate', () => {
  it('computes metadata', () => {
    expect(paginate([1, 2], 25, 2, 10).meta).toEqual({
      page: 2,
      pageSize: 10,
      totalItems: 25,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });
  it('reports one page for empty results', () => {
    expect(paginate([], 0, 1, 10).meta).toMatchObject({ totalPages: 1, hasNextPage: false, hasPreviousPage: false });
  });
});

describe('webhook backoff', () => {
  it('grows exponentially and is capped at one hour', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
