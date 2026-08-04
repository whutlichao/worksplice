/**
 * reminder recurrence DSL（§3.9，[锁定] 03/05）：
 * - `every:15m` / `every:2h` / `every:1d` —— 相对延迟，delay 语义由服务端算绝对时间；
 * - `daily@09:00` —— 每天 HH:MM（本地时区）；
 * - `weekly:mon,fri@09:00` —— 指定星期几 + 时刻（本地时区，大小写不敏感）。
 * nextFireAt 永远返回严格晚于 from 的下一次（等值视为已到点，避免立即重触发死循环）。
 * 纯模块：不碰 DB、不碰运行时，可独立单测。
 */

export type RecurrenceRule =
  | { kind: "every"; amount: number; unit: "m" | "h" | "d" }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekdays: number[]; hour: number; minute: number };

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const EVERY_UNITS = new Set(["m", "h", "d"]);
const UNIT_MS: Record<"m" | "h" | "d", number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function isValidRecurrence(dsl: string): boolean {
  return parseRecurrence(dsl) !== null;
}

export function parseRecurrence(dsl: string): RecurrenceRule | null {
  const value = dsl.trim();
  if (value.startsWith("every:")) {
    const rest = value.slice("every:".length);
    const match = /^(\d+)([mhd])$/.exec(rest);
    if (!match) return null;
    const amount = Number(match[1]);
    if (amount < 1) return null;
    const unit = match[2] as "m" | "h" | "d";
    if (!EVERY_UNITS.has(unit)) return null;
    return { kind: "every", amount, unit };
  }
  if (value.startsWith("daily@")) {
    const time = parseTime(value.slice("daily@".length));
    if (!time) return null;
    return { kind: "daily", ...time };
  }
  if (value.startsWith("weekly:")) {
    const rest = value.slice("weekly:".length);
    const at = rest.lastIndexOf("@");
    if (at <= 0) return null;
    const daysPart = rest.slice(0, at);
    const time = parseTime(rest.slice(at + 1));
    if (!time) return null;
    const weekdays: number[] = [];
    for (const token of daysPart.split(",")) {
      const day = WEEKDAY_ALIASES[token.trim().toLowerCase()];
      if (day === undefined) return null;
      weekdays.push(day);
    }
    if (weekdays.length === 0) return null;
    return { kind: "weekly", weekdays: Array.from(new Set(weekdays)).sort((a, b) => a - b), ...time };
  }
  return null;
}

/** HH:MM（24 小时制）→ { hour, minute }；非法返回 null。 */
function parseTime(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * 下一次触发时刻（严格晚于 from；delay 语义 = 服务端算绝对时间，时区安全）。
 * 非法 DSL 返回 null（调用方按一次性处理）。
 */
export function nextFireAt(dsl: string, from: Date): Date | null {
  const rule = parseRecurrence(dsl);
  if (!rule) return null;
  if (rule.kind === "every") {
    return new Date(from.getTime() + rule.amount * UNIT_MS[rule.unit]);
  }
  if (rule.kind === "daily") {
    const candidate = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      rule.hour,
      rule.minute,
    );
    if (candidate.getTime() > from.getTime()) return candidate;
    return new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + 1,
      rule.hour,
      rule.minute,
    );
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offset,
      rule.hour,
      rule.minute,
    );
    if (rule.weekdays.includes(candidate.getDay())) return candidate;
  }
  return null;
}
