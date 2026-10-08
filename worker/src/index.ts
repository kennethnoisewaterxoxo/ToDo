import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authHandler } from "./auth";
import { buildServer } from "./tools";
import type { Env } from "./types";

// Stateless Streamable HTTP: every MCP call is a plain POST answered with JSON.
// Nothing is held between requests, so there is no stream for a proxy to drop
// and no session to lose when an isolate is recycled.
const mcpHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const server = buildServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

// OAuthProvider guards /mcp with bearer tokens and serves the OAuth endpoints
// (discovery metadata, /register, /token). Everything else goes to authHandler,
// which renders the /authorize consent page.
function makeProvider(origin: string) {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpHandler as ExportedHandler<Env> & Pick<Required<ExportedHandler<Env>>, "fetch">,
    defaultHandler: authHandler as ExportedHandler<Env>,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: { resource: `${origin}/mcp`, resource_name: "To-Do" },
    // Clients may identify themselves by a metadata-document URL instead of registering
    // first (newer MCP clients, including Claude). Needs global_fetch_strictly_public.
    clientIdMetadataDocumentEnabled: true,
    // Short-lived access tokens; the refresh token keeps a client connected for 30 days
    // of inactivity before the passphrase is needed again.
    accessTokenTTL: 60 * 60,
    refreshTokenTTL: 30 * 24 * 60 * 60,
  });
}

// The provider needs the server's canonical URL, which isn't known until the first
// deploy picks a *.workers.dev subdomain, so build it from the request's origin.
const providers = new Map<string, ReturnType<typeof makeProvider>>();

export default {
  fetch(request, env, ctx) {
    const origin = new URL(request.url).origin;
    let provider = providers.get(origin);
    if (!provider) providers.set(origin, (provider = makeProvider(origin)));
    return provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
