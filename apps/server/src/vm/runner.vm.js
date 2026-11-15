// agentcall runner. Runs inside the user's instabox VM under Bun:
//   bun runner.js <runDir>
//
// <runDir>/task.json holds the task (no secrets). Secrets arrive only as
// environment variables of this process, never on disk:
//   AGENTCALL_CALLBACK_TOKEN  bearer token for this run's callbacks
//   OPENCODE_API_KEY          the user's OpenCode key
//   GH_TOKEN                  short-lived agentcall GitHub App installation token (optional)
//
// Every step is reported to the server (callbackUrl) and appended to
// <runDir>/events.jsonl, which the server reads if a callback is lost.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const runDir = process.argv[2];
const task = JSON.parse(readFileSync(join(runDir, "task.json"), "utf8"));
const token = process.env.AGENTCALL_CALLBACK_TOKEN;
const work = join(runDir, "work");
const artifacts = join(runDir, "artifacts");
mkdirSync(artifacts, { recursive: true });

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

async function report(type, message, data = {}) {
  const event = { type, message, data, at: new Date().toISOString() };
  appendFileSync(join(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${task.callbackUrl}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok || res.status < 500) return;
    } catch {
      // network blip: retry
    }
    await Bun.sleep(1000 * 2 ** attempt);
  }
}

async function uploadArtifact(path, name) {
  const size = statSync(path).size;
  if (size > MAX_ARTIFACT_BYTES) return null;
  const res = await fetch(`${task.callbackUrl}/artifacts?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: Bun.file(path),
    signal: AbortSignal.timeout(120000),
  }).catch(() => null);
  return res?.ok ? name : null;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? work, env: { ...process.env, ...opts.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
      opts.onStdout?.(d.toString());
    });
    child.stderr.on("data", (d) => (err += d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

async function must(cmd, args, opts) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args[0]} failed: ${(r.err || r.out).trim().slice(-800)}`);
  return r.out.trim();
}

// git reads the token from the environment through this helper; nothing is written to .git/config.
const GIT_AUTH = [
  "-c",
  "credential.helper=",
  "-c",
  'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f',
];
const git = (...args) => must("git", [...GIT_AUTH, ...args]);

function buildPrompt() {
  return [
    `You are "${task.botName}", an AI teammate working through agentcall.`,
    `Your role: ${task.botPurpose}`,
    task.botInstructions ? `Team instructions:\n${task.botInstructions}` : "",
    task.repo
      ? `You are in a checkout of ${task.repo} on branch ${task.branch}. Make focused changes. Do not commit or push; agentcall does that after you finish.`
      : "There is no repository checked out for this task.",
    "You run on a Linux VM with Bun, Node.js, Python, git and Chromium. A desktop is available for browser testing.",
    `Save evidence (screenshots, logs, recordings) to ${artifacts}. When you test the product, take screenshots of each important step.`,
    `When you are done, write a short report in Markdown to ${join(artifacts, "summary.md")}: what you found, what you changed and how to verify it.`,
    "",
    "Task from the team:",
    task.prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runOpencode() {
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: task.model,
    autoupdate: false,
    share: "disabled",
    provider: { opencode: { options: { apiKey: "{env:OPENCODE_API_KEY}" } } },
  };
  const configPath = join(runDir, "opencode.json");
  writeFileSync(configPath, JSON.stringify(config));

  let lastProgress = 0;
  let finalText = "";
  let error = null;
  let buffer = "";
  const onStdout = (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "error") error = event.error?.data?.message ?? event.error?.name ?? "OpenCode error";
      const part = event.part ?? {};
      if (event.type === "text" && part.text) finalText = part.text;
      const tool = part.tool ?? (event.type === "tool_use" ? event.tool : null);
      if (tool && Date.now() - lastProgress > 20000) {
        lastProgress = Date.now();
        const title = part.state?.title ?? tool;
        report("progress", `Working: ${title}`.slice(0, 200));
      }
    }
  };

  const args = ["run", "--format", "json", "--dangerously-skip-permissions", "-m", task.model, "--title", task.title, buildPrompt()];
  const r = await run("opencode", args, {
    cwd: existsSync(work) ? work : runDir,
    env: { OPENCODE_CONFIG: configPath },
    timeoutMs: task.timeoutMinutes * 60000,
    onStdout,
  });
  if (error) throw new Error(error);
  if (r.code !== 0) throw new Error(`opencode exited with ${r.code}: ${r.err.trim().slice(-500)}`);
  return finalText;
}

function markdownToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const out = [];
  let code = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) {
      if (code === null) code = [];
      else {
        out.push(`<pre>${esc(code.join("\n"))}</pre>`);
        code = null;
      }
      continue;
    }
    if (code !== null) code.push(line);
    else if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
    } else if (/^\s*[-*] /.test(line)) out.push(`<li>${inline(line.replace(/^\s*[-*] /, ""))}</li>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join("\n");
}

async function buildPdf(summary, prUrl) {
  const shots = readdirSync(artifacts)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .slice(0, 12)
    .map((f) => {
      const data = readFileSync(join(artifacts, f)).toString("base64");
      const type = f.toLowerCase().endsWith(".png") ? "png" : "jpeg";
      return `<figure><img src="data:image/${type};base64,${data}"/><figcaption>${f}</figcaption></figure>`;
    })
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:40px}
    header{border-bottom:2px solid #f6c35b;padding-bottom:12px;margin-bottom:24px}
    h1{font-size:22px;margin:0} .meta{color:#666;font-size:12px;margin-top:6px}
    pre{background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:12px}
    code{background:#f5f5f5;padding:1px 4px;border-radius:4px} img{max-width:100%;border:1px solid #ddd;border-radius:6px}
    figure{margin:20px 0;page-break-inside:avoid} figcaption{color:#666;font-size:11px}
  </style></head><body><header><h1>${task.title.replace(/</g, "&lt;")}</h1>
  <div class="meta">${task.botName} · agentcall · ${new Date().toUTCString()}${task.repo ? ` · ${task.repo}` : ""}${prUrl ? ` · <a href="${prUrl}">${prUrl}</a>` : ""}</div></header>
  ${markdownToHtml(summary)}${shots ? `<h2>Evidence</h2>${shots}` : ""}</body></html>`;
  const htmlPath = join(runDir, "report.html");
  const pdfPath = join(artifacts, "report.pdf");
  writeFileSync(htmlPath, html);
  const browser = existsSync("/usr/bin/chromium") ? "chromium" : "google-chrome";
  const r = await run(
    browser,
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`],
    { cwd: runDir, timeoutMs: 120000 },
  );
  return r.code === 0 && existsSync(pdfPath) ? pdfPath : null;
}

async function openPullRequest(summary) {
  const status = await must("git", ["status", "--porcelain"]);
  if (!status) return null;
  await must("git", ["add", "-A"]);
  await must("git", ["-c", "user.name=agentcall[bot]", "-c", "user.email=agentcall[bot]@users.noreply.github.com", "commit", "-m", task.title]);
  await git("push", "-u", "origin", task.branch);
  const res = await fetch(`https://api.github.com/repos/${task.repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "agentcall",
    },
    body: JSON.stringify({
      title: task.title,
      head: task.branch,
      base: task.baseBranch,
      body: `${summary}\n\n---\nOpened by **${task.botName}** via agentcall.`,
    }),
  });
  if (!res.ok) throw new Error(`Opening the PR failed: ${res.status} ${await res.text()}`);
  return (await res.json()).html_url;
}

const heartbeat = setInterval(() => report("heartbeat", "alive"), 30000);

try {
  await report("started", "Agent started on the VM");
  if (task.repo) {
    await report("progress", `Cloning ${task.repo}`);
    await must("git", [...GIT_AUTH, "clone", "--depth", "50", "--branch", task.baseBranch, `https://github.com/${task.repo}.git`, work], { cwd: runDir });
    await must("git", ["checkout", "-b", task.branch]);
  }
  await report("progress", "Thinking it through with OpenCode");
  const finalText = await runOpencode();
  const summaryPath = join(artifacts, "summary.md");
  const summary = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8").trim() : finalText.trim() || "Done.";

  let prUrl = null;
  if (task.repo) {
    await report("progress", "Opening a pull request");
    prUrl = await openPullRequest(summary);
  }

  await report("progress", "Writing the report");
  const pdf = await buildPdf(summary, prUrl);
  const uploaded = [];
  if (pdf && (await uploadArtifact(pdf, "report.pdf"))) uploaded.push("report.pdf");
  for (const f of readdirSync(artifacts)) {
    if (/\.(mp4|webm|gif)$/i.test(f) && (await uploadArtifact(join(artifacts, f), f))) uploaded.push(f);
  }

  writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "done", summary, prUrl }));
  await report("done", summary.slice(0, 3500), { prUrl, artifacts: uploaded });
} catch (e) {
  const message = String(e?.message ?? e).slice(0, 2000);
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "failed", error: message }));
  await report("failed", message);
} finally {
  clearInterval(heartbeat);
  // Keep the events and status for the server; drop the checkout and evidence.
  rmSync(work, { recursive: true, force: true });
  rmSync(artifacts, { recursive: true, force: true });
}
