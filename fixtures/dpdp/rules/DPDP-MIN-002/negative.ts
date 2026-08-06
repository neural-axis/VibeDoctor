export async function listCustomers(db: { query: (sql: string) => Promise<unknown> }) {
  return db.query("select id, status from customers where active = 1");
}

export type Customer = { email: string };
