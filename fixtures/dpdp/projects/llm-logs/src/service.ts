import OpenAI from "openai";

const client = new OpenAI();

export async function handleUser(user: { email: string; phone: string; name: string }) {
  console.log("processing user", user.email, user.phone);
  logger.info("customer payload", user);

  const messages = [
    {
      role: "user" as const,
      content: `Summarise account for ${user.name} email=${user.email} phone=${user.phone}`
    }
  ];

  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });
}

const logger = {
  info: (...args: unknown[]) => console.info(...args)
};
