import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_DISABLED_TEXT_PATTERNS, DEFAULT_READY_TEXT_PATTERNS, normalizeSignals } from "./signals.js";
import { getDefaultMobileCourtConfig } from "./court-runner.js";

const DAMAI_REQUIRED_FIELDS = [
  "eventUrl",
  "saleTime",
  "buyButtonSelectors",
  "queuePageSignals",
  "confirmPageSignals",
  "agreementSelectors",
  "submitButtonSelectors",
  "prewarmSeconds",
  "clockSource"
];

const COURT_REQUIRED_FIELDS = [
  "targetUrl",
  "pollIntervalMs",
  "settleDelayMs",
  "fullKeywords",
  "availableKeywords",
  "unavailableKeywords"
];

export async function loadConfig(configPathArg) {
  const configPath = path.resolve(configPathArg ?? "config/damai.config.json");
  const rawConfig = await readJsonConfig(configPath);
  const missingFields = DAMAI_REQUIRED_FIELDS.filter((field) => rawConfig[field] === undefined);
  if (missingFields.length > 0) {
    throw new Error(`Missing required config fields: ${missingFields.join(", ")}`);
  }

  const saleTimestamp = Date.parse(rawConfig.saleTime);
  if (Number.isNaN(saleTimestamp)) {
    throw new Error(`Invalid saleTime: ${rawConfig.saleTime}`);
  }

  const rootDir = path.dirname(configPath);
  const normalized = {
    ...rawConfig,
    configPath,
    rootDir,
    saleTimestamp,
    prewarmSeconds: Number(rawConfig.prewarmSeconds),
    buyButtonSelectors: ensureStringArray(rawConfig.buyButtonSelectors, "buyButtonSelectors"),
    queuePageSignals: normalizeSignals(rawConfig.queuePageSignals),
    confirmPageSignals: normalizeSignals(rawConfig.confirmPageSignals),
    agreementSelectors: ensureStringArray(rawConfig.agreementSelectors, "agreementSelectors"),
    submitButtonSelectors: ensureStringArray(rawConfig.submitButtonSelectors, "submitButtonSelectors"),
    buyReadyTextPatterns: rawConfig.buyReadyTextPatterns
      ? ensureStringArray(rawConfig.buyReadyTextPatterns, "buyReadyTextPatterns")
      : DEFAULT_READY_TEXT_PATTERNS,
    disabledTextPatterns: rawConfig.disabledTextPatterns
      ? ensureStringArray(rawConfig.disabledTextPatterns, "disabledTextPatterns")
      : DEFAULT_DISABLED_TEXT_PATTERNS,
    clockSource: String(rawConfig.clockSource).trim(),
    browserChannel: String(rawConfig.browserChannel ?? "chrome").trim(),
    userDataDir: path.resolve(rootDir, rawConfig.userDataDir ?? "./.browser-profile/damai"),
    windowWidth: Number(rawConfig.windowWidth ?? 1440),
    windowHeight: Number(rawConfig.windowHeight ?? 960),
    locale: rawConfig.locale ?? "zh-CN",
    timezoneId: rawConfig.timezoneId ?? "Asia/Shanghai",
    logsDir: path.resolve(rootDir, rawConfig.logsDir ?? "./logs")
  };

  if (!normalized.eventUrl.startsWith("http")) {
    throw new Error(`eventUrl must be an absolute URL, received: ${normalized.eventUrl}`);
  }

  if (!Number.isFinite(normalized.prewarmSeconds) || normalized.prewarmSeconds < 0) {
    throw new Error(`prewarmSeconds must be a non-negative number, received: ${rawConfig.prewarmSeconds}`);
  }

  if (!["system", "browser"].includes(normalized.clockSource)) {
    throw new Error(`clockSource must be \"system\" or \"browser\", received: ${normalized.clockSource}`);
  }

  return normalized;
}

export const loadDamaiConfig = loadConfig;

