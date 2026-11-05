import assert from "node:assert/strict";
import { test } from "node:test";
import { PI_APPS, COVERED_BY_JUNCTION, toolOwner } from "../src/shared/apps.ts";
import {
  tigerDrawConnection,
  tigerDrawConnectionKey,
} from "../src/server/tigerdraw.ts";
import {
  housingError,
  housingSources,
  housingUrl,
} from "../src/client/lib/tigerdraw.ts";
import { parseToolPart, ownerOf } from "../src/client/lib/tools.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TigerDrawResults } from "../src/client/components/TigerDrawResults.tsx";

test("TigerDraw is a separate public-data connection with explicit ownership", () => {
  const app = PI_APPS.find((a) => a.key === "tigerdraw")!;
  assert.equal(app.personal, false);
  assert.equal(app.mcpUrl, "https://draw.tigerapps.org/mcp");
  assert.ok(!COVERED_BY_JUNCTION.includes("tigerdraw"));
  for (const tool of [
    "list_buildings",
    "list_rooms",
    "get_room",
    "get_room_images",
    "get_floor_plan",
    "search_rooms",
  ])
    assert.equal(toolOwner(tool, "junction"), "tigerdraw");
  const view = parseToolPart({
    type: "tool-tool_tigerdraw_get_room",
    state: "output-available",
    output: {
      content: [
        { type: "text", text: '{"room":{"building":"Blair","room_no":"B41"}}' },
      ],
    },
  })!;
  assert.equal(view.app, "tigerdraw");
  assert.equal(ownerOf(view), "tigerdraw");
});
test("TigerDraw connection sends only its dedicated token and fingerprints endpoint/token changes", async () => {
  const connection = tigerDrawConnection({
    TIGERDRAW_MCP_URL: "http://127.0.0.1:3333/mcp",
    TIGERDRAW_MCP_TOKEN: "draw-token",
    ENGINE_MCP_TOKEN: "never-forward",
    netid: "private",
  });
  assert.deepEqual(connection.headers, { authorization: "Bearer draw-token" });
  assert.deepEqual(tigerDrawConnection({}).headers, {});
  assert.notEqual(
    await tigerDrawConnectionKey(connection),
    await tigerDrawConnectionKey(
      tigerDrawConnection({ TIGERDRAW_MCP_TOKEN: "other" }),
    ),
  );
  assert.notEqual(
    await tigerDrawConnectionKey(connection),
    await tigerDrawConnectionKey({
      ...connection,
      url: "https://draw.tigerapps.org/mcp",
    }),
  );
  assert.throws(() =>
    tigerDrawConnection({
      TIGERDRAW_MCP_URL: "https://user:pass@example.org/mcp",
    }),
  );
});
test("housing links exclude script/credential URLs and errors show the useful message", () => {
  assert.equal(housingUrl("javascript:alert(1)"), null);
  assert.equal(housingUrl("https://user:pass@example.org"), null);
  const sources = housingSources({
    sources: [{ source: "javascript:bad" }],
    room: {
      sources: [
        {
          source:
            "https://draw.tigerapps.org/api/building_rooms?building=Blair",
          source_kind: "live",
        },
      ],
    },
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, "live");
  assert.equal(
    housingError(
      '{"error":{"code":"ROOM_NOT_FOUND","message":"No such room"}}',
    ),
    "No such room",
  );
});
test("room cards escape untrusted reviews and preserve conflicts, examples and fallback notices", () => {
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        room: {
          building: "Blair",
          room_no: "B41",
          sq_footage: null,
          conflicts: { sq_footage: [] },
          sources: [
            {
              source: "catalog",
              source_url: "https://github.com/TigerAppsOrg/TigerDraw",
              source_kind: "static",
            },
          ],
        },
        reviews: {
          available: true,
          reviews: [{ untrusted_text: "<script>leak()</script>", rating: 4 }],
        },
        images: [
          { url: "javascript:leak()", type: "360" },
          {
            url: "https://example.org/360",
            type: "360",
            media_type: "EXAMPLE",
          },
        ],
        partial: true,
      },
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("example media"));
  assert.ok(html.includes("Conflicting square footage"));
  assert.ok(html.includes("Partial results"));
  assert.ok(html.includes("Static source data"));
});
