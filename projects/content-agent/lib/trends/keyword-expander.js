// Разворачивает нишу в 6-8 коротких поисковых запросов — Google Trends работает только
// с короткими 1-3-словными запросами с реальным объёмом поиска. Длинные фразы вроде
// "Вайбкодинг для бизнеса" GT не понимает. Claude знает синонимы/смежные термины,
// которые Google реально гуглят, и возвращает их JSON-массивом.
import { generate, extractJson } from "../ai.js";

const SYSTEM = "Ты эксперт по поисковому маркетингу и контенту. На вход — нишевое направление. На выход — JSON-массив из 6-8 коротких русских поисковых запросов (1-3 слова каждый), которыми реальные люди ищут темы из этой ниши в Google. Запросы должны быть короткими, реалистичными (то что реально гуглят, не искусственные термины), разнообразными (разные углы ниши). Возвращай СТРОГО JSON-массив строк, ничего больше.";

export async function expandNiche({ niche, runner, model, max = 8 }) {
  const niche0 = String(niche).trim();
  if (!niche0) return [];
  const fallback = [niche0];
  let text;
  try {
    const r = await generate({
      systemPrompt: SYSTEM,
      userMessage: `Ниша: "${niche0}"\n\nДай 6-8 коротких поисковых запросов на русском. Пример формата:\n["вайбкодинг","AI бизнес","cursor","no-code","автоматизация бизнеса"]`,
      runner,
      model,
    });
    text = r.text;
  } catch (e) {
    console.warn(`[keyword-expander] AI ошибка: ${e.message}`);
    return fallback;
  }
  let parsed;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.warn(`[keyword-expander] невалидный JSON от AI, fallback на исходную`);
    return fallback;
  }
  if (!Array.isArray(parsed) || !parsed.length) return fallback;
  // Исходная ниша всегда первая (попробуем как есть, вдруг GT её знает),
  // потом сгенерированные — без дублей и пустых.
  const out = [niche0];
  const seen = new Set([niche0.toLowerCase()]);
  for (const raw of parsed) {
    const s = String(raw).trim();
    if (!s) continue;
    if (seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
