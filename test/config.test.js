import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

const CONFIRM = "\u786e\u8ba4\u8ba2\u5355";
const QUEUE_TEXT = "\u5f53\u524d\u6392\u961f\u4eba\u6570\u592a\u591a\u5566";

test("loadConfig applies defaults and resolves relative paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "damai-config-"));
  const configPath = path.join(tempDir, "damai.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      eventUrl: "https://detail.damai.cn/item.htm?id=123",
      saleTime: "2026-03-18T12:00:00+08:00",
      buyButtonSelectors: [".buybtn"],
      queuePageSignals: [`text=${QUEUE_TEXT}`],
      confirmPageSignals: [`title=${CONFIRM}`],
      agreementSelectors: ["input[type=\"checkbox\"]"],
      submitButtonSelectors: [".submit-btn"],
      prewarmSeconds: 15,
      clockSource: "system"
    }),
    "utf8"
  );

  const config = await loadConfig(configPath);
  assert.equal(config.browserChannel, "chrome");
  assert.equal(config.locale, "zh-CN");
  assert.equal(config.timezoneId, "Asia/Shanghai");
  assert.ok(path.isAbsolute(config.userDataDir));
});

test("loadConfig rejects invalid sale time", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "damai-config-"));
  const configPath = path.join(tempDir, "damai.json");
  await fs.writeFile(
    configPath,
    JSON.stringify({
      eventUrl: "https://detail.damai.cn/item.htm?id=123",
      saleTime: "not-a-time",
      buyButtonSelectors: [".buybtn"],
      queuePageSignals: [`text=${QUEUE_TEXT}`],
      confirmPageSignals: [`title=${CONFIRM}`],
      agreementSelectors: ["input[type=\"checkbox\"]"],
      submitButtonSelectors: [".submit-btn"],
      prewarmSeconds: 15,
      clockSource: "system"
    }),
    "utf8"
  );

  await assert.rejects(() => loadConfig(configPath), /Invalid saleTime/);
});
