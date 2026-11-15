import { createSign } from "node:crypto";

const API = "https://api.github.com";

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  clientId?: string;
  clientSecret?: string;
}

export class GitHubApp {
  private readonly privateKey: string;

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // Env vars often carry the PEM with literal "\n".
    this.privateKey = config.privateKey.replace(/\\n/g, "\n");
  }

  installUrl(state: string) {
    return `https://github.com/apps/${this.config.slug}/installations/new?state=${encodeURIComponent(state)}`;
  }

  /** Short-lived JWT that authenticates as the app itself. */
  appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 540, iss: this.config.appId })}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(this.privateKey, "base64url");
    return `${unsigned}.${signature}`;
  }

  private async api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agentcall",
        ...init.headers,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  getInstallation(installationId: number) {
    return this.api<{
      id: number;
      account: { login: string; type: string };
      repository_selection: "all" | "selected";
    }>(`/app/installations/${installationId}`, this.appJwt());
  }

  /**
   * Installation token: acts as the agentcall app (commits and PRs show as
   * agentcall[bot]), expires in an hour, and is narrowed to `repositories`.
   */
  async installationToken(installationId: number, repositories?: string[]) {
    const body = repositories?.length ? { repositories: repositories.map((r) => r.split("/").pop()) } : {};
    return this.api<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      this.appJwt(),
      { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    );
  }

  repo(token: string, fullName: string) {
    return this.api<{ full_name: string; default_branch: string }>(`/repos/${fullName}`, token);
  }

  async listRepos(installationId: number) {
    const { token } = await this.installationToken(installationId);
    const repos: { full_name: string; private: boolean; default_branch: string }[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await this.api<{ repositories: typeof repos; total_count: number }>(
        `/installation/repositories?per_page=100&page=${page}`,
        token,
      );
      repos.push(...res.repositories);
      if (repos.length >= res.total_count || res.repositories.length === 0) break;
    }
    return repos.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch }));
  }

  /**
   * Proves the signed-in user can see this installation, so nobody can attach
   * someone else's installation id. Needs "Request user authorization (OAuth)
   * during installation" enabled on the app, which adds `code` to the callback.
   */
  async userOwnsInstallation(code: string, installationId: number): Promise<boolean> {
    if (!this.config.clientId || !this.config.clientSecret) return false;
    const res = await this.fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code }),
      signal: AbortSignal.timeout(20_000),
    });
    const { access_token } = (await res.json()) as { access_token?: string };
    if (!access_token) return false;
    const { installations } = await this.api<{ installations: { id: number }[] }>(
      "/user/installations?per_page=100",
      access_token,
    );
    return installations.some((i) => i.id === installationId);
  }
}
