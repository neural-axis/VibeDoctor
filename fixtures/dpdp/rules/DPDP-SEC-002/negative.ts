import OpenAI from "openai";

// LLM provider present, but no chat/message content with personal-data keywords
const client = new OpenAI({ apiKey: "sk-test" });

export async function embedTicket(ticketId: string) {
  return client.embeddings.create({
    model: "text-embedding-3-small",
    input: `ticket:${ticketId}`
  });
}

export type Account = { contact_address: string };

export function storeAccount(account: Account) {
  return { contact_address: account.contact_address };
}
