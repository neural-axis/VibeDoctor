export type User = { email: string };

export function register(user: User) {
  return { email: user.email, registered: true };
}
