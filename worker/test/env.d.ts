import type { Bindings } from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}

export {};
