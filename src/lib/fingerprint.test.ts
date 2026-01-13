import { describe, it, expect } from 'vitest';
import { generateFingerprint } from './fingerprint.js';

describe('generateFingerprint', () => {
  it('produces consistent fingerprints for equivalent errors with different timestamps', () => {
    // User behavior: When the same error occurs twice, it should be deduplicated
    // to avoid creating duplicate Linear issues. Dynamic fields like timestamps
    // should not affect the fingerprint.
    const error1 = {
      message: 'Cannot read property "id" of undefined',
      stack: 'TypeError at processUser (user.ts:45)',
      timestamp: '2024-01-15T10:30:00Z',
      requestId: 'req-123',
      traceId: 'trace-abc',
    };

    const error2 = {
      message: 'Cannot read property "id" of undefined',
      stack: 'TypeError at processUser (user.ts:45)',
      timestamp: '2024-01-15T14:45:00Z', // Different timestamp
      requestId: 'req-456', // Different requestId
      traceId: 'trace-xyz', // Different traceId
    };

    const fingerprint1 = generateFingerprint(error1);
    const fingerprint2 = generateFingerprint(error2);

    expect(fingerprint1).toBe(fingerprint2);
    expect(fingerprint1).toHaveLength(32); // SHA-256 truncated to 32 chars
  });

  it('produces different fingerprints for genuinely different errors', () => {
    const error1 = {
      message: 'Cannot read property "id" of undefined',
      stack: 'TypeError at processUser (user.ts:45)',
    };

    const error2 = {
      message: 'Network timeout after 30000ms',
      stack: 'TimeoutError at fetchData (api.ts:128)',
    };

    const fingerprint1 = generateFingerprint(error1);
    const fingerprint2 = generateFingerprint(error2);

    expect(fingerprint1).not.toBe(fingerprint2);
  });
});
