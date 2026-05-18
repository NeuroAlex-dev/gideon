const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
const ID_RE = /^-?\d+$/;
const TME_USERNAME_RE = /^(?:https?:\/\/)?t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})\/?$/i;
const TME_INVITE_RE = /^(?:https?:\/\/)?t\.me\/(?:joinchat\/|\+)([a-zA-Z0-9_-]+)\/?$/i;

export function normalizeChatRef(input) {
  if (input == null || typeof input !== "string") {
    throw new Error("chatRef is empty");
  }
  const s = input.trim();
  if (s === "") throw new Error("chatRef is empty");

  let m = s.match(TME_INVITE_RE);
  if (m) return { type: "invite", value: m[1] };

  m = s.match(TME_USERNAME_RE);
  if (m) return { type: "username", value: m[1] };

  if (s.startsWith("@")) {
    const u = s.slice(1);
    if (USERNAME_RE.test(u)) return { type: "username", value: u };
    throw new Error("invalid username");
  }

  if (ID_RE.test(s)) return { type: "id", value: s };

  if (USERNAME_RE.test(s)) return { type: "username", value: s };

  throw new Error("invalid chatRef");
}
