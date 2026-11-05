import assert from "node:assert/strict";
import { test } from "node:test";
import { PI_APPS, COVERED_BY_JUNCTION, toolOwner } from "../src/shared/apps.ts";
import {
  tigerDrawConnection,
  tigerDrawConnectionKey,
} from "../src/server/tigerdraw.ts";
import {
  housingError,
  housingDataStatus,
  housingUrl,
  housingTourUrl,
  housingHasContent,
} from "../src/client/lib/tigerdraw.ts";
import { parseToolPart, ownerOf } from "../src/client/lib/tools.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/client/components/Markdown.tsx";
import { studentSourceLink } from "../src/shared/source-links.ts";
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
  const status = housingDataStatus({
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
  assert.equal(status, "Live data");
  assert.equal(
    housingError(
      '{"error":{"code":"ROOM_NOT_FOUND","message":"No such room"}}',
    ),
    "No such room",
  );
});
test("room cards escape untrusted reviews, hide internal conflicts, and preserve example and fallback notices", () => {
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
  assert.ok(html.includes("Example view"));
  assert.ok(!html.includes("Conflicting"));
  assert.ok(html.includes("Partial results"));
  assert.ok(html.includes("Saved information"));
});

test("media gallery renders an active image with a compact view selector", () => {
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        building: "Patton",
        room_no: "88",
        images: [
          {
            type: "thumbnail",
            url: "https://example.org/Patton.JPG",
            media_type: "unknown",
          },
          {
            type: "floor_plan",
            url: "https://example.org/level_02.png?v=1",
            media_type: "unknown",
          },
          {
            type: "360",
            url: "https://example.org/tour/",
            media_type: "EXAMPLE",
          },
          { type: "floor_plan", url: "https://example.org/2.pdf", floor: "2" },
          { type: "thumbnail", url: "javascript:alert(1)" },
        ],
      },
    }),
  );
  assert.equal(
    (html.match(/alt="Building photo — Patton 88"/g) ?? []).length,
    1,
  );
  assert.ok(html.includes('src="https://example.org/Patton.JPG"'));
  assert.ok(html.includes('alt="Building photo — Patton 88"'));
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('referrerPolicy="no-referrer"'));
  assert.ok(html.includes('aria-label="Choose a view"'));
  assert.ok(html.includes("360° tour"));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(!html.includes('src="https://example.org/tour/"'));
  assert.ok(!html.includes('src="https://example.org/2.pdf"'));
  assert.ok(!html.includes("javascript:"));
});

test("only verified 360 tour URLs embed, with a restricted iframe and external fallback", () => {
  const url =
    "https://purv360s.z13.web.core.windows.net/images/Patton%20Hall/tour/";
  assert.equal(housingTourUrl(url), url);
  assert.equal(housingTourUrl("https://example.org/tour/"), null);
  assert.equal(
    housingTourUrl(
      "https://purv360s.z13.web.core.windows.net.evil.org/images/tour/",
    ),
    null,
  );
  assert.equal(housingTourUrl("javascript:alert(1)"), null);
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        building: "Patton",
        room_no: "88",
        images: [{ type: "360", url, media_type: "EXAMPLE" }],
      },
    }),
  );
  assert.ok(html.includes("<iframe"));
  assert.ok(html.includes('sandbox="allow-scripts allow-same-origin"'));
  assert.ok(!html.includes("allow-top-navigation"));
  assert.ok(html.includes('title="360° tour — Patton 88"'));
  assert.ok(html.includes("Drag to look around"));
  assert.ok(html.includes("Example view"));
  const pdf = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        plans: [{ type: "floor_plan", url: "https://example.org/2.pdf" }],
      },
    }),
  );
  assert.ok(pdf.includes("Open PDF floor plan"));
  assert.ok(!pdf.includes("<iframe"));
});

test("housing provenance renders only as a quiet status, without API or GitHub links", () => {
  const sources = [
    {
      source:
        "https://draw.tigerapps.org/room_images?building=Patton&room_no=88",
      source_kind: "live",
    },
    {
      source: "catalog",
      source_url: "https://github.com/TigerAppsOrg/TigerDraw",
      source_kind: "static",
    },
  ];
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: { rooms: [{ building: "Patton", room_no: "88" }], sources },
    }),
  );
  assert.ok(html.includes("Includes saved information"));
  assert.ok(!html.includes("github.com"));
  assert.ok(!html.includes("room_images"));
  assert.ok(!html.includes("Source 1"));
  assert.equal(
    housingDataStatus({ sources: [{ source_kind: "cache" }] }),
    "Recently retrieved",
  );
  assert.equal(
    housingDataStatus({ sources: [{ source_kind: "static" }] }),
    "Saved information",
  );
  assert.equal(housingDataStatus({}), null);
});
test("chat citations replace internal TigerDraw destinations while preserving public media links", () => {
  for (const href of [
    "https://draw.tigerapps.org/api/building_rooms?building=Blair",
    "https://draw.tigerapps.org/room_images?building=Patton&room_no=88",
    "https://draw.tigerapps.org/get_reviews?building_name=BLAIR",
    "https://github.com/TigerAppsOrg/TigerDraw/blob/main/mcp/src/generated/catalog.json",
    "https://raw.githubusercontent.com/TigerAppsOrg/TigerDraw/main/RoomInfo_RoomViewer.csv",
  ]) {
    const html = renderToStaticMarkup(
      createElement(Markdown, { text: `[Source 1](${href})` }),
    );
    assert.ok(html.includes('href="https://draw.tigerapps.org"'));
    assert.ok(html.includes("Open TigerDraw"));
    assert.ok(!html.includes(href));
  }
  const media =
    "https://purv360s.z13.web.core.windows.net/Building_Photos/Patton.JPG";
  assert.equal(studentSourceLink(media).href, media);
  assert.equal(
    studentSourceLink("https://github.com/other/project").href,
    "https://github.com/other/project",
  );
});

