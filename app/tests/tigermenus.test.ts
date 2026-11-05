import assert from "node:assert/strict";
import { test } from "node:test";
import { PI_APPS } from "../src/shared/apps.ts";

const menus = PI_APPS.find((a) => a.key === "tigermenus")!;

async function getMenu(args: unknown) {
  const res = await fetch(menus.mcpUrl!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_menu", arguments: args } }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).result;
}

test("get_menu returns a dated menu by hall, meal and station", async () => {
  const result = await getMenu({ day: 1, meal: "dinner", halls: ["CJL", "Whitman"] });
  const data = result.structuredContent;
  assert.match(data.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(data.halls.map((h: any) => h.hall), ["CJL", "Whitman"]);
  for (const hall of data.halls) {
    // A failed scrape is flagged for that hall instead of returning no menu.
    if (hall.error) {
      assert.equal(result.isError, true);
      continue;
    }
    // A hall that hasn't posted dinner has no meals, never placeholder items.
    for (const meal of hall.meals) {
      assert.equal(meal.meal, "Dinner");
      for (const s of meal.stations) {
        assert.ok(s.station && s.items.length > 0 && s.items.every(Boolean));
      }
    }
  }
});

test("get_menu rejects bad arguments with a reason", async () => {
  for (const args of [{ day: 7 }, { day: "tomorrow" }, { meal: "supper" }, { meal: [] }, { halls: ["Butler"] }]) {
    const result = await getMenu(args);
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.match(result.content[0].text, /^Invalid arguments/);
  }
});
