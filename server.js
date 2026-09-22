#!/usr/bin/env node
// MCP server over the Docmost REST API (local, stdio transport).
//
// Docmost's built-in MCP endpoint requires an enterprise licence, while the
// ordinary REST API is open in the Community Edition. This server is a thin
// wrapper over that API.
//
// Authentication: if the config carries an apiKey it is sent as a Bearer
// token. Otherwise the server logs in with email and password and keeps the
// session cookie, re-authenticating whenever it expires.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Docmost } from "./lib/docmost-client.js";
import { registerDocmostTools } from "./lib/tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.DOCMOST_MCP_CONFIG || join(__dirname, "config.json");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`config file not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.url) {
    console.error("config is missing 'url'");
    process.exit(1);
  }
  if (!cfg.apiKey && !(cfg.email && cfg.password)) {
    console.error("config needs either 'apiKey' or an 'email'/'password' pair");
    process.exit(1);
  }
  return cfg;
}

const cfg = loadConfig();
const dm = new Docmost(cfg);

const server = new McpServer({ name: "docmost", version: "1.0.0" });
registerDocmostTools(server, dm);

const transport = new StdioServerTransport();
await server.connect(transport);
