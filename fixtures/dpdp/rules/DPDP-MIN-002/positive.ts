export async function listCustomers(db: { findMany: () => Promise<unknown> }) {
  // Broad database selection on personal-data model
  return db.findMany();
}

export type Customer = { email: string; phone: string };
