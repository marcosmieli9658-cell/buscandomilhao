import test from "node:test";
import assert from "node:assert/strict";
import { prepareNginx, INCLUDE } from "./prepare-nginx.mjs";

const tls = `server {
 listen 443 ssl;
 server_name blessialabs.com.br;
 ssl_certificate /cert/fullchain.pem;
 ssl_certificate_key /cert/privkey.pem;
 root /srv/blessia-labs/current/site;
 location = /api/resend-inbound { include /etc/nginx/snippets/blessia-resend-proxy.conf; }
 location / { try_files $uri $uri/ =404; }
}`;
const redirect = `server { listen 443 ssl; server_name www.blessialabs.com.br; return 308 https://blessialabs.com.br$request_uri; }\n`;

test("one insertion preserves TLS, site, Resend and redirect bytes; repeat is idempotent", () => {
  const input = redirect + tls;
  const output = prepareNginx(input);
  assert.equal(output.changed, true);
  assert.ok(output.content.startsWith(redirect));
  assert.equal(output.content.replace(/    # Buscando Milhao: durable receiver only\.\n    include \/etc\/nginx\/snippets\/blessia-buscando-milhao\.conf;\n/, ""), input);
  assert.deepEqual(prepareNginx(output.content), { content: output.content, changed: false });
});

test("ambiguity, changed shape and conflicting routes abort instead of editing", () => {
  for (const source of [tls + tls, tls.replace("blessialabs.com.br;", "blessialabs.com.br www.blessialabs.com.br;"), tls.replace("root /srv/blessia-labs/current/site;", "return 308 https://example.com;"), tls.replace("/api/resend-inbound", "/different-route"), tls.replace("location / {", "location /api/buscando-milhao/webhook {")]) {
    assert.throws(() => prepareNginx(source), /manual_review_required/);
  }
});

test("include in a different server, repeated includes and unbalanced config abort", () => {
  const wrong = redirect.replace("return 308", `include ${INCLUDE}; return 308`) + tls;
  assert.throws(() => prepareNginx(wrong), /manual_review_required/);
  assert.throws(() => prepareNginx(tls.replace("location / {", `include ${INCLUDE}; include ${INCLUDE}; location / {`)), /manual_review_required/);
  assert.throws(() => prepareNginx(tls.slice(0, -1)), /manual_review_required/);
});

test("comments and quoted braces do not create an extra server", () => {
  const input = tls.replace(" root ", ` # server { fake }\n add_header Example "text { unchanged }";\n root `);
  const output = prepareNginx(input);
  assert.ok(output.content.includes('add_header Example "text { unchanged }";'));
  assert.equal(output.content.split(`include ${INCLUDE};`).length, 2);
});
