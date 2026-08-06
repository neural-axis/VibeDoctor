import mixpanel from "mixpanel";

const analytics = mixpanel.init("token");

export type User = { email: string; phone: string };

export function trackChat(user: User) {
  analytics.track("chat", { user });
  return { ok: true };
}
