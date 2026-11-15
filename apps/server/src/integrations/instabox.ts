// Minimal client for the instabox.sh HTTP API (https://instabox.sh/docs/api.md).
// Raw fetch instead of the SDK: we need few calls and want the bundle small.

const API = "https://api.instabox.sh";

export type MachineState =
  | "creating"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "suspending"
  | "suspended"
  | "resuming"
  | "deleting"
  | "deleted"
  | "error";

export interface Machine {
  id: string;
  name: string;
  state: MachineState;
  metadata?: Record<string, string>;
}

export interface Operation {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed";
  type: string;
  machineId?: string;
  phase?: string;
  error?: { code?: string; message?: string } | null;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  truncated?: boolean;
  oomKilled?: boolean;
}

export interface Usage {
  machines: number;
  limits: { maxMachines: number; machineSpec: { vcpus: number; memMiB: number } };
  org: { id: string; name: string; tier: string };
}

export class InstaboxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "InstaboxError";
  }
}

type RequestOptions = {
  body?: unknown;
  raw?: NonNullable<RequestInit["body"]>;
  query?: Record<string, string>;
  idempotent?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export class Instabox {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = API,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "X-API-Key": this.apiKey, ...opts.headers };
    let body: NonNullable<RequestInit["body"]> | undefined = opts.raw;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    // One key per logical call, reused across our retries so a retry never acts twice.
    if (opts.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const type = res.headers.get("content-type") ?? "";
        return (type.includes("json") ? await res.json() : await res.text()) as T;
      }
      const err = await toError(res);
      if (err.retryable && attempt < 3) {
        await Bun.sleep(Math.min(30, err.retryAfterSeconds ?? 2 ** attempt) * 1000);
        continue;
      }
      throw err;
    }
  }

  /** Cheapest authenticated call: validates a key and returns the plan's limits. */
  usage() {
    return this.request<Usage>("GET", "/v1/usage");
  }

  getMachine(id: string) {
    return this.request<Machine>("GET", `/v1/machines/${id}`);
  }

  async listMachines(): Promise<Machine[]> {
    const res = await this.request<{ machines: Machine[] }>("GET", "/v1/machines");
    return res.machines;
  }

  async createMachine(input: { name: string; metadata?: Record<string, string> }): Promise<Machine> {
    const op = await this.request<Operation>("POST", "/v1/machines", {
      // agent-browser: Debian with git, Node.js, Bun and Chromium; the free plan allows it.
      body: { name: input.name, templateId: "agent-browser", metadata: input.metadata ?? {}, vault: false },
      idempotent: true,
    });
    const done = await this.waitOperation(op.id, 10 * 60_000);
    return this.getMachine(done.machineId ?? op.machineId!);
  }

  async waitOperation(id: string, timeoutMs = 5 * 60_000): Promise<Operation> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const op = await this.request<Operation>("GET", `/v1/operations/${id}`, {
        query: { wait: "25s" },
        timeoutMs: 40_000,
      });
      if (op.state === "succeeded") return op;
      if (op.state === "failed") {
        throw new InstaboxError(500, op.error?.code ?? "operation_failed", op.error?.message ?? `${op.type} failed`);
      }
    }
    throw new InstaboxError(504, "operation_timeout", `operation ${id} did not finish in time`);
  }

  /** Brings a paused or stopped machine back so commands can run in it. */
  async ensureRunning(id: string): Promise<Machine> {
    for (let i = 0; i < 20; i++) {
      const m = await this.getMachine(id);
      switch (m.state) {
        case "running":
          return m;
        case "suspended":
          await this.lifecycle(id, "resume");
          break;
        case "stopped":
          await this.lifecycle(id, "start");
          break;
        case "deleted":
        case "deleting":
        case "error":
          throw new InstaboxError(409, "machine_unavailable", `machine is ${m.state}`);
        default:
          // creating, starting, resuming, stopping, suspending: let it settle.
          await Bun.sleep(3000);
      }
    }
    throw new InstaboxError(504, "machine_not_ready", "machine did not reach running");
  }

  private async lifecycle(id: string, action: "resume" | "start" | "stop" | "suspend") {
    const op = await this.request<Operation>("POST", `/v1/machines/${id}/${action}`, { idempotent: true });
    await this.waitOperation(op.id);
  }

  exec(
    id: string,
    input: {
      cmd?: string;
      argv?: string[];
      envs?: Record<string, string>;
      cwd?: string;
      stdin?: string;
      timeoutSeconds?: number;
      noHistory?: boolean;
    },
  ) {
    const timeoutSeconds = Math.min(input.timeoutSeconds ?? 60, 600);
    return this.request<ExecResult>("POST", `/v1/machines/${id}/exec`, {
      body: { ...input, timeoutSeconds },
      timeoutMs: (timeoutSeconds + 30) * 1000,
    });
  }

  writeFile(id: string, path: string, content: string | Uint8Array, mode?: string) {
    return this.request("PUT", `/v1/machines/${id}/files`, {
      raw: content,
      query: { path, parents: "true", ...(mode ? { mode } : {}) },
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  async readFile(id: string, path: string): Promise<Uint8Array> {
    const url = new URL(`/v1/machines/${id}/files/content`, this.baseUrl);
    url.searchParams.set("path", path);
    const res = await this.fetchImpl(url, { headers: { "X-API-Key": this.apiKey } });
    if (!res.ok) throw await toError(res);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Keeps the machine awake while a run works; renew before `ttlSeconds` runs out. */
  holdAwake(id: string, leaseId: string, ttlSeconds = 600) {
    return this.request("PUT", `/v1/machines/${id}/activity-leases/${leaseId}`, { body: { ttlSeconds } });
  }

  releaseAwake(id: string, leaseId: string) {
    return this.request("DELETE", `/v1/machines/${id}/activity-leases/${leaseId}`).catch(() => undefined);
  }

  async deleteMachine(id: string) {
    const op = await this.request<Operation>("DELETE", `/v1/machines/${id}`, {
      idempotent: true,
      headers: { "X-Confirm-Delete": id },
    });
    if (op?.id) await this.waitOperation(op.id);
  }
}

async function toError(res: Response): Promise<InstaboxError> {
  let body: { error?: { code?: string; message?: string; retryable?: boolean; retryAfterSeconds?: number } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // non-JSON error body
  }
  const e = body.error ?? {};
  const retryAfter = Number(res.headers.get("retry-after")) || e.retryAfterSeconds;
  return new InstaboxError(
    res.status,
    e.code ?? `http_${res.status}`,
    e.message ?? res.statusText,
    e.retryable ?? (res.status === 429 || res.status === 503),
    retryAfter,
  );
}
