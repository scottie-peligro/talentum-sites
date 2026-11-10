// Preloaded into `astro build` by the builder (NODE_OPTIONS=--import) to keep the build inside a small container.
// - Astro sizes its image-optimising queue by os.cpus().length; in a container that is the host's core count (often
//   16+), not the container's share, so it would resize that many photos at once. Report BUILD_CPUS (default 1).
// - sharp keeps a decoded-image cache and its own thread pool; turn the cache off and use one thread.
import os from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
const n = Math.max(1, Number(process.env.BUILD_CPUS) || 1);
const real = os.cpus.bind(os);
os.cpus = () => { const c = real(); return Array.from({ length: n }, (_, i) => c[i % Math.max(c.length, 1)] || { model: "cpu", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }); };
try { const sharp = createRequire(join(process.cwd(), "package.json"))("sharp"); sharp.cache(false); sharp.concurrency(1); } catch {}
