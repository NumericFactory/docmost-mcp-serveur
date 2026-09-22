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
}
