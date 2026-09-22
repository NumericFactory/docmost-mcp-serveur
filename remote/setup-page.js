const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  fieldset { border: 1px solid #8884; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 600; }
  input[type=text], input[type=password], input[type=url] { width: 100%; padding: 0.5rem; box-sizing: border-box; font-size: 1rem; }
  .radio-row { display: flex; gap: 1.5rem; align-items: center; margin-top: 0.5rem; }
  .radio-row label { font-weight: normal; margin: 0; }
  button { margin-top: 1.5rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { background: #fee; border: 1px solid #c33; border-radius: 6px; padding: 0.75rem 1rem; color: #900; }
  .success { background: #efe; border: 1px solid #3a3; border-radius: 6px; padding: 0.75rem 1rem; }
  code, .url-box { display: block; background: #8882; padding: 0.75rem; border-radius: 6px; word-break: break-all; font-family: monospace; margin: 0.75rem 0; }
  .warn { font-size: 0.9rem; opacity: 0.8; }
`;

export function renderSetupForm() {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecter Docmost</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Connecter ton espace Docmost</h1>
<p>Renseigne tes identifiants Docmost. Ils seront chiffrés et stockés côté serveur ; tu recevras ensuite une URL MCP unique à coller dans Claude.</p>
<form method="POST" action="/setup">
  <label for="url">URL Docmost</label>
  <input type="url" id="url" name="url" placeholder="https://docs.exemple.com" required>

  <fieldset>
    <legend>Méthode d'authentification</legend>
    <div class="radio-row">
      <label><input type="radio" name="authMethod" value="emailPassword" checked onchange="toggle()"> Email + mot de passe</label>
      <label><input type="radio" name="authMethod" value="apiKey" onchange="toggle()"> Clé API</label>
    </div>

    <div id="emailPasswordFields">
      <label for="email">Email</label>
      <input type="text" id="email" name="email">
      <label for="password">Mot de passe</label>
      <input type="password" id="password" name="password">
    </div>

    <div id="apiKeyFields" style="display:none">
      <label for="apiKey">Clé API</label>
      <input type="password" id="apiKey" name="apiKey">
    </div>
  </fieldset>

  <button type="submit">Connecter</button>
</form>
<script>
function toggle() {
  const isApiKey = document.querySelector('input[name=authMethod]:checked').value === 'apiKey';
  document.getElementById('emailPasswordFields').style.display = isApiKey ? 'none' : 'block';
  document.getElementById('apiKeyFields').style.display = isApiKey ? 'block' : 'none';
}
</script>
</body>
</html>`;
}

export function renderSetupResult(mcpUrl) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecté</title>
<style>${STYLE}</style>
</head>
<body>
<h1>C'est connecté</h1>
<div class="success">Tes identifiants ont été vérifiés et chiffrés.</div>
<p>Colle cette URL dans Claude (connecteur MCP personnalisé) :</p>
<code class="url-box">${mcpUrl}</code>
<p class="warn">⚠️ Cette URL donne un accès complet à ton espace Docmost — traite-la comme un mot de passe. Ne la partage pas, ne la publie pas dans un dépôt public.</p>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function renderSetupError(message) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Erreur</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Connecter ton espace Docmost</h1>
<div class="error">${escapeHtml(message)}</div>
<p><a href="/setup">Réessayer</a></p>
</body>
</html>`;
}
