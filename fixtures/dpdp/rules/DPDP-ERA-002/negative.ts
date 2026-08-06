export type Customer = { email: string };

export async function eraseUser(userId: string) {
  return { hard_delete: true, userId };
}

export function upsertCustomer(customer: Customer) {
  return customer;
}
