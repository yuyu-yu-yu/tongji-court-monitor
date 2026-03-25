// ==UserScript==
// @name         Tongji Court Monitor
// @namespace    https://stadium.tongji.edu.cn/
// @description  Monitor Tongji stadium H5 court availability and alert when slots appear.
// @match        https://stadium.tongji.edu.cn/phone/*
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      qyapi.weixin.qq.com
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    venueDetailId: "c7018ac0-af1f-4eb9-8f42-29156770a09c",
    pollIntervalMs: 5000,
    initialDelayMs: 2500,
    mutationDebounceMs: 800,
    pageReloadIntervalMs: 60000,
    stableDateCardThreshold: 5,
    enterpriseWechatWebhookUrl: "",
    fullKeywords: ["\u5df2\u8ba2\u6ee1", "\u5df2\u7ea6\u6ee1", "\u6ee1"],
    availableKeywords: ["\u53ef\u9884\u7ea6", "\u53ef\u9884\u8ba2", "\u7a7a\u95f2", "\u5269\u4f59"],
    unavailableKeywords: ["\u4e0d\u53ef\u9884\u7ea6", "\u672a\u5f00\u653e", "\u5df2\u7ed3\u675f"],
    venueNameSelectors: ["h1", "h2", "[class*='title']", "[class*='name']"],
    slotRowSelectors: ["[class*='time']", "[class*='slot']", "[class*='appoint']", ".van-cell", ".van-row"],
    genericCandidateSelectors: ["div", "span", "button", "li", "p"]
  };

  const STORAGE_KEYS = {
    lastDigest: "tongji-court-monitor:lastDigest",
    lastPageReloadAt: "tongji-court-monitor:lastPageReloadAt"
  };

  let lastDigest = sessionStorage.getItem(STORAGE_KEYS.lastDigest) || "";
  let lastPageReloadAt = Number(sessionStorage.getItem(STORAGE_KEYS.lastPageReloadAt) || 0);
  let pollTimer = null;
  let mutationTimer = null;
  let routeTimer = null;
  let domObserver = null;
  let lastKnownHref = location.href;
  let active = false;

  const overlay = createOverlay();
  installRouteWatchers();
  installDomObserver();
  evaluateRoute("initial");

  function installRouteWatchers() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      scheduleRouteEvaluation("pushState");
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      scheduleRouteEvaluation("replaceState");
      return result;
    };

    window.addEventListener("hashchange", () => scheduleRouteEvaluation("hashchange"), true);
    window.addEventListener("popstate", () => scheduleRouteEvaluation("popstate"), true);

    routeTimer = setInterval(() => {
      if (location.href !== lastKnownHref) {
        scheduleRouteEvaluation("href-change");
      }
    }, 500);
  }

  function installDomObserver() {
    if (domObserver) {
      domObserver.disconnect();
    }

    domObserver = new MutationObserver(() => {
      if (!active || !isTargetRoute()) return;
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        schedulePollSoon(50);
      }, CONFIG.mutationDebounceMs);
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function scheduleRouteEvaluation(reason) {
    lastKnownHref = location.href;
    setTimeout(() => evaluateRoute(reason), 50);
  }

  function evaluateRoute(reason) {
    const onTarget = isTargetRoute();
    active = onTarget;

    if (!onTarget) {
      clearPollTimer();
      updateOverlayIdle();
      return;
    }

    updateOverlayWaiting();
    schedulePollSoon(CONFIG.initialDelayMs);
    console.log(`[Tongji Court Monitor] Activated on target route via ${reason}`);
  }

  function isTargetRoute() {
    return location.href.includes(`/phone/#/detailAppoint?id=${CONFIG.venueDetailId}`);
  }

  async function runPoll() {
    if (!active || !isTargetRoute()) {
      updateOverlayIdle();
      return;
    }

    try {
      const snapshot = collectSnapshot();
      updateOverlay(snapshot);

      if (snapshot.availableDays.length > 0) {
        const digest = buildDigest(snapshot.availableDays);
        if (digest !== lastDigest) {
          lastDigest = digest;
          persistState();
          notify(snapshot);
        }
      } else if (snapshot.isStable) {
        lastDigest = "";
        persistState();
      }

      maybeReloadPage();
    } catch (error) {
      console.error("[Tongji Court Monitor] Poll failed:", error);
      updateOverlay({ error: error.message, availableDays: [], dateCards: [] });
    } finally {
      if (active && isTargetRoute()) {
        schedulePollSoon(CONFIG.pollIntervalMs);
      }
    }
  }

  function collectSnapshot() {
    const venueName = firstText(CONFIG.venueNameSelectors) || document.title || "\u540c\u6d4e\u573a\u5730";
    const dateCards = collectDateCards();
    const availableDays = dateCards.filter((day) => day.status === "available" || day.slots.length > 0);

    return {
      venueName,
      url: location.href,
      dateCards,
      availableDays,
      isStable: dateCards.length >= CONFIG.stableDateCardThreshold,
      collectedAt: new Date().toLocaleString("zh-CN", { hour12: false })
    };
  }

  function collectDateCards() {
    const candidates = [
      ...collectCandidatesFromStatusNodes(),
      ...collectCandidatesFromSmallTextBlocks()
    ];

    const deduped = new Map();
    for (const item of candidates) {
      const parsed = parseDateCard(item.text);
      const slots = inspectSlotsNearNode(item.node);
      const candidate = {
        ...parsed,
        index: item.index,
        slots,
        sourceScore: item.sourceScore
      };

      const existing = deduped.get(candidate.label);
      if (!existing || shouldReplace(existing, candidate)) {
        deduped.set(candidate.label, candidate);
      }
    }

    return [...deduped.values()]
      .map(({ sourceScore, ...rest }) => rest)
      .sort((a, b) => a.index - b.index);
  }

  function collectCandidatesFromStatusNodes() {
    const candidates = [];
    const nodes = queryAll(CONFIG.genericCandidateSelectors);
    let index = 0;

    for (const node of nodes) {
      const text = normalizeText(node.innerText || node.textContent);
      if (!text || text.length > 12) continue;
      const status = classifyText(text);
      if (status === "unknown") continue;

      const card = findCardContainer(node);
      if (!card) continue;
      const cardText = normalizeText(card.innerText || card.textContent);
      if (!looksLikeDateCard(cardText)) continue;

      candidates.push({
        node: card,
        index: index++,
        text: cardText,
        sourceScore: 3
      });
    }

    return candidates;
  }

  function collectCandidatesFromSmallTextBlocks() {
    const candidates = [];
    const nodes = queryAll(CONFIG.genericCandidateSelectors);
    let index = 10000;

    for (const node of nodes) {
      const text = normalizeText(node.innerText || node.textContent);
      if (!text || text.length > 40) continue;
      if (!looksLikeDateCard(text)) continue;

      const mergedText = mergeNearbyDateText(node, text);
      candidates.push({
        node,
        index: index++,
        text: mergedText,
        sourceScore: 1
      });
    }

    return candidates;
  }

  function findCardContainer(node) {
    let current = node;
    for (let depth = 0; current && depth < 5; depth += 1) {
      const text = normalizeText(current.innerText || current.textContent);
      if (text && text.length <= 48 && looksLikeDateCard(text)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function mergeNearbyDateText(node, baseText) {
    const parts = [baseText];
    let current = node.parentElement;

    for (let depth = 0; current && depth < 2; depth += 1) {
      const text = normalizeText(current.innerText || current.textContent);
      if (text && text.length <= 64 && looksLikeDateCard(text)) {
        parts.push(text);
      }
      current = current.parentElement;
    }

    return normalizeText(parts.join(" "));
  }

  function shouldReplace(existing, candidate) {
    if (scoreStatus(candidate.status) !== scoreStatus(existing.status)) {
      return scoreStatus(candidate.status) > scoreStatus(existing.status);
    }

    if (candidate.slots.length !== existing.slots.length) {
      return candidate.slots.length > existing.slots.length;
    }

    return (candidate.sourceScore || 0) > (existing.sourceScore || 0);
  }

  function inspectSlotsNearNode(node) {
    const container = node.closest(".van-tabs, .van-tab__pane, .van-tabpanel, [class*='content'], body") || document.body;
    const slotNodes = queryAll(CONFIG.slotRowSelectors, container)
      .map((slotNode) => normalizeText(slotNode.innerText || slotNode.textContent))
      .filter((text) => /\d{1,2}:\d{2}/.test(text));

    const slots = [];
    for (const text of slotNodes) {
      const parsed = parseSlot(text);
      if (parsed.status === "available" || parsed.status === "unknown") {
        if (!slots.some((slot) => slot.label === parsed.label)) {
          slots.push(parsed);
        }
      }
    }

    return slots;
  }

  function parseDateCard(text) {
    return {
      rawText: text,
      label: extractDateLabel(text),
      status: classifyText(text)
    };
  }

  function parseSlot(text) {
    const timeRange = text.match(/\d{1,2}:\d{2}\s*[-~\u81f3]\s*\d{1,2}:\d{2}/u)?.[0] || text;
    return {
      rawText: text,
      label: timeRange,
      status: classifyText(text)
    };
  }

  function classifyText(text) {
    if (CONFIG.availableKeywords.some((keyword) => text.includes(keyword))) return "available";
    if (CONFIG.unavailableKeywords.some((keyword) => text.includes(keyword))) return "unavailable";
    if (CONFIG.fullKeywords.some((keyword) => text.includes(keyword))) return "full";
    return "unknown";
  }

  function looksLikeDateCard(text) {
    const hasWeek = /(\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]|\u661f\u671f[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929])/u.test(text);
    const hasDate = /\b\d{2}-\d{2}\b/.test(text);
    return hasWeek || hasDate;
  }

  function extractDateLabel(text) {
    const week = text.match(/(\u5468[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]|\u661f\u671f[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929])/u)?.[0] || "";
    const date = text.match(/\b\d{2}-\d{2}\b/)?.[0] || "";
    return [week, date].filter(Boolean).join(" ") || text.slice(0, 24);
  }

  function buildDigest(days) {
    return JSON.stringify(days.map((day) => ({
      label: day.label,
      status: day.status,
      slots: day.slots.map((slot) => slot.label).sort()
    })).sort((a, b) => a.label.localeCompare(b.label, "zh-CN")));
  }

  function notify(snapshot) {
    const lines = [
      `${snapshot.venueName} \u51fa\u73b0\u7a7a\u4f4d`,
      ...snapshot.availableDays.map((day) => {
        const slotText = day.slots.length > 0 ? day.slots.map((slot) => slot.label).join(", ") : "\u9700\u8981\u624b\u52a8\u67e5\u770b\u5177\u4f53\u65f6\u6bb5";
        return `${day.label}: ${slotText}`;
      }),
      `\u65f6\u95f4: ${snapshot.collectedAt}`,
      `\u9875\u9762: ${snapshot.url}`
    ];
    const message = lines.join("\n");

    console.log("[Tongji Court Monitor]", message);
    try {
      if (typeof GM_notification === "function") {
        GM_notification({ title: "\u540c\u6d4e\u573a\u5730\u76d1\u63a7", text: message, timeout: 12000 });
      } else {
        alert(message);
      }
    } catch {
      alert(message);
    }

    ring();
    sendWebhook(message);
  }

  function sendWebhook(message) {
    if (!CONFIG.enterpriseWechatWebhookUrl || typeof GM_xmlhttpRequest !== "function") return;

    GM_xmlhttpRequest({
      method: "POST",
      url: CONFIG.enterpriseWechatWebhookUrl,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ msgtype: "text", text: { content: message } }),
      onload(response) {
        console.log("[Tongji Court Monitor] Webhook response:", response.status, response.responseText);
      },
      onerror(error) {
        console.error("[Tongji Court Monitor] Webhook failed:", error);
      }
    });
  }

  function persistState() {
    sessionStorage.setItem(STORAGE_KEYS.lastDigest, lastDigest);
    sessionStorage.setItem(STORAGE_KEYS.lastPageReloadAt, String(lastPageReloadAt));
  }

  function maybeReloadPage() {
    if (!CONFIG.pageReloadIntervalMs || CONFIG.pageReloadIntervalMs <= 0) return;

    const now = Date.now();
    if (now - lastPageReloadAt < CONFIG.pageReloadIntervalMs) return;

    lastPageReloadAt = now;
    persistState();
    updateOverlayReloading();

    setTimeout(() => {
      location.reload();
    }, 300);
  }

  function ring() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 500);
    } catch {
      console.log("\u0007");
    }
  }

  function createOverlay() {
    const panel = document.createElement("div");
    panel.id = "tongji-court-monitor-overlay";
    panel.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:999999",
      "width:280px",
      "padding:10px 12px",
      "background:rgba(17,24,39,.92)",
      "color:#fff",
      "font-size:12px",
      "line-height:1.5",
      "border-radius:10px",
      "box-shadow:0 8px 24px rgba(0,0,0,.25)"
    ].join(";");
    panel.innerHTML = "<strong>\u540c\u6d4e\u573a\u5730\u76d1\u63a7</strong><div>\u7b49\u5f85\u8fdb\u5165\u76ee\u6807\u9875\u9762...</div>";
    document.documentElement.appendChild(panel);
    return panel;
  }

  function updateOverlay(snapshot) {
    const statusText = snapshot.error
      ? `\u9519\u8bef: ${snapshot.error}`
      : snapshot.availableDays.length > 0
        ? `\u53d1\u73b0 ${snapshot.availableDays.length} \u5929\u53ef\u9884\u7ea6`
        : snapshot.isStable
          ? "\u6682\u65e0\u7a7a\u4f4d"
          : "\u9875\u9762\u6570\u636e\u5237\u65b0\u4e2d";

    const lines = snapshot.availableDays.slice(0, 3).map((day) => {
      const slotText = day.slots.length > 0 ? day.slots.map((slot) => slot.label).join(", ") : "\u8bf7\u624b\u52a8\u67e5\u770b\u9875\u9762";
      return `${day.label}: ${slotText}`;
    });

    overlay.innerHTML = [
      "<strong>\u540c\u6d4e\u573a\u5730\u76d1\u63a7</strong>",
      `<div>${statusText}</div>`,
      snapshot.collectedAt ? `<div>\u6700\u8fd1\u68c0\u67e5: ${snapshot.collectedAt}</div>` : "",
      snapshot.dateCards ? `<div>\u5df2\u89e3\u6790\u65e5\u671f\u5361\u7247: ${snapshot.dateCards.length}</div>` : "",
      snapshot.isStable === false ? "<div>\u6570\u636e\u72b6\u6001: \u672a\u7a33\u5b9a</div>" : "",
      `<div>\u81ea\u52a8\u5237\u65b0\u95f4\u9694: ${Math.round(CONFIG.pageReloadIntervalMs / 1000)} \u79d2</div>`,
      lines.length > 0 ? `<div style=\"margin-top:6px\">${lines.join("<br>")}</div>` : ""
    ].join("");
  }

  function updateOverlayIdle() {
    overlay.innerHTML = [
      "<strong>\u540c\u6d4e\u573a\u5730\u76d1\u63a7</strong>",
      "<div>\u7b49\u5f85\u8fdb\u5165\u76ee\u6807\u9875\u9762...</div>",
      `<div style=\"margin-top:6px\">\u76ee\u6807\u573a\u9986 id: ${CONFIG.venueDetailId}</div>`
    ].join("");
  }

  function updateOverlayWaiting() {
    overlay.innerHTML = [
      "<strong>\u540c\u6d4e\u573a\u5730\u76d1\u63a7</strong>",
      "<div>\u5df2\u8fdb\u5165\u76ee\u6807\u9875\u9762\u3002</div>",
      "<div>\u6b63\u5728\u7b49\u5f85\u6570\u636e...</div>"
    ].join("");
  }

  function updateOverlayReloading() {
    overlay.innerHTML = [
      "<strong>\u540c\u6d4e\u573a\u5730\u76d1\u63a7</strong>",
      "<div>\u6b63\u5728\u5237\u65b0\u9875\u9762\u83b7\u53d6\u6700\u65b0\u6570\u636e...</div>"
    ].join("");
  }

  function clearPollTimer() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePollSoon(delayMs) {
    clearPollTimer();
    pollTimer = setTimeout(runPoll, delayMs);
  }

  function firstText(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const text = normalizeText(node.innerText || node.textContent);
      if (text) return text;
    }
    return "";
  }

  function queryAll(selectors, root = document) {
    const found = [];
    for (const selector of selectors) {
      try {
        found.push(...root.querySelectorAll(selector));
      } catch {
        // ignore invalid selector
      }
    }
    return found;
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function scoreStatus(status) {
    switch (status) {
      case "available": return 3;
      case "unknown": return 2;
      case "unavailable": return 1;
      case "full": return 0;
      default: return -1;
    }
  }
})();

