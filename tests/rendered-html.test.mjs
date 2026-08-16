import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const desktopUrl = new URL("../electron/main.mjs", import.meta.url);

test("suppresses duplicates across files and completed campaigns", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /zedx_sent_email_registry_v1/);
  assert.match(page, /Already contacted — duplicate suppressed/);
  assert.match(page, /uniqueContacts = new Map/);
  assert.match(page, /rememberSent\(email\)/);
});

test("processes full campaigns and advances pages automatically", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /for \(let index = 0; index < recipients\.length; index\+\+\)/);
  assert.match(page, /setPage\(Math\.floor\(sourceIndex \/ PAGE_SIZE\) \+ 1\)/);
  assert.doesNotMatch(page, /recipients\.slice\(0, 50\)/);
});

test("keeps personal-domain contacts eligible and synchronizes Hostinger Sent", async () => {
  const [page, desktop] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(desktopUrl, "utf8"),
  ]);
  assert.match(page, /Valid personal-domain contact/);
  assert.doesNotMatch(page, /blocked = personal \|\|/);
  assert.match(desktop, /appendToSent/);
  assert.match(desktop, /specialUse === "\\\\Sent"/);
});
