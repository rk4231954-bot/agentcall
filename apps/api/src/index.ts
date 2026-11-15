import { greet } from "@agentcall/shared";

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    return new Response(greet(url.searchParams.get("name") ?? "agentcall"));
  },
});

console.log(`api listening on ${server.url}`);
