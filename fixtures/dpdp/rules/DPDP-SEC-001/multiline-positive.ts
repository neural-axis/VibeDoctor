export type User = { email: string; phone: string };

export function logUser(user: User) {
  console.log(
    "processing",
    user.email,
    user.phone
  );
  return user;
}
