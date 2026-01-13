import crypto from 'crypto';

/**
 * Validates if an external fingerprint value is valid.
 * Invalid values: null, undefined, empty string, whitespace-only string, zero
 */
export function isValidExternalFingerprint(value: unknown): value is string {
  if (value === null || value === undefined) return false;
  if (value === 0) return false;
  if (typeof value !== 'string') return false;
  if (value.trim() === '') return false;
  return true;
}

// Fields that change on each occurrence and should be ignored in fingerprint
const DYNAMIC_FIELDS = new Set([
  'timestamp', 'occurredAt', 'createdAt', 'updatedAt', 'time', 'date',
  'requestId', 'traceId', 'spanId', 'correlationId',
  'id', 'uuid', 'eventId', 'event_id', 'issueId',
]);

function removeDynamicFields(obj: unknown, seen = new WeakSet()): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return '[circular]';
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map(item => removeDynamicFields(item, seen));
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!DYNAMIC_FIELDS.has(key)) {
      cleaned[key] = removeDynamicFields(value, seen);
    }
  }
  return cleaned;
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function generateFingerprint(payload: Record<string, unknown>): string {
  const stable = removeDynamicFields(payload);
  const sorted = sortObjectKeys(stable);
  const json = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(json).digest('hex').substring(0, 32);
}
