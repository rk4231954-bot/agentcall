import { greet } from "@agentcall/shared";

export function createServer(port: number | string = process.env.PORT ?? 3000) {
  return Bun.serve({
    port,
    routes: {
      "/health": Response.json({ ok: true }),
      "/": (req) => new Response(greet(new URL(req.url).searchParams.get("name") ?? "agentcall")),
    },
    fetch() {
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
}
