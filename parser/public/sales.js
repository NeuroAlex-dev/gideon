const API_BASE = "/api/sales";
const TOKEN_KEY = "sales_token";

async function api(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "x-auth-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function deriveToken(password) {
  const res = await fetch(`${API_BASE}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("bad password");
  const j = await res.json();
  return j.token;
}

function esc(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

function renderCard(c) {
  return `<div class="campaign-card">
    <h3>${esc(c.name)}</h3>
    <div class="meta">
      Статус: <span class="status-${esc(c.status)}">${esc(c.status)}</span> ·
      Режим: ${esc(c.mode || "—")}
    </div>
    <div>
      <a href="./sales-campaign.html?id=${c.id}">Открыть</a>
      <button id="pause-${c.id}">${c.status === "running" ? "Пауза" : (c.status === "paused" || c.status === "ready" ? "Запустить" : "—")}</button>
    </div>
  </div>`;
}

async function loadCampaigns() {
  try {
    const list = await api("GET", "/campaigns");
    const root = document.getElementById("campaigns-list");
    root.innerHTML = list.map(renderCard).join("") || "<p>Кампаний нет. Создай через бота: /sales</p>";
    for (const c of list) {
      const btn = document.getElementById(`pause-${c.id}`);
      if (!btn) continue;
      btn.addEventListener("click", async () => {
        try {
          await api("POST", `/campaigns/${c.id}/${c.status === "running" ? "pause" : "start"}`);
          loadCampaigns();
        } catch (e) { alert(e.message); }
      });
    }
  } catch (e) {
    if (e.message !== "unauthorized") console.error(e);
  }
}

function showLogin() {
  document.getElementById("auth-section").hidden = false;
  document.getElementById("campaigns-section").hidden = true;
}
function showMain() {
  document.getElementById("auth-section").hidden = true;
  document.getElementById("campaigns-section").hidden = false;
  loadCampaigns();
}

document.getElementById("login").addEventListener("click", async () => {
  const pwd = document.getElementById("pwd").value;
  const err = document.getElementById("auth-error");
  err.textContent = "";
  try {
    const token = await deriveToken(pwd);
    localStorage.setItem(TOKEN_KEY, token);
    showMain();
  } catch (e) {
    err.textContent = "Неверный пароль";
  }
});

if (localStorage.getItem(TOKEN_KEY)) showMain(); else showLogin();
