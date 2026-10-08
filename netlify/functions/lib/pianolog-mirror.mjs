// Piano Log read mirror (phase 1, 10/7): the map's pianos come from the
// Supabase copy of the Piano Log (schema pianolog, project ismacawxfvvllfinibbf,
// refreshed every ≤3 min by blpsalesapp's pianolog-sync) instead of the slow,
// flaky public CSV export. The SHEET stays the authority — this is a read
// copy. Reads go through a service_role-only RPC (the schema is not exposed
// and holds customer PII), so this needs SUPABASE_SERVICE_KEY in the site env
// (already there for /api/queue). Fallback: when the mirror is unreachable or
// EMPTY, callers parse the CSV export with the same shared parser.
import parser from './pianolog-parse.cjs';

export const PIANO_LOG_CSV =
  'https://docs.google.com/spreadsheets/d/1ZunbPKygpQlcXfTyPowDHdUE9spJ3uV1XA4iX1eoKRc/export?format=csv&gid=970727205';
const SB_URL = (process.env.SUPABASE_URL || 'https://ismacawxfvvllfinibbf.supabase.co').replace(/\/$/, '');
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const mirrorConfigured = () => !!SB_SERVICE_KEY;

/** Store Map records from the mirror. Throws when unreachable; returns [] when empty. */
export async function readMirror(activeOnly, timeoutMs = 8000) {
  if (!SB_SERVICE_KEY) throw new Error('mirror not configured (SUPABASE_SERVICE_KEY)');
  const r = await fetch(SB_URL + '/rest/v1/rpc/pianolog_read', {
    method: 'POST',
    headers: { apikey: SB_SERVICE_KEY, Authorization: 'Bearer ' + SB_SERVICE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_shape: 'sm', p_active_only: !!activeOnly }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error('mirror read ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const j = await r.json();
  const rows = (j && j.rows) || [];
  return { pianos: rows, lastSync: j && j.last_sync ? j.last_sync.at : null };
}

/** Fallback: the public CSV export through the same shared parser. */
export async function readCsv(timeoutMs = 25000) {
  const text = await fetch(PIANO_LOG_CSV, { signal: AbortSignal.timeout(timeoutMs) }).then(r => r.text());
  return parser.parseStoreMap(parser.parseCSV(text)).pianos;
}

/**
 * Pianos for the map: mirror first (fast), CSV when the mirror is down or
 * has zero rows. Returns {pianos, source: 'mirror'|'csv', lastSync}.
 */
export async function loadPianos(activeOnly) {
  if (SB_SERVICE_KEY) {
    try {
      const m = await readMirror(activeOnly);
      if (m.pianos.length) return { pianos: m.pianos, source: 'mirror', lastSync: m.lastSync };
      console.warn('[pianolog-mirror] mirror returned 0 rows — using CSV');
    } catch (e) {
      console.warn('[pianolog-mirror] mirror unavailable — using CSV:', String(e.message || e).slice(0, 120));
    }
  }
  let pianos = await readCsv();
  if (activeOnly) pianos = pianos.filter(p => p.active);
  return { pianos, source: 'csv', lastSync: null };
}
