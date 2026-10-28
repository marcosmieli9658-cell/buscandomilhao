import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const INCLUDE = "/etc/nginx/snippets/blessia-buscando-milhao.conf";
const PREFIX = "/api/buscando-milhao";

// A conservative lexer/parser for a single sites-available file, not an nginx -T parser.
// Preserve every original byte and insert one include only inside an unambiguous server.
function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source[i] === "#") { while (i < source.length && source[i] !== "\n") i++; continue; }
    const start = i;
    if ("{};".includes(source[i])) { tokens.push({ value: source[i++], start, end: i }); continue; }
    let value = "";
    let quote = null;
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        if (i + 1 >= source.length) throw new Error("nginx_unfinished_escape_manual_review_required");
        value += source.slice(i, i + 2); i += 2; continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        else value += char;
        i++; continue;
      }
      if (char === '"' || char === "'") { quote = char; i++; continue; }
      if (/\s/.test(char) || "{};#".includes(char)) break;
      value += char; i++;
    }
    if (quote) throw new Error("nginx_unfinished_quote_manual_review_required");
    if (!value) throw new Error("nginx_empty_token_manual_review_required");
    tokens.push({ value, start, end: i });
  }
  return tokens;
}

function parse(source) {
  const tokens = tokenize(source);
  let index = 0;
  const nodes = (nested = false) => {
    const result = [];
    while (index < tokens.length) {
      if (tokens[index].value === "}") {
        if (!nested) throw new Error("nginx_unbalanced_brace_manual_review_required");
        return { nodes: result, close: tokens[index++] };
      }
      const words = [];
      while (index < tokens.length && !["{", "}", ";"].includes(tokens[index].value)) words.push(tokens[index++]);
      if (!words.length || index === tokens.length || tokens[index].value === "}") throw new Error("nginx_invalid_directive_manual_review_required");
      const delimiter = tokens[index++];
      if (delimiter.value === ";") result.push({ name: words[0].value, args: words.slice(1).map(t => t.value), start: words[0].start, end: delimiter.end });
      else {
        const child = nodes(true);
        result.push({ name: words[0].value, args: words.slice(1).map(t => t.value), start: words[0].start, end: child.close.end, closeStart: child.close.start, children: child.nodes });
      }
    }
    if (nested) throw new Error("nginx_unbalanced_brace_manual_review_required");
    return { nodes: result };
  };
  return nodes().nodes;
}

export function prepareNginx(source) {
  const servers = parse(source);
  if (!servers.length || servers.some(node => node.name !== "server" || !node.children || node.args.length)) throw new Error("nginx_non_server_top_level_manual_review_required");
  const candidates = servers.filter(server => {
    const names = server.children.filter(node => node.name === "server_name");
    const tls = server.children.some(node => node.name === "listen" && node.args.includes("ssl") && node.args.some(v => /(^|:)443$/.test(v)));
    return names.length === 1 && names[0].args.length === 1 && names[0].args[0] === "blessialabs.com.br" && tls;
  });
  if (candidates.length !== 1) throw new Error("nginx_apex_tls_server_ambiguous_manual_review_required");
  const target = candidates[0];
  if (target.children.some(node => node.name === "return")
    || !target.children.some(node => node.name === "root")
    || !target.children.some(node => node.name === "ssl_certificate")
    || !target.children.some(node => node.name === "ssl_certificate_key")) throw new Error("nginx_target_shape_changed_manual_review_required");
  if (!target.children.some(node => node.name === "location" && node.args.includes("/api/resend-inbound"))) throw new Error("nginx_resend_route_not_found_manual_review_required");
  const allIncludes = servers.flatMap(server => server.children.filter(node => node.name === "include" && node.args.includes(INCLUDE)).map(node => ({ server, node })));
  if (allIncludes.length > 1 || allIncludes.some(({ server, node }) => server !== target || node.args.length !== 1)) throw new Error("nginx_include_placement_ambiguous_manual_review_required");
  if (target.children.some(node => node.name === "location" && node.args.some(value => value.includes(PREFIX)))) throw new Error("nginx_prefix_already_configured_manual_review_required");
  if (allIncludes.length === 1) return { content: source, changed: false };
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const insertion = `    # Buscando Milhao: durable receiver only.${newline}    include ${INCLUDE};${newline}`;
  return { content: source.slice(0, target.closeStart) + insertion + source.slice(target.closeStart), changed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , input, output] = process.argv;
  try {
    if (!input || !output || process.argv.length !== 4 || path.resolve(input) === path.resolve(output)) throw new Error("distinct_input_output_required");
    const prepared = prepareNginx(fs.readFileSync(input, "utf8"));
    fs.writeFileSync(output, prepared.content, { flag: "wx", mode: 0o600 });
    console.info(prepared.changed ? "nginx_candidate_include_added" : "nginx_candidate_include_already_present");
  } catch (error) {
    console.error(error.message);
    console.error("No live configuration changed. Review the apex TLS server manually and add only the dedicated include.");
    process.exitCode = 1;
  }
}
