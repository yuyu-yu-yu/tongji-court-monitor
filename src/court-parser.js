export function normalizeCourtText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyAvailabilityText(text, keywordConfig) {
  const normalized = normalizeCourtText(text);
  if (!normalized) {
    return "unknown";
  }

  if (keywordConfig.availableKeywords.some((keyword) => normalized.includes(keyword))) {
    return "available";
  }

  if (keywordConfig.fullKeywords.some((keyword) => normalized.includes(keyword))) {
    return "full";
  }

  if (keywordConfig.unavailableKeywords.some((keyword) => normalized.includes(keyword))) {
    return "unavailable";
  }

  return "unknown";
}

export function isLikelyDateCardText(text) {
  const normalized = normalizeCourtText(text);
  return Boolean(normalized.match(/(周[一二三四五六日天]|星期[一二三四五六日天])/)) || Boolean(normalized.match(/\b\d{2}-\d{2}\b/));
}

export function extractDateLabel(text) {
  const normalized = normalizeCourtText(text);
  const week = normalized.match(/(周[一二三四五六日天]|星期[一二三四五六日天])/u)?.[0] ?? "";
  const date = normalized.match(/\b\d{2}-\d{2}\b/)?.[0] ?? "";
  if (week || date) {
    return [week, date].filter(Boolean).join(" ");
  }

  return normalized.slice(0, 32);
}

export function parseDateCardText(text, keywordConfig) {
  const normalized = normalizeCourtText(text);
  return {
    rawText: normalized,
    label: extractDateLabel(normalized),
    status: classifyAvailabilityText(normalized, keywordConfig)
  };
}

export function parseSlotText(text, keywordConfig) {
  const normalized = normalizeCourtText(text);
  const timeLabel = normalized.match(/\b\d{1,2}:\d{2}\s*[-~至]\s*\d{1,2}:\d{2}\b/u)?.[0] ?? normalized;
  return {
    rawText: normalized,
    label: timeLabel,
    status: classifyAvailabilityText(normalized, keywordConfig)
  };
}

export function buildAvailabilityDigest(days) {
  const normalized = [...days]
    .map((day) => ({
      label: day.label,
      status: day.status,
      slots: [...(day.slots ?? [])].map((slot) => slot.label).sort()
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));

  return JSON.stringify(normalized);
}

export function formatAvailabilityMessage({ venueName, targetUrl, days, detectedAt }) {
  const lines = [
    "Tongji court availability detected",
    venueName ? `Venue: ${venueName}` : null,
    `Detected at: ${detectedAt}`,
    "Available days:"
  ].filter(Boolean);

  for (const day of days) {
    const slotText = day.slots && day.slots.length > 0
      ? day.slots.map((slot) => slot.label).join(", ")
      : "slots need manual check";
    lines.push(`- ${day.label}: ${slotText}`);
  }

  lines.push(`Open page: ${targetUrl}`);
  return lines.join("\n");
}
