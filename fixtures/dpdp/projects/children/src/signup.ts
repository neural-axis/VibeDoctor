export function registerChild(input: { date_of_birth: string; email: string }) {
  const age = Number(input.date_of_birth.slice(0, 4));
  if (age > 2010) {
    // under_18 / is_child path without parental_consent / guardian_consent
    return { status: "registered", is_child: true, email: input.email };
  }
  return { status: "registered", is_child: false };
}

export function age_gate(years: number) {
  return years < 18;
}
