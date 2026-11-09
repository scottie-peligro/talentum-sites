// Per-page helpers for the interactive blocks. Astro.locals is a fresh object for every page render, so these
// count and remember per page: unique ids when a block appears twice, and "emit this script/style once".
type State = { n: number; once: Set<string> };
const state = (locals: any): State => (locals.__ix ||= { n: 0, once: new Set<string>() });

/** A short id unique on this page (e.g. "tabs3"), for aria-controls / labelledby. */
export function uid(locals: any, prefix: string) {
  const s = state(locals);
  s.n += 1;
  return `${prefix}${s.n}`;
}

/** True the first time it's asked for `key` on this page: the block that gets it emits the shared script. */
export function once(locals: any, key: string) {
  const s = state(locals);
  if (s.once.has(key)) return false;
  s.once.add(key);
  return true;
}
