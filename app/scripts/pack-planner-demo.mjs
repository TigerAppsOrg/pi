import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist/semester-preview");
const entry = readFileSync(join(dist, "tests/semester-lab.html"), "utf8");
const jsPath = entry.match(/src="([^\"]+\.js)"/)?.[1];
const cssPath = entry.match(/href="([^\"]+\.css)"/)?.[1];
if (!jsPath || !cssPath)
  throw new Error("Build the planner demo before packing it.");
const js = readFileSync(join(dist, jsPath.replace(/^\//, "")), "utf8");
let css = readFileSync(join(dist, cssPath.replace(/^\//, "")), "utf8");
const font = readFileSync(
  join(root, "public/fonts/caveat-latin.woff2"),
).toString("base64");
css = css.replaceAll("/fonts/caveat-latin.woff2", `data:font/woff2;base64,${font}`);
const zipped = gzipSync(js, { level: 9 }).toString("base64");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PI. Semester Lab</title><style>${css}</style></head><body><div id="root"></div><script type="module">
const data=Uint8Array.from(atob(${JSON.stringify(zipped)}),c=>c.charCodeAt(0));
const source=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const script=document.createElement('script');script.type='module';script.textContent=source;document.body.appendChild(script);
</script></body></html>`;
mkdirSync(join(root, ".artifacts"), { recursive: true });
const target = join(root, ".artifacts/semester-lab.html");
writeFileSync(target, html);
console.log(
  `Packed standalone demo. ${Buffer.byteLength(html).toLocaleString()} bytes. ${target}`,
);
