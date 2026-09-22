// Writes to an existing page's body over Docmost's real-time collaboration
// channel (Yjs CRDT documents synced over a Hocuspocus WebSocket).
//
// Why this exists: Docmost's REST /pages/update accepts a `content` field and
// returns 200, but never persists it — the page body is owned by the
// collaboration document, not by that endpoint (confirmed against
// docmost/docmost#980 and by reading apps/server/src/collaboration on the
// Docmost repo). The only two ways to actually write a body are the /pages/import
// converter (new pages only) and this WebSocket path (existing pages).
//
// Approach: import the new markdown into a throwaway temporary page so
// Docmost's own converter builds a correct Yjs structure (reimplementing its
// Tiptap schema — tables, lists, marks — ourselves would be a lot of fragile
// work). Read that structure back over the collab WebSocket, clone it node by
// node into the destination page's document, then disconnect and wait for the
// server's debounced persistence to flush it to the database.
import * as Y from "yjs";
import WebSocket from "ws";
import { HocuspocusProvider } from "@hocuspocus/provider";

const PERSIST_WAIT_MS = 12_000; // server debounce is 10s, up to 45s worst case

async function connectPageDoc(dm, pageId) {
  const token = await dm.getCollabToken();
  const wsUrl = dm.base.replace(/^http/, "ws") + "/collab";
  const ydoc = new Y.Doc();

  const provider = new HocuspocusProvider({
    url: wsUrl,
    name: `page.${pageId}`,
    document: ydoc,
    token,
    WebSocketPolyfill: WebSocket,
    connect: true,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out syncing page ${pageId} over collab websocket`)), 15_000);
    provider.on("synced", () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on("authenticationFailed", (data) => {
      clearTimeout(timer);
      reject(new Error(`collab websocket auth failed: ${data?.reason ?? "unknown"}`));
    });
  });

  return provider;
}

function cloneXmlNode(node) {
  if (node instanceof Y.XmlText) {
    return { kind: "text", delta: node.toDelta() };
  }
  if (node instanceof Y.XmlElement) {
    return {
      kind: "element",
      tag: node.nodeName,
      attrs: node.getAttributes(),
      children: node.toArray().map(cloneXmlNode),
    };
  }
  throw new Error(`unsupported Yjs node type: ${node?.constructor?.name}`);
}

// Yjs types must be attached to their document (via a parent already in the
// doc) before their attributes/children/text can be touched, so each node is
// inserted empty first and populated right after.
function insertClone(parent, index, plain) {
  if (plain.kind === "text") {
    const text = new Y.XmlText();
    parent.insert(index, [text]);
    if (plain.delta?.length) text.applyDelta(plain.delta);
    return;
  }
  const el = new Y.XmlElement(plain.tag);
  parent.insert(index, [el]);
  for (const [key, value] of Object.entries(plain.attrs ?? {})) {
    el.setAttribute(key, value);
  }
  plain.children.forEach((child, i) => insertClone(el, i, child));
}

function fileForFormat(fmt, tempTitle, markdown) {
  if (fmt === "html") {
    return { filename: "tmp.html", mimeType: "text/html", content: `<h1>${tempTitle}</h1>\n${markdown}` };
  }
  return { filename: "tmp.md", mimeType: "text/markdown", content: `# ${tempTitle}\n\n${markdown}` };
}

// Replaces the body of an existing page. Returns once the server has had
// time to persist the change (does not itself verify — callers that need
// certainty should re-read the page after this resolves).
export async function replacePageContent(dm, { pageId, spaceId, content, fmt = "markdown" }) {
  const tempTitle = `__mcp_tmp_${Date.now()}`;
  const { filename, mimeType, content: fileContent } = fileForFormat(fmt, tempTitle, content);

  const tempPage = await dm.importFile(spaceId, filename, mimeType, fileContent);

  try {
    const tempProvider = await connectPageDoc(dm, tempPage.id);
    const tempFrag = tempProvider.document.getXmlFragment("default");
    const clonedChildren = tempFrag.toArray().map(cloneXmlNode);
    tempProvider.destroy();

    const destProvider = await connectPageDoc(dm, pageId);
    const destDoc = destProvider.document;
    destDoc.transact(() => {
      const frag = destDoc.getXmlFragment("default");
      frag.delete(0, frag.length);
      clonedChildren.forEach((child, i) => insertClone(frag, i, child));
    });

    // Give the update time to reach the server and the Hocuspocus debounce
    // time to flush it to Postgres before we disconnect.
    await new Promise((r) => setTimeout(r, PERSIST_WAIT_MS));
    destProvider.destroy();
  } finally {
    await dm.call("/pages/delete", { pageId: tempPage.id, permanentlyDelete: true });
  }
}
