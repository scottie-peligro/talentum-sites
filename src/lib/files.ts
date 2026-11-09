// File types a form can accept — the same groups as Talentum (pb_hooks/lib/websites.js FILE_GROUPS) and the
// edge's hard ceiling (edge/shared.js FILE_EXT).
export const FILE_GROUPS: Record<string, { label: string; ext: string[] }> = {
  images: { label: "images", ext: ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"] },
  pdf: { label: "PDF", ext: ["pdf"] },
  word: { label: "Word", ext: ["doc", "docx", "odt", "rtf"] },
  excel: { label: "Excel", ext: ["xls", "xlsx", "csv", "ods"] },
  powerpoint: { label: "PowerPoint", ext: ["ppt", "pptx", "odp", "key"] },
  text: { label: "text", ext: ["txt", "md"] },
  zip: { label: "zip", ext: ["zip"] },
  design: { label: "design files", ext: ["ai", "eps", "psd", "svg", "indd", "fig", "sketch"] },
  video: { label: "video", ext: ["mp4", "mov", "webm", "m4v"] },
  audio: { label: "audio", ext: ["mp3", "wav", "m4a"] },
};
FILE_GROUPS.common = { label: "images, PDF, Word, Excel, PowerPoint or text", ext: ["images", "pdf", "word", "excel", "powerpoint", "text"].flatMap((g) => FILE_GROUPS[g].ext) };

export function uploadRules(x: any) {
  const accept = (Array.isArray(x?.accept) ? x.accept : String(x?.accept || "").split(",")).map((a: string) => String(a).trim()).filter((a: string) => FILE_GROUPS[a]);
  const groups = accept.length ? accept : ["common"];
  const ext = [...new Set(groups.flatMap((g: string) => FILE_GROUPS[g].ext))] as string[];
  const max_mb = Math.max(1, Math.min(25, Number(x?.max_mb) || 10));
  const max_files = Math.max(1, Math.min(10, Number(x?.max_files) || 3));
  const kinds = groups.map((g: string) => FILE_GROUPS[g].label);
  const what = kinds.length > 1 ? kinds.slice(0, -1).join(", ") + " or " + kinds[kinds.length - 1] : kinds[0];
  return { ext, max_mb, max_files, accept: ext.map((e) => "." + e).join(","), hint: `${what[0].toUpperCase() + what.slice(1)} · up to ${max_mb} MB each${max_files > 1 ? ` · ${max_files} files at most` : ""}` };
}
