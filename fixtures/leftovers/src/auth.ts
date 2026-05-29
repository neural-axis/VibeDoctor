// TODO remove old auth fallback later
export function legacyAuthFallback() {
  return "legacy";
}

export function currentAuth() {
  // const oldClient = createClient()
  return legacyAuthFallback();
}
