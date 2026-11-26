import assert from "node:assert/strict";
import { test } from "node:test";
import { publicCourseData } from "../src/server/course-public-data.ts";

const html = `<select><option value="spring27" selected="selected">Spring 2027</option></select><table class="course-schedule__table"><tr><td class="course-schedule__number">COS217</td><td class="course-schedule__title">Systems &amp; C</td><td class="course-schedule__instructors">Professor</td><td class="course-schedule__time"><span>MW</span> 10:40 - 11:30</td></tr></table>`;

test("CS fallback preserves actual term, meetings and limited coverage without sending identity", async () => {
  let calls = 0;
  const api = publicCourseData((async (url, init) => {
    calls++;
    assert.equal(String(url), "https://www.cs.princeton.edu/courses/schedule?semester=spring27");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.equal(new Headers(init?.headers).has("x-user-netid"), false);
    assert.equal(new Headers(init?.headers).has("cookie"), false);
    return new Response(html);
  }) as typeof fetch);
  const result = await api.csSchedule(1274);
  assert.equal(result.courses[0].publishedMeeting, "MW 10:40 - 11:30");
  assert.equal(result.courses[0].title, "Systems & C");
  assert.equal(result.coverage, "COS_course_level_schedule_only");
  assert.ok(result.fetchedAt);
  await api.csSchedule(1274);
  assert.equal(calls, 1);
});

test("wrong selected term, markup changes, redirects and oversized responses fail closed", async () => {
  for (const response of [new Response(html.replace('value="spring27"', 'value="fall26"')), new Response("challenge page"), new Response(null, { status: 302, headers: { location: "https://other.test" } }), new Response("x".repeat(2_000_001))]) {
    const api = publicCourseData((async () => response) as typeof fetch);
    await assert.rejects(api.csSchedule(1274));
  }
});

test("Prince returns public dated excerpts, skips malformed records and makes no ingestion claims", async () => {
  const api = publicCourseData((async url => {
    const u = new URL(String(url));
    assert.equal(u.hostname, "www.dailyprincetonian.com");
    assert.equal(u.searchParams.get("s"), "Spring 2027");
    return Response.json({ items: [false, { id: "1", slug: "course-changes", headline: "Changes", published_at: "2026-11-05 12:00:00", abstract: "<p>Summary</p>", content: "private unused full text" }, { id: "2", slug: "../../bad", published_at: "2026-11-05" }] });
  }) as typeof fetch);
  const result = await api.call("search_prince_articles", { query: "Spring 2027" }) as any;
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].source_type, "prince_public_article");
  assert.equal(result.articles[0].url, "https://www.dailyprincetonian.com/article/2026/11/course-changes");
  assert.equal(result.latest_successful_ingestion, null);
  assert.equal(result.corpus_range, null);
  assert.equal(result.articles[0].excerpt, "Summary");
  assert.doesNotMatch(JSON.stringify(result), /private unused/);
  await assert.rejects(api.call("search_prince_articles", { query: "x" }));
  await assert.rejects(api.call("get_cs_course_schedule", { term: 1273 }));
});
