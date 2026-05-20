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

const $ = (id) => document.getElementById(id);

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function showOnly(...ids) {
  for (const el of document.querySelectorAll(".screen")) el.classList.add("hidden");
  for (const id of ids) show(id);
}

async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function showLoginError(msg) {
  const el = $("login-error");
  el.textContent = msg;
  show("login-error");
}

function showAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  show("auth-error");
}

let authState = { phone: "", phoneCodeHash: "" };

async function init() {
  if (!getToken()) {
    await routeUnauthenticated();
    return;
  }
  const { status } = await api("/api/auth/me");
  if (status !== 200) {
    clearToken();
    await routeUnauthenticated();
    return;
  }
  await loadAfterLogin();
}

async function routeUnauthenticated() {
  const { body } = await api("/api/auth/needs-setup");
  if (body && body.needsSetup) {
    showSetupScreen();
  } else {
    showLoginScreen();
  }
}

function hideAuthButtons() {
  hide("logout-btn");
  hide("change-password-btn");
}

function showLoginScreen() {
  hideAuthButtons();
  showOnly("login-screen");
  setTimeout(() => $("login-form").querySelector("input[name=password]")?.focus(), 50);
}

function showSetupScreen() {
  hideAuthButtons();
  showOnly("setup-screen");
  setTimeout(() => $("setup-form").querySelector("input[name=password]")?.focus(), 50);
}

async function loadAfterLogin() {
  show("logout-btn");
  show("change-password-btn");
  const { status, body } = await api("/api/auth/status");
  if (status === 401) {
    clearToken();
    await routeUnauthenticated();
    return;
  }
  if (!body.authorized) {
    showOnly("auth-screen");
    if (!body.hasCredentials) {
      show("no-credentials");
    } else {
      show("phone-form");
    }
  } else {
    showOnly("parser-screen");
    await loadChats();
  }
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("login-error");
  const password = new FormData(e.target).get("password");
  const { status, body } = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (status === 429) {
    showLoginError(`Слишком много попыток. Подожди ${body.retryAfter} сек.`);
    return;
  }
  if (status === 500 && body.error === "no_password_set") {
    showLoginError(body.hint || "Пароль не задан на сервере.");
    return;
  }
  if (status !== 200) {
    showLoginError(body.error === "wrong_password" ? "Неверный пароль" : body.error || "Ошибка");
    return;
  }
  setToken(body.token);
  e.target.reset();
  await loadAfterLogin();
});

$("forgot-password-link").addEventListener("click", (e) => {
  e.preventDefault();
  hideAuthButtons();
  showOnly("forgot-password-screen");
});

$("forgot-back-btn").addEventListener("click", async () => {
  await routeUnauthenticated();
});

$("logout-btn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  clearToken();
  await routeUnauthenticated();
});

$("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("setup-error");
  const fd = new FormData(e.target);
  const password = fd.get("password");
  const password2 = fd.get("password2");
  if (password !== password2) {
    showSetupError("Пароли не совпадают");
    return;
  }
  if (String(password).length < 8) {
    showSetupError("Пароль должен быть минимум 8 символов");
    return;
  }
  const { status, body } = await api("/api/auth/setup", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (status === 409) {
    showSetupError("Пароль уже установлен. Обнови страницу.");
    return;
  }
  if (status !== 200) {
    showSetupError(body.hint || body.error || "Ошибка");
    return;
  }
  setToken(body.token);
  e.target.reset();
  await loadAfterLogin();
});

function showSetupError(msg) {
  const el = $("setup-error");
  el.textContent = msg;
  show("setup-error");
}

$("change-password-btn").addEventListener("click", () => {
  hide("change-password-error");
  hide("change-password-success");
  $("change-password-form").reset();
  showOnly("change-password-screen");
  setTimeout(() => $("change-password-form").querySelector("input[name=currentPassword]")?.focus(), 50);
});

$("change-password-cancel").addEventListener("click", async () => {
  await loadAfterLogin();
});

$("change-password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("change-password-error");
  hide("change-password-success");
  const fd = new FormData(e.target);
  const currentPassword = fd.get("currentPassword");
  const newPassword = fd.get("newPassword");
  const newPassword2 = fd.get("newPassword2");
  if (newPassword !== newPassword2) {
    showChangePasswordError("Новые пароли не совпадают");
    return;
  }
  if (String(newPassword).length < 8) {
    showChangePasswordError("Новый пароль должен быть минимум 8 символов");
    return;
  }
  const { status, body } = await api("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (status === 401 && body.error === "wrong_current_password") {
    showChangePasswordError("Текущий пароль неверный");
    return;
  }
  if (status !== 200) {
    showChangePasswordError(body.hint || body.error || "Ошибка");
    return;
  }
  e.target.reset();
  show("change-password-success");
  setTimeout(() => loadAfterLogin(), 1500);
});

function showChangePasswordError(msg) {
  const el = $("change-password-error");
  el.textContent = msg;
  show("change-password-error");
}

