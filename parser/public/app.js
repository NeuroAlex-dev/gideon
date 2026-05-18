const TOKEN = new URLSearchParams(location.search).get("token") || "";

const $ = (id) => document.getElementById(id);

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function showOnly(...ids) {
  for (const el of document.querySelectorAll(".screen")) el.classList.add("hidden");
  for (const id of ids) show(id);
}

async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  if (TOKEN) url.searchParams.set("token", TOKEN);
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function showAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  show("auth-error");
}

let authState = { phone: "", phoneCodeHash: "" };

async function init() {
  const { status, body } = await api("/api/auth/status");
  if (status === 401) {
    document.body.innerHTML = "<p style='padding:24px;color:#e57373'>Нет доступа. Открой страницу с правильным <code>?token=</code> в URL.</p>";
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
  location.reload();
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
  location.reload();
});

let allChats = [];
let selectedChatId = null;
let lastJobId = null;

async function loadChats() {
  const { status, body } = await api("/api/chats");
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

$("download-btn").addEventListener("click", () => {
  if (!lastJobId) return;
  const url = `/api/export.txt?jobId=${encodeURIComponent(lastJobId)}${TOKEN ? "&token=" + TOKEN : ""}`;
  location.href = url;
});

$("again-btn").addEventListener("click", () => {
  hide("result");
  $("parse-button").disabled = false;
});

init();
