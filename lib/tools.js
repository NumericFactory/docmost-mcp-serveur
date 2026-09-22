import { z } from "zod";
import { replacePageContent } from "./collab.js";

function toolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// Registers the Docmost tool set on `server`, bound to the given client `dm`.
export function registerDocmostTools(server, dm) {
  server.registerTool(
    "list_spaces",
    {
      description: "List the spaces in the workspace.",
      inputSchema: { limit: z.number().int().optional().default(50) },
    },
    async ({ limit }) => toolResult(await dm.call("/spaces", { limit }))
  );

  server.registerTool(
    "search",
    {
      description: "Full-text search across pages. Optionally scoped to one space.",
      inputSchema: {
        query: z.string(),
        space_id: z.string().optional(),
        limit: z.number().int().optional().default(20),
      },
    },
    async ({ query, space_id, limit }) =>
      toolResult(await dm.call("/search", { query, spaceId: space_id, limit }))
  );

  server.registerTool(
    "get_page",
    {
      description: "Fetch a page and its content (as markdown) by id or slugId.",
      inputSchema: { page_id: z.string() },
    },
    async ({ page_id }) => {
      // /pages/info never includes the body — it lives in the collaboration
      // document and has to be read via the export endpoint instead.
      const [info, content] = await Promise.all([
        dm.call("/pages/info", { pageId: page_id }),
        dm.exportMarkdown(page_id),
      ]);
      return toolResult({ ...info, content });
    }
  );

  server.registerTool(
    "recent_pages",
    {
      description: "List recently changed pages, optionally within a single space.",
      inputSchema: {
        space_id: z.string().optional(),
        limit: z.number().int().optional().default(20),
      },
    },
    async ({ space_id, limit }) =>
      toolResult(await dm.call("/pages/recent", { spaceId: space_id, limit }))
  );

  server.registerTool(
    "create_page",
    {
      description: "Create a page. fmt is markdown or html (only used when content is given).",
      inputSchema: {
        space_id: z.string(),
        title: z.string(),
        content: z.string().optional(),
        parent_page_id: z.string().optional(),
        fmt: z.enum(["markdown", "html"]).optional().default("markdown"),
      },
    },
    async ({ space_id, title, content, parent_page_id, fmt }) => {
      let page;
      if (content) {
        // REST /pages/create ignores the content field entirely — /pages/import
        // is the endpoint that actually persists a body. It derives the title
        // from the file's first heading and strips it from the body.
        const file =
          fmt === "html"
            ? { filename: "page.html", mimeType: "text/html", body: `<h1>${title}</h1>\n${content}` }
            : { filename: "page.md", mimeType: "text/markdown", body: `# ${title}\n\n${content}` };
        page = await dm.importFile(space_id, file.filename, file.mimeType, file.body);
        if (parent_page_id) {
          await dm.call("/pages/move", { pageId: page.id, parentPageId: parent_page_id });
          page = await dm.call("/pages/info", { pageId: page.id });
        }
      } else {
        page = await dm.call("/pages/create", { spaceId: space_id, title, parentPageId: parent_page_id });
      }
      return toolResult(page);
    }
  );

  server.registerTool(
    "update_page",
    {
      description:
        "Update a page's title and/or body. Body replacement goes over the collaboration " +
        "WebSocket (REST ignores it) and takes ~12s to persist.",
      inputSchema: {
        page_id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        fmt: z.enum(["markdown", "html"]).optional().default("markdown"),
      },
    },
    async ({ page_id, title, content, fmt }) => {
      if (title !== undefined) {
        await dm.call("/pages/update", { pageId: page_id, title });
      }
      if (content !== undefined) {
        const info = await dm.call("/pages/info", { pageId: page_id });
        await replacePageContent(dm, { pageId: page_id, spaceId: info.spaceId, content, fmt });
      }
      const info = await dm.call("/pages/info", { pageId: page_id });
      const newContent = content !== undefined ? await dm.exportMarkdown(page_id) : undefined;
      return toolResult(newContent !== undefined ? { ...info, content: newContent } : info);
    }
  );

  server.registerTool(
    "move_page",
    {
      description: "Move a page under a different parent.",
      inputSchema: { page_id: z.string(), parent_page_id: z.string().optional() },
    },
    async ({ page_id, parent_page_id }) =>
      toolResult(await dm.call("/pages/move", { pageId: page_id, parentPageId: parent_page_id }))
  );

  server.registerTool(
    "delete_page",
    {
      description: "Delete a page. Goes to the trash unless permanently is true.",
      inputSchema: { page_id: z.string(), permanently: z.boolean().optional().default(false) },
    },
    async ({ page_id, permanently }) =>
      toolResult(await dm.call("/pages/delete", { pageId: page_id, permanentlyDelete: permanently }))
  );
}
