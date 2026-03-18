import test from "node:test";
import assert from "node:assert/strict";
import { buildAvailabilityDigest, classifyAvailabilityText, extractDateLabel, formatAvailabilityMessage, parseDateCardText } from "../src/court-parser.js";

const keywordConfig = {
  fullKeywords: ["已订满", "已约满", "满"],
  availableKeywords: ["可预约", "可预订", "空闲", "剩余"],
  unavailableKeywords: ["不可预约", "未开放", "已结束"]
};

test("classifyAvailabilityText categorizes card text", () => {
  assert.equal(classifyAvailabilityText("周三 03-18 已订满", keywordConfig), "full");
  assert.equal(classifyAvailabilityText("周四 03-19 可预约", keywordConfig), "available");
  assert.equal(classifyAvailabilityText("周五 03-20 未开放", keywordConfig), "unavailable");
  assert.equal(classifyAvailabilityText("周六 03-21", keywordConfig), "unknown");
});

test("parseDateCardText extracts stable labels", () => {
  const parsed = parseDateCardText("周三 03-18 已订满", keywordConfig);
  assert.equal(parsed.label, "周三 03-18");
  assert.equal(parsed.status, "full");
  assert.equal(extractDateLabel("星期日 03-22 已订满"), "星期日 03-22");
});

test("buildAvailabilityDigest changes only when availability changes", () => {
  const firstDigest = buildAvailabilityDigest([
    { label: "周三 03-18", status: "available", slots: [{ label: "08:00-09:00" }] }
  ]);
  const secondDigest = buildAvailabilityDigest([
    { label: "周三 03-18", status: "available", slots: [{ label: "08:00-09:00" }] }
  ]);
  const thirdDigest = buildAvailabilityDigest([
    { label: "周三 03-18", status: "available", slots: [{ label: "09:00-10:00" }] }
  ]);

  assert.equal(firstDigest, secondDigest);
  assert.notEqual(firstDigest, thirdDigest);
});

test("formatAvailabilityMessage includes venue and slot details", () => {
  const message = formatAvailabilityMessage({
    venueName: "嘉定体育中心羽毛球馆",
    targetUrl: "https://stadium.tongji.edu.cn/phone/#/detailAppoint?id=test",
    detectedAt: "2026-03-18T15:00:00.000Z",
    days: [
      {
        label: "周三 03-18",
        slots: [{ label: "08:00-09:00" }, { label: "09:00-10:00" }]
      }
    ]
  });

  assert.match(message, /嘉定体育中心羽毛球馆/);
  assert.match(message, /周三 03-18/);
  assert.match(message, /08:00-09:00/);
  assert.match(message, /Open page/);
});
