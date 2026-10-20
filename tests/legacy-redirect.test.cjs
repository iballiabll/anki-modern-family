"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.join(__dirname, "..", "scripts", "static-core.mjs"),
).href;

test("其它路径不受跳转规则影响", async () => {
  const { legacyRedirectTarget } = await import(moduleUrl);

  assert.equal(legacyRedirectTarget("/xxrj/"), "");
  assert.equal(legacyRedirectTarget("/index.html"), "");
  assert.equal(legacyRedirectTarget("/yantuu/"), "");
});
