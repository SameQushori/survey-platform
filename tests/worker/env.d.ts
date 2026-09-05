declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../../worker/index");
  }

  interface Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
