export function registerChild(input: { date_of_birth: string; email: string }) {
  const is_child = true;
  const under_18 = true;
  // age_gate without parental_consent / guardian_consent
  return { status: "registered", is_child, under_18, email: input.email, date_of_birth: input.date_of_birth };
}

export function age_gate(years: number) {
  return years < 18;
}
