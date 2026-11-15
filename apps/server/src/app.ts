import { Hono } from "hono";
import { greet } from "@agentcall/shared";

const GREETINGS = [
  { language: "English", text: "Hello, World!" },
  { language: "Spanish", text: "¡Hola, Mundo!" },
  { language: "French", text: "Bonjour, le Monde !" },
  { language: "German", text: "Hallo, Welt!" },
  { language: "Hindi", text: "नमस्ते, दुनिया!" },
  { language: "Japanese", text: "こんにちは、世界！" },
  { language: "Portuguese", text: "Olá, Mundo!" },
  { language: "Swahili", text: "Habari, Dunia!" },
] as const;

export const app = new Hono();

app.get("/", (c) => c.text("Hello, World!"));

app.get("/health", (c) => c.json({ ok: true }));

app.get("/hello", (c) => c.json({ message: greet(c.req.query("name") ?? "World") }));

app.get("/hello/random", (c) => {
  const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]!;
  return c.json(greeting);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
