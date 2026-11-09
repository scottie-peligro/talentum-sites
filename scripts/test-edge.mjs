// Edge Functions test:  npm run test:edge      (a second or two; no network)
// Runs functions/api/assistant.js against a mock D1 (env.DB), a mock asset store (env.ASSETS, serving a tiny
// /_assistant/index.json) and a stubbed model (global fetch), and checks the question log for "Questions people ask":
// what's stored (redacted question, page, language, score, matched/answered — no IP, no visitor id), and when nothing
// is stored (staging, the setting off, Global Privacy Control, small talk).
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactQuestion, worthLogging } from "../edge/shared.js";
import { onRequestPost } from "../functions/api/assistant.js";

const INDEX = {
  site: "Test site", org: "Test Co", name: "", booking: "",
  chunks: [
    { title: "Recruitment SEO", url: "/services/seo/", text: "Recruitment SEO for staffing firms: technical fixes, job page optimisation and monthly reporting." },
    { title: "Contact details", url: "/contact/", text: "Test Co\nPhone: 0100 000 000" },
    { title: "About", url: "/about/", text: "We are a small marketing team based in Leeds." },
  ],
};

function mockEnv(over = {}) {
  const rows = [];
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { rows.push({ sql, args }); return { success: true }; },
            async first() { rows.push({ sql, args }); return { n: 1 }; },
          };
        },
      };
    },
  };
  const ASSETS = { fetch: async () => new Response(JSON.stringify(INDEX), { headers: { "Content-Type": "application/json" } }) };
  return { env: { DB, ASSETS, SITE_KEY: "test-site", SITE_ENV: "live", ASSISTANT_KEY: "k", ASSISTANT_BASE: "https://model.test/v1", ...over }, rows };
}

let modelReply = { reply: "We do recruitment SEO.", sources: [1], show_booking: false, ask_contact: false, answered: true };
globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelReply) } }], usage: { total_tokens: 42 } }), { status: 200 });

async function ask(env, text, headers = {}, extra = {}) {
  const request = new Request("https://site.test/api/assistant", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9", ...headers },
    body: JSON.stringify({ messages: [{ role: "user", text }], page: "/services/seo/?utm=x", lang: "en-GB", ...extra }),
  });
  const pending = [];
  const res = await onRequestPost({ request, env, waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return res.json();
}
const questionRows = (rows) => rows.filter((r) => /INSERT INTO questions/.test(r.sql));

test("redaction: emails, links, phone numbers, long numbers and names are swapped out; length capped", () => {
  assert.equal(redactQuestion("Email me at jo.bloggs+x@mail.example.co.uk please"), "Email me at [email] please");
  assert.equal(redactQuestion("Call +44 (20) 7946-0958 or 555 123 4567"), "Call [phone] or [phone]");
  assert.equal(redactQuestion("My order 12345678 at https://x.test/a?b=1"), "My order [phone] at [link]", "a long digit run is masked either way");
  assert.equal(redactQuestion("Ref ABC123456"), "Ref ABC[number]");
  assert.equal(redactQuestion("Hi, my name is Jane Doe and I need SEO"), "Hi, my name is [name] and I need SEO");
  assert.equal(redactQuestion("I am Looking for help"), "I am Looking for help", "common words after 'I am' stay");
  assert.equal(redactQuestion("Do you work in 2025 with 40 clients?"), "Do you work in 2025 with 40 clients?", "years and small numbers stay");
  const long = redactQuestion("word ".repeat(200));
  assert.ok(long.length <= 300 && long.endsWith("…"));
  assert.equal(worthLogging("thanks"), false);
  assert.equal(worthLogging("ok great"), false);
  assert.equal(worthLogging("How much does recruitment SEO cost?"), true);
});

test("live: the question is logged redacted with page, language and match flags — never the IP or a visitor id", async () => {
  const { env, rows } = mockEnv();
  const out = await ask(env, "How much does recruitment SEO cost? Email me: a@b.co");
  assert.equal(out.reply, "We do recruitment SEO.");
  const q = questionRows(rows);
  assert.equal(q.length, 1);
  const [id, site, text, path, lang, score, matched, answered, created] = q[0].args;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(site, "test-site");
  assert.equal(text, "How much does recruitment SEO cost? Email me: [email]");
  assert.equal(path, "/services/seo/");
  assert.equal(lang, "en-GB");
  assert.ok(score >= 2, "a good match: " + score); assert.equal(matched, 1); assert.equal(answered, 1);
  assert.ok(Math.abs(created - Date.now()) < 5000);
  assert.ok(!JSON.stringify(q[0].args).includes("203.0.113.9"), "no IP");
  assert.equal(q[0].args.length, 9, "nothing else is stored");
});

test("no good answer: low retrieval score and the model saying it couldn't answer are both kept", async () => {
  const { env, rows } = mockEnv();
  modelReply = { reply: "I don't have that information.", sources: [], answered: false };
  await ask(env, "Do you offer payroll outsourcing services?");
  const [, , , , , score, matched, answered] = questionRows(rows)[0].args;
  assert.ok(score < 2); assert.equal(matched, 0); assert.equal(answered, 0);
  modelReply = { reply: "We do recruitment SEO.", sources: [1], answered: true };
});

test("nothing is logged on staging, with the setting off, with Global Privacy Control, or for small talk", async () => {
  for (const [over, headers, text] of [[{ SITE_ENV: "staging" }, {}, "How much does SEO cost?"], [{ ASSISTANT_LEARN: "0" }, {}, "How much does SEO cost?"],
    [{}, { "Sec-GPC": "1" }, "How much does SEO cost?"], [{}, {}, "thanks!"]]) {
    const { env, rows } = mockEnv(over);
    const out = await ask(env, text, headers);
    assert.ok(out.reply, "the visitor still gets an answer");
    assert.equal(questionRows(rows).length, 0, JSON.stringify({ over, headers, text }));
  }
});

test("a broken questions table never breaks the answer", async () => {
  const { env } = mockEnv();
  env.DB = { prepare: (sql) => ({ bind: () => ({ run: async () => { if (/questions/.test(sql)) throw new Error("no such table: questions"); return {}; }, first: async () => ({ n: 1 }) }) }) };
  const out = await ask(env, "How much does recruitment SEO cost?");
  assert.equal(out.reply, "We do recruitment SEO.");
});
