import OpenAI from "openai";

const client = new OpenAI({ apiKey: "sk-test" });

export async function summarise(user: { email: string; phone: string; name: string }) {
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: `Profile: ${user.email} ${user.phone} ${user.name}` }]
  });
}
