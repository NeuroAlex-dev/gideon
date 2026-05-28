import { generate, extractJson } from "./ai.js";

export function extractiveSummary(text, maxSentences = 2, maxChars = 280) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "(без текста)";
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let s = sentences.slice(0, maxSentences).join(" ").trim();
  if (s.length > maxChars) s = s.slice(0, maxChars) + "…";
  return s;
}

export function sortByEngagement(items) {
  return [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
}

const RESHAPE = {
  shorter: "Сделай дайджест заметно короче: оставь только суть по каждой новости, убери детали.",
  detailed: "Раскрой дайджест подробнее: добавь контекст и почему это важно по каждой новости.",
};

// AI-саммари: одна Claude-генерация на всю пачку постов, выход — JSON-массив строк.
// Возвращает массив той же длины и порядка, что и items.
// Бросает ошибку при поломанном JSON или несовпадении длины — вызывающий должен сделать fallback.
export async function aiSummarize({ items, runner, model, maxChars = 1500 }) {
  if (!items.length) return [];
  const trimmed = items.map((it, i) => ({
    i: i + 1,
    title: (it.title || "").slice(0, 200),
    text: (it.text || "").slice(0, maxChars),
  }));
  const system = "Ты редактор контент-дайджеста. На вход — JSON-массив постов из соцсетей. Для каждого напиши краткое содержание 1-2 предложения по-русски: о чём пост, ключевая суть, без копипасты, без воды, без оценок и эмодзи. Возвращай СТРОГО JSON-массив строк той же длины и в том же порядке.";
  const userMessage = `Посты:\n${JSON.stringify(trimmed, null, 2)}\n\nОтвет — только JSON-массив строк (без преамбулы, без markdown-обёртки):`;
  const { text } = await generate({ systemPrompt: system, userMessage, runner, model });
  let parsed;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (e) {
    throw new Error(`aiSummarize: парсинг JSON провален: ${e.message}; raw: ${String(text).slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`aiSummarize: ожидался массив, получено: ${typeof parsed}`);
  if (parsed.length !== items.length) throw new Error(`aiSummarize: длина ${parsed.length} ≠ ${items.length}`);
  return parsed.map((s) => String(s).trim());
}

export async function reshapeDigest({ currentText, mode, runner, model }) {
  const instruction = RESHAPE[mode] || RESHAPE.shorter;
  const system = "Ты редактируешь дайджест AI-новостей по-русски. Сохрани структуру (платформа, заголовки, ссылки), измени только подачу. Возвращай только готовый текст дайджеста.";
  const { text } = await generate({
    systemPrompt: system,
    userMessage: `${instruction}\n\nТекущий дайджест:\n${currentText}`,
    runner, model,
  });
  return (text || "").trim();
}
