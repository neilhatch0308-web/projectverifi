import { z } from 'zod';

// Zod's built-in .uuid() enforces the strict RFC4122 format - version
// digit must be 1-5, variant digit must be 8/9/a/b. The hand-seeded IDs
// used throughout this app's seed data (e.g. '41111111-0000-0000-0000-
// 000000000001') don't meet that - version/variant nibbles are '0',
// which real UUIDs never use, but which is fine for a readable seed ID.
//
// This accepts anything UUID-SHAPED (8-4-4-4-12 hex, dashes in the right
// places) without policing version/variant bits. Use this everywhere an
// endpoint validates an ID that might be seed data, not just real
// gen_random_uuid() output.
export const looseUuid = (message = 'Invalid ID format') =>
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, message);
