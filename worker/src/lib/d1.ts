// D1 rejects any statement with more than 100 bound parameters, so an
// `IN (?, ?, …)` list that grows with the fleet (one id per device, per
// component, …) works in a small deployment and then fails outright once the
// list passes ~100 -- at which point, for the cron, every scheduled job stops.
// Anything whose list size scales with data goes through these helpers.
const CHUNK_SIZE = 80; // headroom under 100 for the statement's other binds

export function chunked<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Run `run` once per chunk of `items` and concatenate the rows.
export async function allInChunks<I, R>(items: readonly I[], run: (chunk: I[]) => Promise<R[]>, size = CHUNK_SIZE): Promise<R[]> {
  const parts = await Promise.all(chunked(items, size).map(run));
  return parts.flat();
}
