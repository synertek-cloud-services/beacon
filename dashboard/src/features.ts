import { reactive } from 'vue';
import type { FeatureKey } from './api';

// Mirrors /v1/admin/settings/features (see worker/src/lib/features.ts).
// Unknown (not loaded yet) counts as on, so a page never flashes a "turned
// off" notice during load; the API's own 403 is the real gate, and api.ts
// flips a feature off here the moment it sees one.
export const featureState = reactive<{ loaded: boolean; features: Partial<Record<FeatureKey, boolean>> }>({
  loaded: false,
  features: {},
});

export function featureOn(key: FeatureKey): boolean {
  return featureState.features[key] !== false;
}

export function setFeatures(features: Record<FeatureKey, boolean>): void {
  featureState.features = { ...features };
  featureState.loaded = true;
}

export function markFeatureOff(key: FeatureKey): void {
  featureState.features = { ...featureState.features, [key]: false };
}

// True for the error api.ts throws on a 403 from a switched-off feature.
export function isFeatureDisabled(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'feature_disabled';
}
