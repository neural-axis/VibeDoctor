export function registerMinor(input: { date_of_birth: string; email: string }) {
  return { is_child: true, under_18: true, email: input.email, age_gate: true };
}