export async function loadCourtWatchConfig(configPathArg) {
  const configPath = path.resolve(configPathArg ?? "config/tongji-courts.config.json");
  const rawConfig = await readJsonConfig(configPath);
  const missingFields = COURT_REQUIRED_FIELDS.filter((field) => rawConfig[field] === undefined);
  if (missingFields.length > 0) {
    throw new Error(`Missing required court config fields: ${missingFields.join(", ")}`);
  }

  const mobileDefaults = getDefaultMobileCourtConfig();
  const rootDir = path.dirname(configPath);
  const normalized = {
    ...rawConfig,
    configPath,
    rootDir,
    targetUrl: String(rawConfig.targetUrl).trim(),
    entryUrl: String(rawConfig.entryUrl ?? mobileDefaults.entryUrl).trim(),
    pollIntervalMs: Number(rawConfig.pollIntervalMs),
    settleDelayMs: Number(rawConfig.settleDelayMs),
    entrySettleDelayMs: Number(rawConfig.entrySettleDelayMs ?? 1800),
    browserChannel: String(rawConfig.browserChannel ?? "chrome").trim(),
    userDataDir: path.resolve(rootDir, rawConfig.userDataDir ?? "./.browser-profile/tongji-courts"),
    windowWidth: Number(rawConfig.windowWidth ?? 430),
    windowHeight: Number(rawConfig.windowHeight ?? 932),
    locale: rawConfig.locale ?? "zh-CN",
    timezoneId: rawConfig.timezoneId ?? "Asia/Shanghai",
    logsDir: path.resolve(rootDir, rawConfig.logsDir ?? "./logs"),
    userAgent: String(rawConfig.userAgent ?? mobileDefaults.userAgent),
    isMobile: rawConfig.isMobile ?? mobileDefaults.isMobile,
    hasTouch: rawConfig.hasTouch ?? mobileDefaults.hasTouch,
    deviceScaleFactor: Number(rawConfig.deviceScaleFactor ?? mobileDefaults.deviceScaleFactor),
    fullKeywords: ensureStringArray(rawConfig.fullKeywords, "fullKeywords"),
    availableKeywords: ensureStringArray(rawConfig.availableKeywords, "availableKeywords"),
    unavailableKeywords: ensureStringArray(rawConfig.unavailableKeywords, "unavailableKeywords"),
    enterpriseWechatWebhookUrl: String(rawConfig.enterpriseWechatWebhookUrl ?? "").trim(),
    loginKeywords: rawConfig.loginKeywords
      ? ensureStringArray(rawConfig.loginKeywords, "loginKeywords")
      : ["登录", "统一身份认证", "账号", "密码"],
    venueNameSelectors: rawConfig.venueNameSelectors
      ? ensureStringArray(rawConfig.venueNameSelectors, "venueNameSelectors")
      : ["h1", "h2", "[class*='title']", "[class*='name']"],
    dateCardSelectors: rawConfig.dateCardSelectors
      ? ensureStringArray(rawConfig.dateCardSelectors, "dateCardSelectors")
      : ["[class*='date']", "[class*='day']", "[class*='week']", ".van-tab", ".van-col"],
    slotRowSelectors: rawConfig.slotRowSelectors
      ? ensureStringArray(rawConfig.slotRowSelectors, "slotRowSelectors")
      : ["[class*='time']", "[class*='slot']", "[class*='appoint']", ".van-cell", ".van-row"],
    inspectUnknownDays: rawConfig.inspectUnknownDays !== false
  };

  if (!normalized.targetUrl.startsWith("http")) {
    throw new Error(`targetUrl must be an absolute URL, received: ${normalized.targetUrl}`);
  }

  if (!normalized.entryUrl.startsWith("http")) {
    throw new Error(`entryUrl must be an absolute URL, received: ${normalized.entryUrl}`);
  }

  if (!Number.isFinite(normalized.pollIntervalMs) || normalized.pollIntervalMs <= 0) {
    throw new Error(`pollIntervalMs must be a positive number, received: ${rawConfig.pollIntervalMs}`);
  }

  if (!Number.isFinite(normalized.settleDelayMs) || normalized.settleDelayMs < 0) {
    throw new Error(`settleDelayMs must be a non-negative number, received: ${rawConfig.settleDelayMs}`);
  }

  if (!Number.isFinite(normalized.entrySettleDelayMs) || normalized.entrySettleDelayMs < 0) {
    throw new Error(`entrySettleDelayMs must be a non-negative number, received: ${rawConfig.entrySettleDelayMs}`);
  }

  if (normalized.enterpriseWechatWebhookUrl) {
    try {
      new URL(normalized.enterpriseWechatWebhookUrl);
    } catch {
      throw new Error("enterpriseWechatWebhookUrl must be a valid absolute URL");
    }
  }

  return normalized;
}

async function readJsonConfig(configPath) {
  const fileContents = await fs.readFile(configPath, "utf8");
  const normalizedContents = fileContents.charCodeAt(0) === 0xFEFF ? fileContents.slice(1) : fileContents;

  try {
    return JSON.parse(normalizedContents);
  } catch (error) {
    throw new Error(`Failed to parse config JSON at ${configPath}: ${error.message}`);
  }
}

export function ensureStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty array of strings`);
  }

  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one non-empty string`);
  }

  return normalized;
}
