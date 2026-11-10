// Preloaded into `astro build` by the builder (NODE_OPTIONS=--import). Astro sizes its image-optimising queue by
// os.cpus().length; in a container that is the host's core count (often 16+), not the container's share, so it
// would resize that many photos at once and run out of memory. Report BUILD_CPUS (default 2) instead.
import os from "node:os";
const n = Math.max(1, Number(process.env.BUILD_CPUS) || 2);
const real = os.cpus.bind(os);
os.cpus = () => { const c = real(); return Array.from({ length: n }, (_, i) => c[i % Math.max(c.length, 1)] || { model: "cpu", speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } }); };
