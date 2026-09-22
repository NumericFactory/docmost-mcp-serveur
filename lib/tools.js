import { z } from "zod";

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
      description: "Fetch a page and its content by id or slugId.",
      inputSchema: { page_id: z.string() },
    },
    async ({ page_id }) => toolResult(await dm.call("/pages/info", { pageId: page_id }))
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
      description: "Create a page. fmt is markdown, html or json.",
      inputSchema: {
        space_id: z.string(),
        title: z.string(),
        content: z.string().optional(),
        parent_page_id: z.string().optional(),
        fmt: z.string().optional().default("markdown"),
      },
    },
    async ({ space_id, title, content, parent_page_id, fmt }) =>
      toolResult(
        await dm.call("/pages/create", {
          spaceId: space_id,
          title,
          content,
          parentPageId: parent_page_id,
          format: fmt,
        })
      )
  );

  server.registerTool(
    "update_page",
    {
      description: "Update a page's title and/or body.",
      inputSchema: {
        page_id: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        fmt: z.string().optional().default("markdown"),
      },
    },
    async ({ page_id, title, content, fmt }) => {
      const payload = { pageId: page_id, title, content };
      if (content !== undefined) payload.format = fmt;
      return toolResult(await dm.call("/pages/update", payload));
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
