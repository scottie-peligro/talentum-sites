// Every downloaded media file, imported so Astro optimises it (AVIF/WebP, responsive widths, real dimensions).
import type { ImageMetadata } from "astro";

const files = import.meta.glob<{ default: ImageMetadata }>("../media/*.{jpg,jpeg,png,webp,avif,gif,tif,tiff}", { eager: true });
const svgs = import.meta.glob<string>("../media/*.svg", { eager: true, query: "?url", import: "default" });
const other = import.meta.glob<string>("../media/*.{mp4,webm,pdf,ico}", { eager: true, query: "?url", import: "default" });

const byFile = new Map<string, ImageMetadata>();
for (const [p, mod] of Object.entries(files)) byFile.set(p.split("/").pop()!, mod.default);
const urlByFile = new Map<string, string>();
for (const [p, u] of Object.entries({ ...svgs, ...other })) urlByFile.set(p.split("/").pop()!, u);

export const imageFile = (file?: string) => (file ? byFile.get(file) : undefined);
export const assetUrl = (file?: string) => (file ? urlByFile.get(file) : undefined);
