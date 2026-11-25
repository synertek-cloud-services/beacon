import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  // Every migration, applied to a throwaway D1 for each test file (see
  // test/apply-migrations.ts), so tests run against the real schema + seeded
  // default policies rather than hand-built tables.
  const migrations = await readD1Migrations(path.join(import.meta.dirname, '..', 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.test.toml' },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
