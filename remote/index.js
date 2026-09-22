// Remote, multi-tenant MCP server over the Docmost REST API.
//
// Each tenant is provisioned self-service via a GET /setup web form: the
// user enters their Docmost URL + (email/password OR apiKey), we verify the
// credentials work, encrypt the secret, and store it in Redis under a random
// token. The resulting MCP URL is https://<host>/mcp/<token> — the token is
// a bearer secret that identifies which tenant's Docmost credentials to use.
//
// Transport is stateless Streamable HTTP: every request builds a fresh
// McpServer (cheap — just 8 tool registrations) bound to a Docmost client
// that IS cached across requests per token, so a logged-in session cookie
// survives between calls instead of re-authenticating every time.

import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Docmost } from "../lib/docmost-client.js";
import { registerDocmostTools } from "../lib/tools.js";
import { encrypt, decrypt, checkMasterKey } from "./crypto.js";
import { saveTenant, getTenant } from "./redis.js";
import { renderSetupForm, renderSetupResult, renderSetupError } from "./setup-page.js";

try {
  checkMasterKey();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/setup", (req, res) => {
  res.type("html").send(renderSetupForm());
});

const setupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

app.post("/setup", setupLimiter, async (req, res) => {
  const { url, authMethod, email, password, apiKey } = req.body ?? {};
  if (!url) {
    return res.status(400).type("html").send(renderSetupError("L'URL Docmost est requise."));
  }

  const cfg = { url: url.trim() };
  if (authMethod === "apiKey") {
    if (!apiKey) {
      return res.status(400).type("html").send(renderSetupError("La clé API est requise."));
    }
    cfg.apiKey = apiKey.trim();
  } else {
    if (!email || !password) {
      return res.status(400).type("html").send(renderSetupError("Email et mot de passe sont requis."));
    }
    cfg.email = email.trim();
    cfg.password = password;
  }

  try {
    const probe = new Docmost(cfg);
    await probe.call("/spaces", { limit: 1 });
  } catch (err) {
    return res.status(400).type("html").send(
      renderSetupError(`Connexion à Docmost impossible : ${err.message}`)
    );
  }

  const token = crypto.randomBytes(24).toString("hex");
  await saveTenant(token, {
    url: cfg.url,
    email: cfg.email ?? null,
    passwordEnc: cfg.password ? encrypt(cfg.password) : null,
    apiKeyEnc: cfg.apiKey ? encrypt(cfg.apiKey) : null,
    createdAt: new Date().toISOString(),
  });

  res.type("html").send(renderSetupResult(`${BASE_URL}/mcp/${token}`));
});

// token -> Docmost client, so a login session survives across requests.
const dmCache = new Map();

async function getDocmostClient(token) {
  if (dmCache.has(token)) return dmCache.get(token);
  const tenant = await getTenant(token);
  if (!tenant) return null;
  const dm = new Docmost({
    url: tenant.url,
    email: tenant.email,
    password: tenant.passwordEnc ? decrypt(tenant.passwordEnc) : null,
    apiKey: tenant.apiKeyEnc ? decrypt(tenant.apiKeyEnc) : null,
  });
  dmCache.set(token, dm);
  return dm;
}

app.post("/mcp/:token", async (req, res) => {
  const dm = await getDocmostClient(req.params.token);
  if (!dm) {
    return res.status(404).json({ error: "unknown token — set up this connector again at /setup" });
  }

  const server = new McpServer({ name: "docmost", version: "1.0.0" });
  registerDocmostTools(server, dm);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("mcp request error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "internal error" });
  }
});

app.get("/mcp/:token", (req, res) => {
  res.status(405).json({ error: "method not allowed — this server is stateless, use POST" });
});

app.listen(PORT, () => {
  console.log(`docmost-mcp remote server listening on :${PORT}`);
});
