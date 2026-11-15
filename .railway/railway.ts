import { defineRailway, github, project, service } from "railway/iac";

// Railway infrastructure as code. Preview with `railway config plan`,
// then apply with `railway config apply`.
export default defineRailway(() => {
  const server = service("server", {
    source: github("rk4231954-bot/agentcall", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      // Build context stays at the repo root so workspace packages resolve.
      dockerfilePath: "apps/server/Dockerfile",
      watchPatterns: ["apps/server/**", "packages/shared/**", "package.json", "bun.lock"],
    },
    deploy: {
      healthcheckPath: "/health",
      healthcheckTimeout: 60,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
  });

  return project("agentcall", { resources: [server] });
});
