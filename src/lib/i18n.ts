// The renderer's built-in wording (buttons, form labels, cookie banner, 404, …) with English defaults, and the language
// of the page being rendered. Translations for a site's added languages come from Talentum (Website → Settings →
// Languages → "Translate the built-in wording", stored in settings.languages.ui[<code>]); anything missing stays English.
// Keep the keys in step with talentum-pb pb_hooks/lib/sitelang.js UI_STRINGS.
import raw from "../data/bundle.json";

const cfg = (((raw as any).site || {}).settings || {}).languages || {};
const codes: string[] = (Array.isArray(cfg.extra) ? cfg.extra : []).map((l: any) => l && l.code).filter(Boolean);

let cur = "";
/** The language of the page being rendered ("" = the site's main language). Each page sets it before rendering. */
export function setLang(code?: string) { cur = code && codes.includes(code) ? code : ""; }
export const currentLang = () => cur;

export const UI = {
  skip: "Skip to content", menu: "Menu", home: "Home", language: "Language", contact: "Contact", rights: "All rights reserved.",
  overview: "overview", read_more: "Read more", in_depth: "Read the in-depth answer", read_instead: "Read instead", watched: "Watched",
  insights: "Insights", min_read: "min read", by: "By", about_author: "About the author", more_insights: "More insights",
  case_study: "Case study", client: "Client:", more_case_studies: "More case studies", related_case_studies: "Related case studies",
  results_heading: "The results we deliver", common_questions: "common questions", services: "Services", careers: "Careers",
  apply_now: "Apply now", apply_email: "Apply by email", nothing_here: "Nothing here yet.", view_all: "View all", all: "All", filter: "Filter by category",
  nf_title: "Page not found", nf_heading: "We couldn't find that page.", nf_text: "It may have moved. Try the home page, or one of these:",
  cookie_text: "We use cookies to understand how our site is used and to improve it.", privacy_policy: "Privacy policy", cookie_prefs: "Preferences",
  cookie_necessary: "Necessary only", cookie_accept: "Accept all", cookies: "Cookies", cookie_label: "Cookie preferences",
  form_step: "Step", form_of: "of", form_reply: "Where should we send our reply?", form_choose: "Choose…", form_thanks: "Thanks — we'll be in touch shortly.",
  form_error: "Sorry — that didn't send. Please try again", form_fallback: "The fastest way to reach us:", form_book: "Book a consult call", form_back: "Back", form_next: "Next", form_send: "Send", form_or_email: "or email",
  search: "Search", start_here: "Start here", questions: "Questions", welcome_video: "Watch the welcome video",
};
export type UIKey = keyof typeof UI;

/** A built-in phrase in the current page's language (English when there's no translation for it). */
export function t(key: UIKey): string {
  const own = cur ? cfg.ui?.[cur]?.[key] : "";
  return typeof own === "string" && own.trim() ? own : UI[key];
}
/** The phrase as HTML text for set:html (only & < > escaped, so English output is the same as literal template text). */
export const th = (key: UIKey) => t(key).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Right-to-left scripts (html dir="rtl"). */
export const isRtl = (code: string) => /^(ar|he|fa|ur)(-|$)/.test(code);
