import { generate } from "./ai.js";

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
