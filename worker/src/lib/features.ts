import { eq } from 'drizzle-orm';
import { getDb } from './db';
import * as schema from '../db/schema';
import type { Bindings } from '../index';

// Opt-in switches for features that spend Cloudflare free-tier budget
// (docs/SCALABILITY_DESIGN.md). Off by default on a fresh install; migration
// 0087 turns them all on for an install that already has devices. A managed
// host can force everything on with FEATURES_ALL=true.
export const FEATURE_KEYS = [
  'discovery',
  'application_components',
  'webhooks',
  'os_update_management',
  'agent_monitors',
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];
export type Features = Record<FeatureKey, boolean>;

type Env = Pick<Bindings, 'DB' | 'FEATURES_ALL'>;

// Same short per-isolate TTL as the policy and maintenance caches: the hot
// callers (cron, check-in) shouldn't pay a D1 read for a setting that changes
// a few times a year. A PATCH clears this isolate's entry immediately; other
// isolates catch up within the TTL.
const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: Features } | null = null;

export function invalidateFeatureCache(): void {
  cache = null;
}

export function featuresForced(env: Pick<Bindings, 'FEATURES_ALL'>): boolean {
  return env.FEATURES_ALL === 'true';
}

export async function getFeatures(env: Env): Promise<Features> {
  if (featuresForced(env)) {
    return Object.fromEntries(FEATURE_KEYS.map(k => [k, true])) as Features;
  }
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const row = await getDb(env.DB).select().from(schema.hostSettings).where(eq(schema.hostSettings.id, 1)).get();
  const value: Features = {
    discovery:              row?.featureDiscovery ?? false,
    application_components: row?.featureApplicationComponents ?? false,
    webhooks:               row?.featureWebhooks ?? false,
    os_update_management:   row?.featureOsUpdateManagement ?? false,
    agent_monitors:         row?.featureAgentMonitors ?? false,
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function featureEnabled(env: Env, key: FeatureKey): Promise<boolean> {
  return (await getFeatures(env))[key];
}

// Column to write for each key (PATCH /v1/admin/settings/features).
export const FEATURE_COLUMNS = {
  discovery:              'featureDiscovery',
  application_components: 'featureApplicationComponents',
  webhooks:               'featureWebhooks',
  os_update_management:   'featureOsUpdateManagement',
  agent_monitors:         'featureAgentMonitors',
} as const satisfies Record<FeatureKey, keyof typeof schema.hostSettings.$inferInsert>;
