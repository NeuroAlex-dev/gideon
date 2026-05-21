import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinWorkingHours, canSendNow, nextOutboundDelay } from "../lib/safety.js";

test("isWithinWorkingHours: 9-22 Europe/Moscow", () => {
  const campaign = { working_hours_start: 9, working_hours_end: 22, timezone: "Europe/Moscow" };
  const at13msk = new Date("2026-05-21T10:00:00Z").getTime();
  assert.equal(isWithinWorkingHours(at13msk, campaign), true);
  const at3msk = new Date("2026-05-21T00:00:00Z").getTime();
  assert.equal(isWithinWorkingHours(at3msk, campaign), false);
});

test("canSendNow проверяет дневной лимит, часовой, окно ожидания", () => {
  const campaign = { daily_message_limit: 20, working_hours_start: 9, working_hours_end: 22, timezone: "Europe/Moscow" };
  const now = new Date("2026-05-21T10:00:00Z").getTime();
  let result = canSendNow({ now, campaign, sentTodayCount: 5, sentLastHourCount: 1, lastSentAt: now - 10 * 60_000 });
  assert.equal(result.ok, true);
  result = canSendNow({ now, campaign, sentTodayCount: 20, sentLastHourCount: 1, lastSentAt: now - 10 * 60_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /дневной лимит/i);
  result = canSendNow({ now, campaign, sentTodayCount: 5, sentLastHourCount: 3, lastSentAt: now - 10 * 60_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /час/i);
  result = canSendNow({ now, campaign, sentTodayCount: 5, sentLastHourCount: 1, lastSentAt: now - 30_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /задержк/i);
});

test("nextOutboundDelay возвращает 2-20 мин", () => {
  const rng = () => 0.5;
  const d = nextOutboundDelay(rng);
  assert.ok(d >= 2 * 60_000 && d <= 20 * 60_000);
  const dMin = nextOutboundDelay(() => 0);
  const dMax = nextOutboundDelay(() => 0.9999);
  assert.equal(dMin, 2 * 60_000);
  assert.ok(dMax <= 20 * 60_000 && dMax >= 19 * 60_000);
});
