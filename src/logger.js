import fs from "node:fs/promises";
import path from "node:path";

export async function createLogger(logsDir) {
  await fs.mkdir(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.join(logsDir, `run-${timestamp}.jsonl`);

  async function write(level, message, details = {}) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...details
    };

    const consoleLine = `[${entry.time}] ${level.toUpperCase()} ${message}`;
    if (level === "error") {
      console.error(consoleLine);
    } else if (level === "warn") {
      console.warn(consoleLine);
    } else {
      console.log(consoleLine);
    }

    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  return {
    logPath,
    info(message, details) {
      return write("info", message, details);
    },
    warn(message, details) {
      return write("warn", message, details);
    },
    error(message, details) {
      return write("error", message, details);
    }
  };
}

