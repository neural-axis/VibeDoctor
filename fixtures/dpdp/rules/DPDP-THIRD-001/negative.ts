import mixpanel from "mixpanel";

const analytics = mixpanel.init("token");

export function trackPageView(path: string) {
  analytics.track("page_view", { path, anonymized: true });
  return { ok: true };
}
