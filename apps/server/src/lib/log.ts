// Tiny structured logger: one JSON line per event, which Railway indexes.
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export type Logger = Record<Level, (msg: string, data?: Record<string, unknown>) => void>;

export function createLogger(min: Level | "silent" = "info"): Logger {
  const emit = (level: Level) => (msg: string, data?: Record<string, unknown>) => {
    if (order[level] < order[min]) return;
    const line = JSON.stringify({ level, msg, time: new Date().toISOString(), ...data });
    (level === "error" || level === "warn" ? console.error : console.log)(line);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}
