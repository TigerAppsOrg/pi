import { createElement } from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MenuCard } from "../src/client/components/MenuCard.tsx";
import { parseToolPart, type ToolView } from "../src/client/lib/tools.ts";

const meal = { meal: "Dinner", stations: [{ station: "Main Entree", items: ["Sautéed Cabbage", "Red Beans & Rice"] }] };
const data = { date: "2026-11-06", halls: [{ hall: "Whitman", meals: [meal] }] };
function view(output: unknown, input: unknown = {}): ToolView {
  return parseToolPart({ type: "dynamic-tool", toolName: "tool_tigermenus_get_menu", state: "output-available", input, output })!;
}
function envelope(payload: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError };
}
const render = (value: ToolView) => renderToStaticMarkup(createElement(MenuCard, { view: value }));

test("menu view renders exact dishes, hall, meal, returned date and source link", () => {
  const html = render(view(envelope(data), { day: 1, meal: "dinner" }));
  for (const text of ["Whitman", "Dinner", "Main Entree", "Sautéed Cabbage", "Red Beans &amp; Rice", 'dateTime="2026-11-06"', "Friday, Nov 6, 2026", 'href="https://menus.tigerapps.org"']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("get_menu"));
});
test("partial scrape failure retains successful halls and distinguishes failed from unposted", () => {
  const payload = { ...data, halls: [...data.halls, { hall: "CJL", error: "scraper internal error" }, { hall: "Forbes", meals: [] }] };
  const parsed = view(envelope(payload, true), { meal: "dinner" });
  assert.deepEqual(parsed.data, payload);
  const html = render(parsed);
  for (const text of ["Sautéed Cabbage", "CJL", "Couldn’t load this hall", "Forbes", "No dinner menu posted"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("scraper internal error"));
});
test("text-only MCP envelopes preserve partial results too", () => {
  const parsed = view({ content: [{ type: "text", text: JSON.stringify(data) }], isError: true });
  assert.ok(render(parsed).includes("Sautéed Cabbage"));
});
test("multi-meal results keep server meal names including brunch", () => {
  const html = render(view(envelope({ ...data, halls: [{ hall: "Choi", meals: [{ ...meal, meal: "Brunch" }, meal] }] })));
  assert.ok(html.includes("All meals"));
  assert.ok(html.includes("Brunch"));
  assert.ok(html.includes("Dinner"));
});
test("empty halls and empty stations have distinct messages", () => {
  assert.ok(render(view(envelope({ ...data, halls: [] }))).includes("No dining hall menus were returned"));
  assert.ok(render(view(envelope({ ...data, halls: [{ hall: "Grad", meals: [] }] }))).includes("No meals posted"));
  assert.ok(render(view(envelope({ ...data, halls: [{ hall: "Grad", meals: [{ meal: "Breakfast", stations: [] }] }] }))).includes("No dishes posted"));
});
test("loading, validation errors, transport failures and malformed results have readable states", () => {
  const pending = { ...view(undefined), state: "input-available" };
  assert.ok(render(pending).includes("Checking dining hall menus"));
  assert.ok(render(pending).includes('aria-busy="true"'));
  const invalid = view({ content: [{ type: "text", text: "Invalid arguments: day" }], isError: true });
  assert.ok(render(invalid).includes("Menus couldn’t be loaded"));
  assert.ok(!render(invalid).includes("Invalid arguments"));
  assert.ok(render({ ...view(undefined), state: "output-error", errorText: "Network failed" }).includes("Menus couldn’t be loaded"));
  for (const payload of [{ date: "2026-02-30", halls: [] }, { ...data, halls: [{ hall: "CJL" }] }, { broken: true }]) {
    assert.ok(render(view(envelope(payload))).includes("Menus couldn’t be loaded"));
  }
});
test("error payload behavior remains unchanged for other apps", () => {
  const parsed = parseToolPart({ type: "dynamic-tool", toolName: "tool_junction_get_schedule", output: envelope(data, true) })!;
  assert.equal(parsed.data, null);
  assert.ok(parsed.errorText);
});
test("all-hall failures stay distinct from menus that have not been posted", () => {
  const html = render(view(envelope({ ...data, halls: [{ hall: "CJL", error: "Failed" }, { hall: "Whitman", error: "Failed" }] }, true)));
  assert.equal(html.split("Couldn’t load this hall").length - 1, 2);
  assert.ok(!html.includes("No meals posted"));
});
test("dish names are escaped as text rather than interpreted as markup", () => {
  const payload = { ...data, halls: [{ hall: "Whitman", meals: [{ meal: "Dinner", stations: [{ station: "Entree", items: ["<img src=x onerror=alert(1)>"] }] }] }] };
  const html = render(view(envelope(payload)));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
});
