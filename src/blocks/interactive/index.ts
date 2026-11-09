// Interactive blocks (tabs, accordion, carousel, logo marquee, before/after, counters, timeline).
// Each entry maps a block type to its component; Blocks.astro merges this into its registry.
// Shared rules: every block shows all its content without JavaScript; any script is tiny inline vanilla, emitted
// once per page by the first block of that type (./util.ts once()); ids are unique per page (uid()).
import Tabs from "./Tabs.astro";
import Accordion from "./Accordion.astro";
import Carousel from "./Carousel.astro";
import LogoMarquee from "./LogoMarquee.astro";
import BeforeAfter from "./BeforeAfter.astro";
import Counters from "./Counters.astro";
import Timeline from "./Timeline.astro";

export const INTERACTIVE: Record<string, any> = {
  tabs: Tabs, accordion: Accordion, carousel: Carousel, logo_marquee: LogoMarquee, before_after: BeforeAfter, counters: Counters, timeline: Timeline,
};
