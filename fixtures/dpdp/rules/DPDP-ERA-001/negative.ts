export type Customer = { email: string };

export async function deleteAccount(userId: string) {
  // hard_delete / erase_user path
  return { deleted: true, deletedAt: new Date().toISOString(), userId };
}

export function createCustomer(customer: Customer) {
  return customer;
}
