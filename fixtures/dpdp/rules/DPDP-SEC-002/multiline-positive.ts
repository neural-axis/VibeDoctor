import OpenAI from "openai";

const client = new OpenAI({ apiKey: "sk-test" });

export async function summarise(user: { email: string; name: string }) {
  const messages = [
    {
      role: "user" as const,
      content: `Account summary for ${user.name}`
    },
    {
      role: "user" as const,
      content: `email=${user.email}`
    }
  ];

  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });
}
