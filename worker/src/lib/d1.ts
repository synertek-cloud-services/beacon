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

// Cloudflare caps the number of D1 queries one Worker invocation can make
// (1,000 on the paid plan, far fewer on free), so a scheduled run that does one
// INSERT per device falls over at fleet scale. D1's batch() sends many
// statements as a single call; this runs a list of drizzle statements through
// it in bounded chunks.
const BATCH_SIZE = 50;

export async function batchStatements(
  db: { batch: (statements: any) => Promise<unknown> },
  statements: readonly unknown[],
  size = BATCH_SIZE,
): Promise<void> {
  for (const part of chunked(statements, size)) await db.batch(part);
}
