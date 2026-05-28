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
  emoji: "Добавь заметно больше эмодзи: в начало абзацев для эмфазы, в списках, рядом с ключевыми идеями. Только релевантные эмодзи (не спам), смысл и стиль не теряй.",
};

const SYSTEM = "Ты пишешь посты от лица автора, строго в его стиле (профиль ниже). Пиши по-русски. Готовый пост для соцсети: заголовок, основная часть, вывод/призыв. Возвращай ТОЛЬКО текст поста без преамбул и без markdown-обёртки ```.\n\nВАЖНО про разнообразие: НЕ повторяй дословно характерные обороты, метафоры и фразы из предыдущих постов автора (если они приложены ниже). Каждый раз свежие формулировки — синонимы и перифразы. Стиль остаётся узнаваемым через лексику, ритм и структуру, а не через повтор одних и тех же словосочетаний от поста к посту.";

export function buildPostPrompt({ styleText, userPrompt, variantMode = null, recentPosts = [] }) {
  const styleBlock = styleText
    ? `# Профиль стиля автора\n${styleText}`
    : "# Профиль стиля\n(стиль не обучен — пиши живо, экспертно и по-человечески, без канцелярита)";
  const recentBlock = recentPosts && recentPosts.length
    ? `\n\n# Недавние посты автора (НЕ повторяй из них дословные обороты, ищи синонимы)\n${recentPosts.map((p, i) => `--- Пост ${i + 1} ---\n${p}`).join("\n\n")}`
    : "";
  const variantBlock = variantMode && VARIANTS[variantMode]
    ? `\n\n# Доп. инструкция к этому варианту\n${VARIANTS[variantMode]}`
    : "";
  return `${styleBlock}${recentBlock}\n\n# Задача\nНапиши пост на тему: ${userPrompt}${variantBlock}`;
}

export async function generatePost({ styleText, userPrompt, variantMode = null, recentPosts = [], runner, model }) {
  const { text } = await generate({
    systemPrompt: SYSTEM,
    userMessage: buildPostPrompt({ styleText, userPrompt, variantMode, recentPosts }),
    runner,
    model,
  });
  return (text || "").trim();
}
