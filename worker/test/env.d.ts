import type { Bindings } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}

export {};
