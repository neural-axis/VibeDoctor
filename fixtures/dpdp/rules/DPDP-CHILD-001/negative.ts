export type User = { email: string };

export function registerAdult(user: User) {
  return { email: user.email, status: "registered" };
}
