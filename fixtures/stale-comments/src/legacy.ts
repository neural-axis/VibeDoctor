// TODO remove old auth fallback later
// const oldClient = createClient()
const LEGACY_AUTH_ENABLED = false;

export function currentAuth() {
  if (LEGACY_AUTH_ENABLED) {
    return "legacy";
  }
  return "current";
}
