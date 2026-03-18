export const DEFAULT_READY_TEXT_PATTERNS = [
  "\u7acb\u5373\u8d2d\u4e70",
  "\u7acb\u5373\u9884\u8ba2",
  "\u7acb\u5373\u62a2\u8d2d",
  "\u53bb\u8d2d\u4e70"
];

export const DEFAULT_DISABLED_TEXT_PATTERNS = [
  "\u9884\u7ea6\u62a2\u7968",
  "\u5373\u5c06\u5f00\u552e",
  "\u672a\u5f00\u552e",
  "\u552e\u7f44",
  "\u7f3a\u8d27\u767b\u8bb0",
  "\u767b\u8bb0"
];

export function normalizeSignals(signals) {
  if (!Array.isArray(signals)) {
    return [];
  }

  return signals
    .map((signal) => String(signal).trim())
    .filter(Boolean);
}

export function classifySignal(signal) {
  if (signal.startsWith("text=")) {
    return { type: "text", value: signal.slice(5) };
  }

  if (signal.startsWith("url=")) {
    return { type: "url", value: signal.slice(4) };
  }

  if (signal.startsWith("title=")) {
    return { type: "title", value: signal.slice(6) };
  }

  return { type: "selector", value: signal };
}

export function extractSelectorSignals(signals) {
  return normalizeSignals(signals)
    .map(classifySignal)
    .filter((signal) => signal.type === "selector")
    .map((signal) => signal.value);
}

export function detectPageSignal(signals, snapshot) {
  for (const signal of normalizeSignals(signals)) {
    if (isSignalMatched(signal, snapshot)) {
      return signal;
    }
  }

  return null;
}

export function isSignalMatched(signal, snapshot) {
  const normalized = classifySignal(signal);
  const selectors = new Set(snapshot.matchedSelectors ?? []);
  const url = snapshot.url ?? "";
  const title = snapshot.title ?? "";
  const text = snapshot.text ?? "";

  switch (normalized.type) {
    case "selector":
      return selectors.has(normalized.value);
    case "url":
      return url.includes(normalized.value);
    case "title":
      return title.includes(normalized.value);
    case "text":
      return text.includes(normalized.value);
    default:
      return false;
  }
}

export function isButtonActionable(snapshot, readyPatterns = DEFAULT_READY_TEXT_PATTERNS, disabledPatterns = DEFAULT_DISABLED_TEXT_PATTERNS) {
  if (!snapshot?.found) {
    return false;
  }

  if (!snapshot.visible || snapshot.disabled) {
    return false;
  }

  const text = snapshot.text ?? "";
  const hasReadyText = readyPatterns.some((pattern) => text.includes(pattern));
  const hasDisabledText = disabledPatterns.some((pattern) => text.includes(pattern));
  return hasReadyText && !hasDisabledText;
}

export function summarizeButtonSnapshot(snapshot) {
  if (!snapshot?.found) {
    return "buy button not found";
  }

  return `${snapshot.selector} text="${snapshot.text}" disabled=${snapshot.disabled} visible=${snapshot.visible} actionable=${snapshot.actionable}`;
}
