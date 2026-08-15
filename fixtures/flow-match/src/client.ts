export async function createUser(name: string): Promise<void> {
  await fetch("/api/user", { method: "POST" });
  console.log(name);
}
