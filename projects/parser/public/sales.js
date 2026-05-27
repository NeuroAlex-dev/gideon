const API_BASE = "/api/sales";
const SESSION_KEY = "gideon_parser_session";

function getToken() {
  return localStorage.getItem(SESSION_KEY) || "";
}

function setToken(t) {
  localStorage.setItem(SESSION_KEY, t);
}

function clearToken() {
  localStorage.removeItem(SESSION_KEY);
}

async function api(method, path, body) {
  const token = getToken();
  const headers = { "content-type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { clearToken(); showLogin(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function login(password) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) throw new Error("bad password");
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.hint || j.error || `login failed: ${res.status}`);
  }
  const j = await res.json();
  return j.token;
}

async function needsSetup() {
  const res = await fetch("/api/auth/needs-setup");
  if (!res.ok) return false;
  const j = await res.json();
  return !!j.needsSetup;
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
  document.getElementById("setup-hint").hidden = true;
  document.getElementById("auth-error").textContent = "";
  document.getElementById("pwd").value = "";
}

async function showLoginOrSetup() {
  showLogin();
  if (await needsSetup()) {
    document.getElementById("setup-hint").hidden = false;
  }
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
    const token = await login(pwd);
    setToken(token);
    showMain();
  } catch (e) {
    err.textContent = e.message === "bad password" ? "Неверный пароль" : (e.message || "Ошибка");
  }
});

document.getElementById("pwd").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("login").click();
});

document.getElementById("logout-btn")?.addEventListener("click", () => {
  clearToken();
  showLoginOrSetup();
});

if (getToken()) showMain(); else showLoginOrSetup();
