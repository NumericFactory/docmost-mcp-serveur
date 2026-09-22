import JSZip from "jszip";

// REST client for the Docmost API. Transparently re-authenticates when the
// session lapses (email/password mode only — an apiKey never expires here).
export class Docmost {
  constructor(cfg) {
    this.base = cfg.url.replace(/\/+$/, "");
    this.apiKey = cfg.apiKey ?? null;
    this.email = cfg.email ?? null;
    this.password = cfg.password ?? null;
    this.token = this.apiKey;
    this.cookie = null;
  }

  headers() {
    const h = { "Content-Type": "application/json", Origin: this.base };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.cookie) h.Cookie = this.cookie;
    return h;
  }

  async login() {
    if (!this.email) {
      throw new Error("session is invalid and no email/password configured");
    }
    const res = await fetch(`${this.base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: this.base },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`login failed (${res.status}): ${text.slice(0, 200)}`);
    }
    // The token normally arrives as the authToken cookie. Some builds return
    // it in the body instead.
    const setCookies = res.headers.getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
    if (setCookies.length) {
      this.cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.startsWith("application/json")) {
      const body = await res.json().catch(() => null);
      if (body?.token) this.token = body.token;
    }
  }

  async call(path, payload = {}) {
    const body = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v !== undefined && v !== null) body[k] = v;
    }

    const doRequest = () =>
      fetch(`${this.base}/api${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });

    let res = await doRequest();
    if (res.status === 401 && !this.apiKey) {
      await this.login();
      res = await doRequest();
    }
    if (res.status >= 400) {
      const text = await res.text();
      throw new Error(`${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    const text = await res.text();
    if (!text) return { ok: true };
    const json = JSON.parse(text);
    // Docmost wraps payloads in {"data": ...}
    return json && typeof json === "object" && "data" in json ? json.data : json;
  }

  // Docmost's REST /pages/create and /pages/update silently ignore the
  // `content` field — the page body only lives in the Yjs collaboration
  // document, not in the row these endpoints touch. /pages/import is the one
  // REST endpoint that actually writes a body: it runs the same markdown/html
  // converter as the UI's import feature and persists the result directly.
  // Docmost derives the page title from the file's first heading (any level)
  // and strips it from the body, so callers control the title by prefixing
  // the content with a heading before calling this.
  async importFile(spaceId, filename, mimeType, content) {
    const form = new FormData();
    form.append("spaceId", spaceId);
    form.append("file", new Blob([content], { type: mimeType }), filename);

    const doRequest = () => {
      const headers = this.headers();
      delete headers["Content-Type"]; // let fetch set the multipart boundary
      return fetch(`${this.base}/api/pages/import`, { method: "POST", headers, body: form });
    };

    let res = await doRequest();
    if (res.status === 401 && !this.apiKey) {
      await this.login();
      res = await doRequest();
    }
    if (res.status >= 400) {
      const text = await res.text();
      throw new Error(`/pages/import -> ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(await res.text());
    return json.data ?? json;
  }

  // Reads a page's actual body as markdown, via the export endpoint (the
  // metadata endpoint /pages/info never includes content — see importFile).
  // The response is sometimes a raw .md file, sometimes a single-entry zip,
  // depending on the Docmost version; both are handled here.
  async exportMarkdown(pageId) {
    const doRequest = () =>
      fetch(`${this.base}/api/pages/export`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ pageId, format: "markdown" }),
      });

    let res = await doRequest();
    if (res.status === 401 && !this.apiKey) {
      await this.login();
      res = await doRequest();
    }
    if (res.status >= 400) {
      const text = await res.text();
      throw new Error(`/pages/export -> ${res.status}: ${text.slice(0, 300)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("zip")) {
      const zip = await JSZip.loadAsync(buf);
      const name = Object.keys(zip.files)[0];
      return name ? await zip.files[name].async("string") : "";
    }
    return buf.toString("utf8");
  }

  // Exchanges the current session for a short-lived JWT scoped to the
  // Yjs/Hocuspocus collaboration WebSocket (a distinct token type from the
  // regular access token — the collab server rejects the latter).
  async getCollabToken() {
    const doRequest = () =>
      fetch(`${this.base}/api/auth/collab-token`, { method: "POST", headers: this.headers(), body: "{}" });

    let res = await doRequest();
    if (res.status === 401 && !this.apiKey) {
      await this.login();
      res = await doRequest();
    }
    if (res.status >= 400) {
      const text = await res.text();
      throw new Error(`/auth/collab-token -> ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(await res.text());
    return (json.data ?? json).token;
  }
}
