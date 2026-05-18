import { ensureConnected } from "./telegram.js";

export function filterAndSortGroups(dialogs) {
  const out = [];
  for (const d of dialogs) {
    const e = d.entity || {};
    let type = null;
    if (d.isGroup && !d.isChannel) type = "group";
    else if (d.isChannel && e.megagroup) type = "supergroup";
    if (!type) continue;

    out.push({
      id: String(e.id),
      title: e.title || "(no title)",
      username: e.username || null,
      membersCount: Number(e.participantsCount || 0),
      type,
    });
  }
  out.sort((a, b) => b.membersCount - a.membersCount);
  return out;
}

export async function listOwnerGroups() {
  const c = await ensureConnected();
  const dialogs = await c.getDialogs({ limit: 500 });
  return filterAndSortGroups(dialogs);
}
