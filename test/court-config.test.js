import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCourtWatchConfig } from "../src/config.js";

test("loadCourtWatchConfig applies defaults and resolves paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tongji-config-"));
  const configPath = path.join(tempDir, "tongji.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      targetUrl: "https://stadium.tongji.edu.cn/phone/#/detailAppoint?id=test",
      pollIntervalMs: 30000,
      settleDelayMs: 2500,
      fullKeywords: ["已订满"],
      availableKeywords: ["可预约"],
      unavailableKeywords: ["未开放"]
    }),
    "utf8"
  );

  const config = await loadCourtWatchConfig(configPath);
  assert.equal(config.browserChannel, "chrome");
  assert.equal(config.locale, "zh-CN");
  assert.ok(path.isAbsolute(config.userDataDir));
  assert.equal(config.enterpriseWechatWebhookUrl, "");
});

test("loadCourtWatchConfig rejects invalid webhook url", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tongji-config-"));
  const configPath = path.join(tempDir, "tongji.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      targetUrl: "https://stadium.tongji.edu.cn/phone/#/detailAppoint?id=test",
      pollIntervalMs: 30000,
      settleDelayMs: 2500,
      fullKeywords: ["已订满"],
      availableKeywords: ["可预约"],
      unavailableKeywords: ["未开放"],
      enterpriseWechatWebhookUrl: "not-a-url"
    }),
    "utf8"
  );

  await assert.rejects(() => loadCourtWatchConfig(configPath), /enterpriseWechatWebhookUrl/);
});