test("PDF floor plans render their own first-page preview and keep the original PDF link", () => {
  const pdf = "https://draw.tigerapps.org/static/pdfs/patton/2.pdf";
  const preview = "https://assets.example.org/plans/2-preview.png";
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        building: "Patton",
        floor: "2",
        plans: [
          { type: "floor_plan", floor: "2", url: pdf, preview_url: preview },
          {
            type: "floor_plan",
            floor: "2",
            url: "https://example.org/plan.png",
            media_type: "EXAMPLE",
          },
        ],
        sources: [{ source_kind: "static" }],
        warnings: [
          "Floor plans are static assets; their original update dates are unknown.",
        ],
      },
    }),
  );
  assert.ok(html.includes(`src="${preview}"`));
  assert.ok(html.includes(`href="${pdf}"`));
  assert.ok(html.includes("PDF floor plan"));
  assert.ok(html.includes("Image floor plan"));
  assert.ok(!html.includes("Archived"));
  assert.ok(!html.includes("Saved information"));
  assert.ok(!html.includes("update dates"));
  assert.ok(!html.includes("static assets"));
  assert.equal(
    housingDataStatus({
      sources: [{ source_kind: "static", purpose: "reference_asset" }],
    }),
    null,
  );
  const fallback = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        plans: [{ type: "floor_plan", url: "https://example.org/missing.pdf" }],
      },
    }),
  );
  assert.ok(fallback.includes("draw-media-stage-compact"));
});
test("example-plan qualifications remain visible", () => {
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        plans: [
          {
            type: "floor_plan",
            url: "https://example.org/plan.png",
            media_type: "EXAMPLE",
          },
        ],
        warnings: ["No floor plan is available for this selection."],
      },
    }),
  );
  assert.ok(html.includes("Example plan · layout may differ."));
  assert.ok(html.includes("No floor plan is available"));
});

test("preview URLs come only from MCP results and unsafe URLs are rejected", () => {
  const original = "https://example.org/original.pdf";
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        plans: [
          {
            type: "floor_plan",
            url: original,
            preview_url: "javascript:alert(1)",
          },
        ],
      },
    }),
  );
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("draw-media-stage-compact"));
  assert.ok(html.includes(`href="${original}"`));
});

test("room facts use labeled icons and omit conflicted values and reconciliation warnings", () => {
  const html = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        room: {
          building: "Bloomberg",
          room_no: "111",
          occupancy: 1,
          sq_footage: 160,
          floor: "1",
          ac: true,
          elevator: true,
          bathroom: null,
          draw_rank: 623,
          conflicts: { bathroom: [] },
        },
        warnings: ["Conflicting source records: bathroom."],
      },
    }),
  );
  for (const label of [
    "Occupancy",
    "1 person",
    "Room size",
    "160 sq ft",
    "Floor",
    "Air conditioning",
    "Elevator",
    "Historical draw rank",
    "#623",
  ])
    assert.ok(html.includes(label));
  assert.ok(html.includes('<dl class="draw-room-facts">'));
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 6);
  assert.ok(!/conflict|bathroom|unknown/i.test(html));
  const incomplete = renderToStaticMarkup(
    createElement(TigerDrawResults, {
      value: {
        rooms: [
          {
            building: "Blair",
            room_no: "B41",
            occupancy: 2,
            sq_footage: 160,
            ac: true,
            elevator: false,
            avg_rating: 4,
            num_reviews: 1,
            conflicts: { sq_footage: [], ac: [], num_reviews: [] },
          },
        ],
      },
    }),
  );
  assert.ok(incomplete.includes("2 people"));
  assert.ok(incomplete.includes("4/5"));
  for (const absent of [
    "160 sq ft",
    "Room size",
    "Air conditioning",
    "Elevator",
    "1 review",
    "unknown",
    "Conflicting",
  ])
    assert.ok(!incomplete.includes(absent));
});

test("empty TigerDraw responses do not produce cards even with cached status or notices", () => {
  for (const value of [
    {},
    { rooms: [], sources: [{ source_kind: "cache" }] },
    {
      images: [],
      plans: [],
      warnings: ["No images available."],
      partial: true,
    },
    { room: {}, buildings: [{}], images: [{ url: "javascript:bad" }] },
    { reviews: { available: false, reviews: [] } },
    { reviews: { available: true, reviews: [{ untrusted_text: " " }] } },
  ]) {
    assert.equal(housingHasContent(value), false);
    assert.equal(
      renderToStaticMarkup(createElement(TigerDrawResults, { value })),
      "",
    );
  }
});
test("useful results keep their cards and relevant availability notes", () => {
  for (const value of [
    {
      room: { building: "Patton", room_no: "88" },
      reviews: { available: false },
    },
    { buildings: [{ building: "Patton" }] },
    {
      plans: [
        {
          url: "https://draw.tigerapps.org/static/pdfs/2.pdf",
          type: "floor_plan",
        },
      ],
    },
    { reviews: { reviews: [{ untrusted_text: "Bright room", rating: 4 }] } },
  ]) {
    assert.equal(housingHasContent(value), true);
    const html = renderToStaticMarkup(
      createElement(TigerDrawResults, { value }),
    );
    assert.ok(html.includes("draw-results"));
    assert.ok(!html.includes("No matches or media"));
    if (value.room) assert.ok(html.includes("Reviews are unavailable"));
  }
});
