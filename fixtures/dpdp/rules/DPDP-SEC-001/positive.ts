export type User = { email: string; phone: string };

export function logUser(user: User) {
  console.log("fetch user", user.email, user.phone);
  return user;
}