$("phone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("auth-error");
  const phone = new FormData(e.target).get("phone").trim();
  const { status, body } = await api("/api/auth/send-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  if (status !== 200) {
    showAuthError(body.message || body.hint || body.error || "Ошибка");
    return;
  }
  authState = { phone, phoneCodeHash: body.phoneCodeHash };
  hide("phone-form");
  show("code-form");
});

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("auth-error");
  const code = new FormData(e.target).get("code").trim();
  const { status, body } = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ phone: authState.phone, phoneCodeHash: authState.phoneCodeHash, code }),
  });
  if (status === 400 && body.error === "2fa_required") {
    authState.code = code;
    hide("code-form");
    show("password-form");
    return;
  }
  if (status !== 200) {
    showAuthError(body.message || body.error || "Ошибка");
    return;
  }
  await loadAfterLogin();
});

$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("auth-error");
  const password = new FormData(e.target).get("password");
  const { status, body } = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({
      phone: authState.phone,
      phoneCodeHash: authState.phoneCodeHash,
      code: authState.code,
      password,
    }),
  });
  if (status !== 200) {
    showAuthError(body.message || body.error || "Ошибка");
    return;
  }
  await loadAfterLogin();
});

let allChats = [];
let selectedChatId = null;
let lastJobId = null;

async function loadChats() {
  const { status, body } = await api("/api/chats");
  if (status === 401) {
    clearToken();
    await routeUnauthenticated();
    return;
  }
  if (status !== 200) {
    $("parser-error").textContent = body.message || body.error || "Не удалось загрузить чаты";
    show("parser-error");
    return;
  }
  allChats = body.chats || [];
  renderChats(allChats);
}

function renderChats(chats) {
  const ul = $("chats-list");
  ul.innerHTML = "";
  for (const c of chats) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.innerHTML = `<span class="members">${c.membersCount.toLocaleString()}</span>${escapeHtml(c.title)}`;
    li.addEventListener("click", () => selectChat(c));
    ul.appendChild(li);
  }
}

function selectChat(c) {
  selectedChatId = c.id;
  for (const li of document.querySelectorAll("#chats-list li")) {
    li.classList.toggle("selected", li.dataset.id === c.id);
  }
  $("parse-button").disabled = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("chat-search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderChats(allChats.filter((c) => c.title.toLowerCase().includes(q)));
});

document.querySelectorAll('input[name="source"]').forEach((r) => {
  r.addEventListener("change", () => {
    const isList = r.value === "list" && r.checked;
    $("source-list").classList.toggle("hidden", !isList);
    $("source-ref").classList.toggle("hidden", isList);
    $("parse-button").disabled = isList ? !selectedChatId : !$("chat-ref-input").value.trim();
  });
});

$("chat-ref-input").addEventListener("input", (e) => {
  $("parse-button").disabled = !e.target.value.trim();
});

$("parse-button").addEventListener("click", async () => {
  hide("parser-error");
  hide("result");
  $("parse-button").disabled = true;
  $("parser-status").textContent = "Парсю…";
  show("parser-status");

  const source = document.querySelector('input[name="source"]:checked').value;
  let chatRef;
  if (source === "list") {
    const c = allChats.find((x) => x.id === selectedChatId);
    chatRef = c.username ? "@" + c.username : c.id;
  } else {
    chatRef = $("chat-ref-input").value.trim();
  }

  const { status, body } = await api("/api/parse", {
    method: "POST",
    body: JSON.stringify({ chatRef }),
  });
  hide("parser-status");
  $("parse-button").disabled = false;

  if (status === 429) {
    $("parser-error").textContent = `Telegram попросил подождать ${body.retryAfter} сек. Попробуй позже.`;
    show("parser-error");
    return;
  }
  if (status !== 200) {
    $("parser-error").textContent = body.hint || body.message || body.error || "Ошибка парсинга";
    show("parser-error");
    return;
  }

  lastJobId = body.jobId;
  $("result-title").textContent = body.chat.title;
  const adminPart = body.stats.admins != null ? ` · Админов: ${body.stats.admins}` : "";
  const adminList = Array.isArray(body.adminUsernames) ? body.adminUsernames : [];
  const adminListLine = adminList.length > 0 ? `\n👑 ${adminList.join(", ")}` : "";
  $("result-stats").textContent =
    `Всего: ${body.stats.total} · С username: ${body.stats.withUsername} · Без: ${body.stats.withoutUsername} · Боты: ${body.stats.bots}${adminPart}  ·  🤖 бот · 👑 админ · ⭐ создатель${adminListLine}`;
  $("result-list").value = body.numberedList || body.usernames.map((u, i) => `${i + 1}. ${u}`).join("\n");
  show("result");
});

$("copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("result-list").value);
  const t = $("copy-toast");
  t.textContent = `Скопировано · ${$("result-list").value.split("\n").length} строк`;
  show("copy-toast");
  setTimeout(() => hide("copy-toast"), 2000);
});

$("download-btn").addEventListener("click", async () => {
  if (!lastJobId) return;
  const url = `/api/export.txt?jobId=${encodeURIComponent(lastJobId)}`;
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      showLoginScreen();
      return;
    }
    return;
  }
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename="([^"]+)"/.exec(cd);
  link.download = m ? m[1] : "participants.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
});

$("again-btn").addEventListener("click", () => {
  hide("result");
  $("parse-button").disabled = false;
});

init();
