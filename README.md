# Docmost MCP Server

An [MCP](https://modelcontextprotocol.io) server over the [Docmost](https://docmost.com) REST API. Docmost's built-in MCP endpoint requires an enterprise licence, while the ordinary REST API is open in the Community Edition — this server is a thin wrapper over that API, exposed as MCP tools.

Two ways to run it, sharing the same tool implementation (`lib/`):

- **[server.js](server.js)** — local, stdio transport, single set of credentials in a config file. Meant to be spawned by Claude Desktop.
- **[remote/](remote/)** — hosted, Streamable HTTP transport, multi-tenant. Each user connects with their own Docmost credentials via a self-service web form; a bearer token in the URL identifies which tenant to use.

## Tools

| Tool | Description |
|---|---|
| `list_spaces` | List the spaces in the workspace |
| `search` | Full-text search across pages, optionally scoped to one space |
| `get_page` | Fetch a page and its content (as markdown) by id or slugId |
| `recent_pages` | List recently changed pages |
| `create_page` | Create a page, optionally with a body (markdown or html) |
| `update_page` | Update a page's title and/or body |
| `move_page` | Move a page under a different parent |
| `delete_page` | Delete a page (trash or permanent) |

### A note on page bodies

Docmost's REST `/pages/create` and `/pages/update` accept a `content` field but silently ignore it — the page body lives in a Yjs collaboration document (CRDT, synced over a Hocuspocus WebSocket), not in the row those endpoints touch. This is a known, unresolved limitation of Docmost itself ([docmost/docmost#980](https://github.com/docmost/docmost/discussions/980), [#133](https://github.com/docmost/docmost/issues/133)), not something specific to this server.

To actually read and write bodies, this server instead:

- **Reads** via `/pages/export` (the endpoint the UI's "export" feature uses), not `/pages/info`.
- **Creates with content** via `/pages/import`, which runs Docmost's own markdown/html → Yjs converter and persists the result directly. Fast (no extra latency).
- **Updates content on an existing page** by writing straight to its Yjs document over the collaboration WebSocket: the new content is imported into a throwaway temporary page (to get Docmost's own converter output), cloned into the target page's document, and the temp page is deleted. The server debounces persistence by ~10s (up to 45s worst case), so `update_page` with a `content` change takes **~12 seconds** to return.

See `lib/collab.js` for the implementation details.

## Local setup (Claude Desktop)

```bash
npm install
cp config.example.json config.json
```

Edit `config.json` with your Docmost URL and either an `apiKey`, or an `email`/`password` pair:

```json
{
  "url": "https://docs.example.com",
  "apiKey": "",
  "email": "you@example.com",
  "password": "..."
}
```

Then point Claude Desktop's `claude_desktop_config.json` at the server:

```json
{
  "mcpServers": {
    "docmost": {
      "command": "node",
      "args": ["C:\\path\\to\\docmost-mcp\\server.js"]
    }
  }
}
```

Restart Claude Desktop. `DOCMOST_MCP_CONFIG` can override the config file path if you don't want it next to `server.js`.

## Remote setup (self-hosted, multi-tenant)

`remote/` runs an Express server that speaks MCP over Streamable HTTP (stateless — one request in, one response out, no server-side session). Tenants are stored in Redis, keyed by a random token; passwords and API keys are encrypted at rest with AES-256-GCM.

Onboarding is self-service: a user visits `/setup`, enters their Docmost URL and credentials, the server verifies them against Docmost before storing anything, then hands back a personal `https://<host>/mcp/<token>` URL to add as a custom MCP connector.

### Environment variables

| Variable | Description |
|---|---|
| `MASTER_KEY` | 32-byte hex key (64 chars) used to encrypt stored credentials. Generate with `openssl rand -hex 32`. Losing it makes stored credentials unrecoverable; leaking it exposes every tenant's password/apiKey. |
| `BASE_URL` | Public URL this server is reachable at, e.g. `https://mcp.example.com` — used to build the `/mcp/<token>` link shown after setup. |
| `REDIS_URL` | Defaults to `redis://localhost:6379`. |
| `PORT` | Defaults to `3000`. |

### Run locally with Docker Compose

```bash
cp .env.example .env
# fill in MASTER_KEY (openssl rand -hex 32) and BASE_URL in .env
docker compose up -d --build
```

Then open `http://localhost:3000/setup`.

### Deploy on Coolify

1. Push this repo to GitHub/GitLab (already done if you're reading this there).
2. In Coolify: new resource → **Docker Compose**, pointed at this repo.
3. Set `MASTER_KEY` and `BASE_URL` as environment variables in Coolify — never commit them.
4. Attach a domain to the `app` service on port `3000`; Coolify handles TLS via Let's Encrypt.
5. Visit `https://<your-domain>/setup`, connect your Docmost account, and paste the resulting `/mcp/<token>` URL into Claude as a custom connector.

## Security notes

- The `/mcp/<token>` URL is a bearer secret — anyone with it has full API access to that Docmost account. Treat it like a password.
- `MASTER_KEY` must only live in the deployment environment (Coolify env vars, or a local `.env`), never in the repo. Both `config.json` and `.env` are gitignored.
- The remote server must be served over HTTPS in production so the token isn't sent in cleartext.

## Project structure

```
lib/
  docmost-client.js  REST client (spaces, search, pages, import, export, collab token)
  collab.js          Yjs/Hocuspocus WebSocket client — the only way to write an existing page's body
  tools.js           MCP tool definitions, shared by both servers
server.js            Local stdio MCP server (Claude Desktop)
remote/
  index.js           Express app: /setup form, /mcp/:token endpoint
  crypto.js           AES-256-GCM encrypt/decrypt for stored credentials
  redis.js            Tenant storage
  setup-page.js        HTML for the self-service onboarding form
Dockerfile, docker-compose.yaml   Container build + local Redis for the remote server
```
