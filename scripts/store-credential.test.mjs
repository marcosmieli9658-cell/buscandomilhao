import assert from "node:assert/strict";
import { test } from "vitest";
import { updateCredential } from "./store-credential.mjs";

const fakeKey = `sk-${"test".repeat(8)}`;
test("replaces only the selected credential and removes duplicate definitions", () => {
  const result = updateCredential("# Config\r\nOPENAI_API_KEY=\r\nOTHER=keep\r\nOPENAI_API_KEY=old\r\n", "OPENAI_API_KEY", fakeKey);
  assert.equal(result, `# Config\nOPENAI_API_KEY=${fakeKey}\nOTHER=keep\n`);
});
test("appends a missing credential", () => {
  assert.equal(updateCredential("OTHER=keep", "OPENAI_API_KEY", fakeKey), `OTHER=keep\nOPENAI_API_KEY=${fakeKey}\n`);
});
test("rejects other variables and injected newlines", () => {
  assert.throws(() => updateCredential("", "PATH", fakeKey));
  assert.throws(() => updateCredential("", "OPENAI_API_KEY", `${fakeKey}\nOTHER=injected`));
});
test("validates Meta app secrets without logging their values", () => {
  assert.throws(() => updateCredential("", "INSTAGRAM_APP_SECRET", "invalid"));
  assert.match(updateCredential("", "INSTAGRAM_APP_SECRET", "a".repeat(32)), /INSTAGRAM_APP_SECRET=/);
});
