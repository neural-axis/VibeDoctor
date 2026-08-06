export type User = { email: string };

export function captureConsent(user: User, opt_in: boolean) {
  return { email: user.email, consent: opt_in, accepted_terms: true };
}
