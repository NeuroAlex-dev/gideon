// Claude переводит смысл русского поста в английский image-prompt.
// Английский — потому что Flux / SDXL / DALL-E лучше работают с английским.
// Никакого текста на картинке: image-модели плохо рендерят буквы (особенно кириллицу).
import { generate } from "./ai.js";

const SYSTEM =
  "Ты переводишь смысл русского поста в визуальный prompt для image-генератора. " +
  "Создай ОДНУ СТРОКУ английского prompt'а: конкретный subject, композиция, стиль (photorealistic / illustration / 3d render), освещение, детализация. " +
  "НИКАКОГО текста на картинке: добавь в конце 'no text, no letters, no captions'. " +
  "Стиль современный: бизнес-фото, минималистичная иллюстрация, концептуальное 3D — в зависимости от темы. " +
  "Возвращай ТОЛЬКО prompt одной строкой, без преамбулы, без кавычек, без markdown.";

export async function buildImagePromptFromPost({ postText, runner, model, maxChars = 2000 }) {
  const text = String(postText || "").trim();
  if (!text) return "";
  const trimmed = text.slice(0, maxChars);
  const userMessage = `Пост (русский):\n${trimmed}\n\nДай английский image prompt одной строкой (write the prompt in english):`;
  const { text: out } = await generate({ systemPrompt: SYSTEM, userMessage, runner, model });
  return String(out || "").replace(/\s+/g, " ").trim();
}
