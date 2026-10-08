import type { ConsentDescription, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./types";

// Single-user consent page. When a client (claude.ai) connects, the owner approves it
// by typing AUTH_PASSPHRASE. Only redirect targets on ALLOWED_REDIRECT_HOSTS are
// accepted, so even a correct passphrase can't hand a token to an arbitrary site.

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

// Hash both sides first so timingSafeEqual always compares equal-length buffers.
async function passphraseMatches(given: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function redirectAllowed(desc: ConsentDescription, env: Env): boolean {
  const allowed = (env.ALLOWED_REDIRECT_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(desc.redirectHost.toLowerCase());
}

function page(body: string, status = 200, headers?: Headers): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to To-Do</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f4; --card: #fff; --fg: #1d1d1b; --muted: #6b6b66; --accent: #2f6f4f; --err: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #171716; --card: #222220; --fg: #ececea; --muted: #a3a39e; --accent: #6fbf94; --err: #f2b8b5; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(420px, calc(100vw - 32px)); background: var(--card); border-radius: 14px; padding: 24px; box-sizing: border-box; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { margin: 0 0 12px; } .muted { color: var(--muted); font-size: 14px; } .err { color: var(--err); }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit; border-radius: 8px;
          border: 1px solid var(--muted); background: transparent; color: inherit; margin: 4px 0 16px; }
  .row { display: flex; gap: 8px; }
  button { flex: 1; padding: 10px; font: inherit; border-radius: 8px; border: 1px solid var(--accent); cursor: pointer; }
  button[value=approve] { background: var(--accent); color: var(--card); }
  button[value=deny] { background: transparent; color: var(--fg); border-color: var(--muted); }
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: h }
  );
}

function consentForm(desc: ConsentDescription, handle: string, error?: string): string {
  return `<h1>Connect to your To-Do list?</h1>
<p><strong>${escapeHtml(desc.clientName)}</strong> wants to read and edit your tasks and shopping list.</p>
<p class="muted">Access will be sent to <strong>${escapeHtml(desc.redirectHost)}</strong>.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <label for="pp">Passphrase</label>
  <input id="pp" name="passphrase" type="password" autocomplete="current-password" autofocus>
  <div class="row">
    <button type="submit" name="action" value="deny">Cancel</button>
    <button type="submit" name="action" value="approve">Allow</button>
  </div>
</form>`;
}

export const authHandler: ExportedHandler<AuthEnv> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });

    const oauth = env.OAUTH_PROVIDER;

    if (request.method === "GET") {
      let authRequest;
      try {
        authRequest = await oauth.parseAuthRequest(request);
      } catch (err) {
        return page(`<h1>Invalid request</h1><p>${escapeHtml(String(err))}</p>`, 400);
      }
      const desc = await oauth.describeConsent(authRequest);
      if (!redirectAllowed(desc, env)) {
        return page(
          `<h1>Not allowed</h1><p>Connections that send access to <strong>${escapeHtml(desc.redirectHost)}</strong> aren't permitted.</p>`,
          403
        );
      }
      const tx = await oauth.beginConsent(authRequest);
      return page(consentForm(desc, tx.handle), 200, tx.headers);
    }

    if (request.method === "POST") {
      try {
        return await submitConsent(request, env);
      } catch (err) {
        // Expired, replayed, or opened in a different browser than the form came from.
        console.warn("Consent submission rejected:", err);
        return page(
          "<h1>This sign-in has expired</h1><p>Start connecting again from Claude.</p>",
          400
        );
      }
    }

    return new Response("Method not allowed", { status: 405 });
  },
};

async function submitConsent(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");

  if (form.get("action") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    const h = new Headers(denied.headers);
    h.set("Location", denied.redirectTo);
    return new Response(null, { status: 302, headers: h });
  }

  if (!(await passphraseMatches(String(form.get("passphrase") ?? ""), env.AUTH_PASSPHRASE))) {
    // Slow down guessing; the handle stays valid so the form can be retried.
    await new Promise((r) => setTimeout(r, 1000));
    const authRequest = await oauth.parseAuthRequest(request);
    const desc = await oauth.describeConsent(authRequest);
    return page(consentForm(desc, handle, "Wrong passphrase."), 401);
  }

  const approved = await oauth.approveConsent(request, handle);
  const desc = await oauth.describeConsent(approved.request);
  if (!redirectAllowed(desc, env)) return page("<h1>Not allowed</h1>", 403);

  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: "owner",
    metadata: { clientName: desc.clientName },
    scope: approved.request.scope,
    props: {},
  });
  const h = new Headers(approved.headers);
  h.set("Location", redirectTo);
  return new Response(null, { status: 302, headers: h });
}
