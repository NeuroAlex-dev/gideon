// Бесплатный image-генератор без auth: pollinations.ai (Flux Schnell под капотом).
// Prompt передаётся в URL path, изображение возвращается напрямую как PNG.
// Параметры в query: width, height, model, seed, nologo, private.

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

export function buildPollinationsUrl({ prompt, width = 1024, height = 1024, model = "flux", seed }) {
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: "true",
    private: "true",
  });
  if (seed !== undefined && seed !== null) params.set("seed", String(seed));
  return `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?${params.toString()}`;
}

export async function generateImage({ prompt, width, height, model, seed, fetch: fetchImpl = globalThis.fetch }) {
  const url = buildPollinationsUrl({ prompt, width, height, model, seed });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`pollinations: HTTP ${res.status} ${res.statusText || ""}`);
  const ct = res.headers?.get?.("content-type") || "";
  if (!ct.includes("image/")) {
    throw new Error(`pollinations: ожидался image/*, пришёл ${ct || "?"} (status ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, url, contentType: ct };
}
