import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

// `drizzle(DB, { schema })` re-walks the whole schema (extractTablesRelationalConfig)
// on every call -- measured at ~2.9ms of a ~12ms check-in locally, since check-in
// and its helpers each built their own. An instance holds no per-request state,
// so build one per D1 binding per isolate and reuse it. The Workers free plan
// caps CPU at 10ms per request, so this matters.
const instances = new WeakMap<D1Database, Db>();

export function getDb(DB: D1Database): Db {
  let db = instances.get(DB);
  if (!db) {
    db = drizzle(DB, { schema });
    instances.set(DB, db);
  }
  return db;
}
