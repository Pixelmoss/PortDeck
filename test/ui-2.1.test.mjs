import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, script, packageJson] = await Promise.all([
  readFile(new URL("../web/index.html", import.meta.url), "utf8"),
  readFile(new URL("../web/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../web/app.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("2.1 uses the native utility shell and service inspector", () => {
  assert.equal(packageJson.version, "2.1.0");
  assert.match(html, /class="status-strip"/);
  assert.match(html, /id="serviceInspector"/);
  assert.match(html, /class="service-columns"/);
  assert.doesNotMatch(html, /class="summary-grid"/);
});

test("service inspector preserves lifecycle, logs and editing actions", () => {
  assert.match(script, /function renderInspector\(\)/);
  assert.match(script, /actionButtons\(service, \{ expanded: true \}\)/);
  for (const action of ["open", "start", "stop", "restart", "logs", "edit", "favorite", "manage"]) {
    assert.match(script, new RegExp(`add\\(\\"${action}\\"`));
  }
});

test("native utility theme supports macOS light and dark appearances", () => {
  assert.match(css, /font-family:\s*-apple-system/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /\.workbench\s*\{/);
  assert.match(css, /\.inspector\s*\{/);
});

test("service avatars keep a readable fallback behind optional favicons", () => {
  assert.match(script, /<span>\$\{escapeHtml\(initials\(service\)\)\}<\/span>\$\{faviconMarkup\(service\)\}/);
  assert.match(script, /onerror="this\.hidden=true"/);
  assert.match(css, /\.service-avatar img \{[^}]*position:\s*absolute/);
  assert.match(css, /\.service-avatar img \{[^}]*background:\s*var\(--surface-2\)/);
});

test("discovered services do not request unavailable managed-process logs", () => {
  assert.match(script, /service\.source !== "managed"/);
  assert.match(script, /state\.inspectorLogs\.set\(serviceId, ""\)/);
});
