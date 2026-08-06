export function registerMinor(input: { date_of_birth: string; email: string; guardian_consent: boolean }) {
  if (!input.guardian_consent) {
    return { blocked: true };
  }
  return {
    is_child: true,
    under_18: true,
    parental_consent: true,
    guardian_consent: input.guardian_consent,
    email: input.email
  };
}
