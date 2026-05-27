const API_BASE = "/api/sales";
const SESSION_KEY = "gideon_parser_session";
const cid = Number(new URLSearchParams(location.search).get("id"));

async function api(method, path, body) {
  const token = localStorage.getItem(SESSION_KEY) || "";
  const headers = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = "./sales.html"; throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function esc(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

const FIELDS = [
  ["name", "Название", "input"],
  ["offer_text", "Оффер", "textarea"],
  ["offer_url", "Ссылка на оффер", "input"],
  ["target_audience", "ЦА", "textarea"],
  ["goal_ikr", "ИКР", "textarea"],
  ["conversation_context", "Контекст переписки (о чём и с кем)", "textarea"],
  ["first_message_template", "Шаблон первого сообщения", "textarea"],
  ["supporting_materials", "Доп. материалы (ссылки/файлы/инфа)", "textarea"],
  ["tone", "Тон", "input"],
  ["stop_phrases", "Стоп-фразы", "textarea"],
  ["daily_message_limit", "Дневной лимит", "input"],
];

async function renderBrief() {
  const c = await api("GET", `/campaigns/${cid}`);
  document.getElementById("campaign-title").textContent = c.name;
  const root = document.getElementById("tab-brief");
  root.innerHTML = FIELDS.map(([k, label, type]) => `
    <div class="field">
      <label>${esc(label)}</label>
      ${type === "textarea" ? `<textarea data-key="${k}" rows="3">${esc(c[k] ?? "")}</textarea>` : `<input data-key="${k}" value="${esc(c[k] ?? "")}">`}
    </div>
  `).join("") + `<button id="save-brief" style="margin-top: 1em; padding: 0.5em 1em;">Сохранить</button>`;
  document.getElementById("save-brief").addEventListener("click", async () => {
    const patch = {};
    for (const el of root.querySelectorAll("[data-key]")) {
      patch[el.dataset.key] = el.value;
    }
    patch.daily_message_limit = Number(patch.daily_message_limit) || 15;
    await api("PUT", `/campaigns/${cid}`, patch);
    alert("Сохранено");
  });
}

async function renderLeads() {
  const leads = await api("GET", `/campaigns/${cid}/leads`);
  const root = document.getElementById("tab-leads");
  if (!leads.length) { root.innerHTML = "<p>Лидов пока нет.</p>"; return; }
  root.innerHTML = `<table><thead><tr><th>Username</th><th>Имя</th><th>Статус</th><th>Источник</th></tr></thead><tbody>
    ${leads.map((l) => `<tr><td>@${esc(l.tg_username || "")}</td><td>${esc(l.first_name || "")}</td><td>${esc(l.status)}</td><td>${esc(l.source_chat_title || "")}</td></tr>`).join("")}
  </tbody></table>`;
}

async function renderStats() {
  const s = await api("GET", `/campaigns/${cid}/stats`);
  const root = document.getElementById("tab-stats");
  root.innerHTML = `
    <div>Всего лидов: <b>${s.leads_total}</b></div>
    <div>Отправлено: <b>${s.messages_outbound}</b></div>
    <div>Ответили: <b>${s.messages_inbound}</b></div>
    <h3>По статусам</h3>
    <ul>${Object.entries(s.leads_by_status).map(([k, v]) => `<li>${esc(k)}: ${v}</li>`).join("") || "<li>—</li>"}</ul>
  `;
}

function activateTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  document.getElementById("tab-brief").hidden = name !== "brief";
  document.getElementById("tab-leads").hidden = name !== "leads";
  document.getElementById("tab-stats").hidden = name !== "stats";
  if (name === "brief") renderBrief().catch((e) => console.error(e));
  if (name === "leads") renderLeads().catch((e) => console.error(e));
  if (name === "stats") renderStats().catch((e) => console.error(e));
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => activateTab(t.dataset.tab));
activateTab("brief");
