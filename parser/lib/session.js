import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from "node:fs";

export function createSessionStore(filePath) {
  return {
    load() {
      if (!existsSync(filePath)) return "";
      try {
        return readFileSync(filePath, "utf8").trim();
      } catch {
        return "";
      }
    },

    save(value) {
      writeFileSync(filePath, value, { encoding: "utf8" });
      try {
        chmodSync(filePath, 0o600);
      } catch {
        // Windows ignores chmod — that's fine
      }
    },

    clear() {
      if (existsSync(filePath)) {
        try { unlinkSync(filePath); } catch {}
      }
    },

    isAuthorized() {
      return this.load() !== "";
    },
  };
}
