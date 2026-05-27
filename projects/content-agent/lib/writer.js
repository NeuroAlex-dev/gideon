import fs from "node:fs";
import path from "node:path";
import { generate } from "./ai.js";

const STYLE_FILES = [
  "tone-of-voice.md", "brand-code.md", "content-system.md",
  "personal-phrasebook.md", "ideal-post-structure.md",
];

export function loadStyleProfile(styleDir) {
  const parts = [];
  for (const f of STYLE_FILES) {
    const p = path.join(styleDir, f);
    if (fs.existsSync(p)) {
      parts.push(`--- ${f} ---\n${fs.readFileSync(p, "utf8")}`);
    }
  }
  return { present: parts.length > 0, text: parts.join("\n\n") };
}

export const VARIANTS = {
  expert: "Сделай заметно экспертнее: больше глубины, точные формулировки, профессиональная лексика.",
  simpler: "Сделай проще и доступнее: короче предложения, меньше терминов, объясняй на пальцах.",
  humor: "Добавь больше юмора и лёгкого стёба, сохраняя смысл и пользу.",
  cta: "Усиль призыв к действию в конце: чёткий, мотивирующий, без впаривания.",
  shorter: "Сократи в 1.5–2 раза, оставь только самое сильное.",
  rewrite: "Перепиши иначе — другой заход и структура, та же тема и стиль.",
};

const SYSTEM = "Ты пишешь посты от лица автора, строго в его стиле (профиль ниже). Пиши по-русски. Готовый пост для соцсети: заголовок, основная часть, вывод/призыв. Возвращай ТОЛЬКО текст поста без преамбул и без markdown-обёртки ```.";

export function buildPostPrompt({ styleText, userPrompt, variantMode = null }) {
  const styleBlock = styleText
    ? `# Профиль стиля автора\n${styleText}`
    : "# Профиль стиля\n(стиль не обучен — пиши живо, экспертно и по-человечески, без канцелярита)";
  const variantBlock = variantMode && VARIANTS[variantMode]
    ? `\n\n# Доп. инструкция к этому варианту\n${VARIANTS[variantMode]}`
    : "";
  return `${styleBlock}\n\n# Задача\nНапиши пост на тему: ${userPrompt}${variantBlock}`;
}

export async function generatePost({ styleText, userPrompt, variantMode = null, runner, model }) {
  const { text } = await generate({
    systemPrompt: SYSTEM,
    userMessage: buildPostPrompt({ styleText, userPrompt, variantMode }),
    runner,
    model,
  });
  return (text || "").trim();
}
