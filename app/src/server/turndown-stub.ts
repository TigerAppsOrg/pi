/**
 * Build-time stub for `turndown` (html→markdown), which ships a CJS
 * `require()` that Workers can't evaluate. It is only reachable through
 * just-bash's `html-to-markdown` command, and PI disables the bash tool
 * (`workspaceBash = false`), so a passthrough is safe.
 */
export default class TurndownService {
  addRule(): this {
    return this;
  }
  use(): this {
    return this;
  }
  keep(): this {
    return this;
  }
  remove(): this {
    return this;
  }
  turndown(input: unknown): string {
    return String(input);
  }
}
