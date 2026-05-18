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

// Parser screen handlers — Task 14
async function loadChats() { /* implemented in Task 14 */ }

init();
