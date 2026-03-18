import test from "node:test";
import assert from "node:assert/strict";
import { detectPageSignal, isButtonActionable } from "../src/signals.js";

const CONFIRM = "\u786e\u8ba4\u8ba2\u5355";
const QUEUE_TEXT = "\u5f53\u524d\u6392\u961f\u4eba\u6570\u592a\u591a\u5566";
const BUY_NOW = "\u7acb\u5373\u8d2d\u4e70";
const RESERVE = "\u9884\u7ea6\u62a2\u7968";

test("detectPageSignal matches text, url, title, and selector signals", () => {
  const snapshot = {
    url: "https://detail.damai.cn/confirm",
    title: CONFIRM,
    text: `\u62b1\u6b49\uff0c${QUEUE_TEXT}\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5`,
    matchedSelectors: [".queue-page", ".submit-btn"]
  };

  assert.equal(detectPageSignal(["url=/confirm"], snapshot), "url=/confirm");
  assert.equal(detectPageSignal([`title=${CONFIRM}`], snapshot), `title=${CONFIRM}`);
  assert.equal(detectPageSignal([`text=${QUEUE_TEXT}`], snapshot), `text=${QUEUE_TEXT}`);
  assert.equal(detectPageSignal([".submit-btn"], snapshot), ".submit-btn");
  assert.equal(detectPageSignal([".missing-selector"], snapshot), null);
});

test("isButtonActionable requires visible enabled button with ready text", () => {
  assert.equal(
    isButtonActionable({
      found: true,
      visible: true,
      disabled: false,
      text: BUY_NOW
    }),
    true
  );

  assert.equal(
    isButtonActionable({
      found: true,
      visible: true,
      disabled: false,
      text: RESERVE
    }),
    false
  );

  assert.equal(
    isButtonActionable({
      found: true,
      visible: false,
      disabled: false,
      text: BUY_NOW
    }),
    false
  );
});
