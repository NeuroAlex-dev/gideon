const API_BASE = "/api/sales";
const SESSION_KEY = "gideon_parser_session";
const params = new URLSearchParams(location.search);
const idParam = params.get("id");
const isNew = idParam === "new" || !idParam;
let cid = isNew ? null : Number(idParam);

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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path}: ${res.status} ${text}`);
  }
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

function renderBriefFields(c = {}) {
  return FIELDS.map(([k, label, type]) => `
    <div class="field">
      <label>${esc(label)}</label>
      ${type === "textarea" ? `<textarea data-key="${k}" rows="3">${esc(c[k] ?? "")}</textarea>` : `<input data-key="${k}" value="${esc(c[k] ?? "")}">`}
    </div>
  `).join("");
}

function collectBriefValues(root) {
  const patch = {};
  for (const el of root.querySelectorAll("[data-key]")) {
    patch[el.dataset.key] = el.value;
  }
  if (patch.daily_message_limit !== undefined && patch.daily_message_limit !== "") {
    patch.daily_message_limit = Number(patch.daily_message_limit) || 15;
  } else {
    delete patch.daily_message_limit;
  }
  return patch;
}

async function renderBriefCreate() {
  document.getElementById("campaign-title").textContent = "Новая кампания";
  const root = document.getElementById("tab-brief");
  root.innerHTML = renderBriefFields() +
    `<button id="create-brief" style="margin-top: 1em; padding: 0.5em 1em;">Создать кампанию</button>` +
    `<p style="color:#888; margin-top: 0.5em; font-size: 13px;">Минимум — заполни «Название». Остальное можно дозаполнить потом.</p>`;
  document.getElementById("create-brief").addEventListener("click", async () => {
    const patch = collectBriefValues(root);
    if (!patch.name || !patch.name.trim()) {
      alert("Заполни «Название»");
      return;
    }
    try {
      const created = await api("POST", "/campaigns", patch);
      location.href = `./sales-campaign.html?id=${created.id}`;
    } catch (e) {
      alert("Не удалось создать: " + e.message);
    }
  });
}

async function renderBrief() {
  const c = await api("GET", `/campaigns/${cid}`);
  document.getElementById("campaign-title").textContent = c.name || "Без названия";
  const root = document.getElementById("tab-brief");
  root.innerHTML = renderBriefFields(c) +
    `<button id="save-brief" style="margin-top: 1em; padding: 0.5em 1em;">Сохранить</button>`;
  document.getElementById("save-brief").addEventListener("click", async () => {
    const patch = collectBriefValues(root);
    try {
      await api("PUT", `/campaigns/${cid}`, patch);
      const btn = document.getElementById("save-brief");
      btn.textContent = "✓ Сохранено";
      setTimeout(() => { btn.textContent = "Сохранить"; }, 1500);
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });
}

async function renderLeads() {
  const leads = await api("GET", `/campaigns/${cid}/leads`);
  const root = document.getElementById("tab-leads");
  const tableHtml = leads.length
    ? `<table><thead><tr><th>Username</th><th>Имя</th><th>Статус</th><th>Источник</th></tr></thead><tbody>
        ${leads.map((l) => `<tr><td>@${esc(l.tg_username || "")}</td><td>${esc(l.first_name || "")}</td><td>${esc(l.status)}</td><td>${esc(l.source_chat_title || "")}</td></tr>`).join("")}
      </tbody></table>`
    : "<p>Лидов пока нет.</p>";

  root.innerHTML = `
    <div class="add-leads-block">
      <h3>Добавить лидов</h3>
      <p style="color:#888; font-size: 13px; margin: 0 0 0.5em;">Список <code>@username</code>, по одному на строку. Без <code>@</code> тоже принимается.</p>
      <textarea id="leads-input" rows="6" style="width:100%; box-sizing: border-box; padding: 0.5em; font-family: monospace;" placeholder="@username1
@username2
username3"></textarea>
      <button id="add-leads-btn" style="margin-top: 0.5em; padding: 0.5em 1em;">Добавить</button>
      <p id="add-leads-result" style="margin-top: 0.5em; font-size: 13px;"></p>
    </div>
    <h3 style="margin-top: 1.5em;">Текущие лиды (${leads.length})</h3>
    ${tableHtml}
  `;

  document.getElementById("add-leads-btn").addEventListener("click", async () => {
    const raw = document.getElementById("leads-input").value;
    const usernames = raw.split(/\s+/).map((s) => s.trim().replace(/^@+/, "")).filter(Boolean);
    if (!usernames.length) {
      alert("Вставь хотя бы один username");
      return;
    }
    const leadObjs = usernames.map((u) => ({ tg_username: u }));
    try {
      const result = await api("POST", `/campaigns/${cid}/leads`, { leads: leadObjs });
      const resultEl = document.getElementById("add-leads-result");
      const inserted = result?.inserted ?? 0;
      const skipped = usernames.length - inserted;
      resultEl.textContent = `✓ Добавлено: ${inserted}` +
        (skipped > 0 ? ` (пропущено: ${skipped})` : "") +
        ` · всего в кампании: ${result?.total ?? "—"}`;
      document.getElementById("leads-input").value = "";
      setTimeout(() => renderLeads(), 1500);
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  });
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
  if (name === "brief") {
    if (isNew) renderBriefCreate().catch((e) => console.error(e));
    else renderBrief().catch((e) => console.error(e));
  }
  if (name === "leads" && !isNew) renderLeads().catch((e) => console.error(e));
  if (name === "stats" && !isNew) renderStats().catch((e) => console.error(e));
}

if (isNew) {
  const leadsTab = document.querySelector('.tab[data-tab="leads"]');
  const statsTab = document.querySelector('.tab[data-tab="stats"]');
  if (leadsTab) {
    leadsTab.style.opacity = "0.4";
    leadsTab.style.cursor = "not-allowed";
    leadsTab.title = "Сначала создай кампанию";
  }
  if (statsTab) {
    statsTab.style.opacity = "0.4";
    statsTab.style.cursor = "not-allowed";
    statsTab.title = "Сначала создай кампанию";
  }
}

for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => {
    if (isNew && t.dataset.tab !== "brief") return;
    activateTab(t.dataset.tab);
  });
}
activateTab("brief");
