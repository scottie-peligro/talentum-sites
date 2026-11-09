// Sample agent data and a tiny in-memory D1 for scripts/test-agent.mjs (and ad-hoc MCP client checks).
const H = 3600000;
export function sample(over = {}) {
  return {
    version: 1, generated_at: "2026-11-09T10:00:00.000Z",
    organization: { name: "Acme Marketing", legal_name: "Acme Marketing LLC", description: "Marketing for recruiting firms.", phone: "+1 555 0100", email: "hello@example.com",
      address: { street: "1 Main St", city: "Plano", region: "TX", postal_code: "75024", country: "US" }, hours: "Mon–Fri 9–5", service_areas: ["United States"], socials: [] },
    contact: { phone: "+1 555 0100", email: "hello@example.com", contact_page: "/contact/", booking_page: "/book/", hours: "Mon–Fri 9–5" },
    services: [
      { id: "seo", name: "Recruitment SEO", summary: "Get found by candidates.", path: "/service/seo/", category: "Search", prices: [{ name: "SEO audit", amount: 900, currency: "USD", unit: "one-off", from: false, add_on: false }], booking_links: ["darren-15"] },
      { id: "logo-design", name: "Logo design", summary: "A logo your clients remember.", path: "/service/logo-design/", category: "Brand", booking_links: [] },
    ],
    faqs: [
      { id: "f1", question: "How long does an SEO audit take?", answer: "About two weeks.", topic: "", services: ["seo"] },
      { id: "f2", question: "Do you work outside the US?", answer: "Yes, in Canada and the UK too.", topic: "General", services: [] },
    ],
    team: [{ name: "Darren McDougal", job_title: "CMO", linkedin: "" }],
    case_studies: [{ title: "Search traffic up for Birch", summary: "More candidates from search.", path: "/case-studies/birch/", category: "Search" }],
    booking: { requests: true, links: [{ id: "darren-15", title: "15-minute intro", description: "", duration_minutes: 15, url: "https://app.example.com/book/darren-15", services: ["seo"], with: "Darren McDougal" }] },
    prices_shared: true,
    ...over,
  };
}

/** A tiny D1 stand-in: just the statements the Functions use. */
export function fakeDB() {
  const db = { rate: new Map(), inbox: [], slots: new Map() };
  db.prepare = (sql) => {
    let args = [];
    const st = {
      bind: (...a) => { args = a; return st; },
      async first() {
        if (/INSERT INTO ratelimit/.test(sql)) { const [k, reset, now] = args; const cur = db.rate.get(k); const n = !cur || cur.reset < now ? 1 : cur.n + 1; db.rate.set(k, { n, reset: !cur || cur.reset < now ? reset : cur.reset }); return { n }; }
        if (/FROM agent_slots/.test(sql)) return db.slots.get(args[0] + "|" + args[1]) || null;
        throw new Error("unexpected first(): " + sql);
      },
      async run() {
        if (/INSERT INTO inbox/.test(sql)) { const [id, site, env, kind, payload, created] = args; db.inbox.push({ id, site, env, kind, payload: JSON.parse(payload), created }); return {}; }
        if (/DELETE FROM ratelimit/.test(sql)) return {};
        throw new Error("unexpected run(): " + sql);
      },
    };
    return st;
  };
  return db;
}

