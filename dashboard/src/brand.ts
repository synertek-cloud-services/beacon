import { reactive } from 'vue';

export const brandState = reactive<{ productName: string; logoUrl: string }>({
  productName: 'Beacon',
  logoUrl: '/brand-mark.svg',
});

export async function loadBrandIdentity(): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);
  try {
    const baseUrl = import.meta.env.VITE_API_URL ?? '';
    const res = await fetch(`${baseUrl}/v1/branding/identity`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return;
    const { productName, logoKey } = await res.json() as { productName?: string; logoKey?: string | null };
    // Always set both, not just when truthy — this is called again after an
    // admin clears a value (BrandingSettingsPage.vue), not only at startup,
    // and needs to be able to revert to the default in both directions.
    brandState.productName = productName?.trim() || 'Beacon';
    brandState.logoUrl = logoKey ? `${baseUrl}/v1/branding/logo/${encodeURIComponent(logoKey)}` : '/brand-mark.svg';
  } catch {
    // Defaults stay active: login must never be held hostage by branding.
  } finally {
    window.clearTimeout(timeout);
    document.title = brandState.productName;
  }
}
