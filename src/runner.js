import { chromium } from "playwright-core";
import { bell, formatBanner } from "./alerts.js";
import { createLogger } from "./logger.js";
import { DEFAULT_DISABLED_TEXT_PATTERNS, DEFAULT_READY_TEXT_PATTERNS, detectPageSignal, extractSelectorSignals, summarizeButtonSnapshot } from "./signals.js";
import { createRuntimeState, TARGET_STATES } from "./state-machine.js";

const BINDING_NAME = "__damaiEmit";

export async function arm(config) {
  const logger = await createLogger(config.logsDir);
  const runtime = createRuntimeState(logger);
  let context;
  let page;
  let finished = false;
  let clickInFlight = false;
  let clickIssued = false;
  let saleTimer;
  let prewarmTimer;

  const finish = async (state, message, details = {}) => {
    if (finished) {
      return;
    }

    finished = true;
    await runtime.transition(state, details);
    await logger.info(message, {
      targetState: state,
      timestamps: runtime.timestamps,
      ...details
    });
  };

  try {
    await logger.info("Booting assistant", {
      configPath: config.configPath,
      eventUrl: config.eventUrl,
      saleTime: new Date(config.saleTimestamp).toISOString(),
      logPath: logger.logPath
    });

    context = await chromium.launchPersistentContext(config.userDataDir, {
      channel: config.browserChannel,
      executablePath: config.chromeExecutablePath,
      headless: false,
      viewport: { width: config.windowWidth, height: config.windowHeight },
      locale: config.locale,
      timezoneId: config.timezoneId
    });

    await context.exposeBinding(BINDING_NAME, async ({ page: sourcePage }, payload) => {
      if (!page || sourcePage === page) {
        await handlePageEvent(payload);
      }
    });

    page = await ensureTargetPage(context, config, logger);
    await closeExtraPages(context, page, logger);
    await installBuyMonitor(page, config);
    await ensureArmedPage(page, config, logger);

    runtime.mark("armedAt");
    await runtime.transition(TARGET_STATES.ARMED, { url: page.url() });

    const initialButton = await probeBuyButton(page, config);
    if (!initialButton.found) {
      throw new Error("Purchase button was not found. Update buyButtonSelectors in the config.");
    }

    await logger.info("Purchase button detected", {
      summary: summarizeButtonSnapshot(initialButton)
    });

    attachPageGuards(page, logger);

    const millisUntilPrewarm = Math.max(config.saleTimestamp - Date.now() - config.prewarmSeconds * 1000, 0);
    prewarmTimer = setTimeout(async () => {
      runtime.mark("prewarmAt");
      bell(1);
      process.stdout.write(formatBanner("Prewarm window started"));
      await logger.info("Entered prewarm window", { prewarmSeconds: config.prewarmSeconds });
    }, millisUntilPrewarm);

    const millisUntilSale = Math.max(config.saleTimestamp - Date.now(), 0);
    saleTimer = setTimeout(async () => {
      bell(2);
      process.stdout.write(formatBanner("Sale time reached"));
      await logger.info("Sale time reached");
      await attemptSingleEntryClick();
    }, millisUntilSale);

    const sigintHandler = async () => {
      await finish(TARGET_STATES.STOPPED, "Interrupted by user");
      process.exitCode = 130;
    };

    process.on("SIGINT", sigintHandler);

    while (!finished) {
      await inspectCurrentPage(false);
      await sleep(250);
    }

    process.off("SIGINT", sigintHandler);
    clearTimeout(saleTimer);
    clearTimeout(prewarmTimer);
    await safeCloseContext(context, logger);

    return {
      state: runtime.current,
      timestamps: runtime.timestamps,
      logPath: logger.logPath
    };

    async function handlePageEvent(payload) {
      if (finished || !payload) {
        return;
      }

      if (payload.type === "page_visibility" && payload.hidden) {
        bell(1);
        await logger.warn("Target page lost visibility", payload);
        return;
      }

      if (payload.type === "page_focus" && !payload.focused) {
        await logger.warn("Target page lost focus", payload);
        return;
      }

      if (payload.type !== "buy_button") {
        return;
      }

      if (payload.actionable && !runtime.timestamps.buyReadyAt) {
        runtime.mark("buyReadyAt");
        await runtime.transition(TARGET_STATES.BUY_READY, {
          selector: payload.selector,
          text: payload.text
        });
        await logger.info("Purchase button became actionable", payload);
      }

      if (payload.actionable && getCurrentTimeSource(config.clockSource) >= config.saleTimestamp) {
        await attemptSingleEntryClick(payload.selector);
      }
    }

    async function attemptSingleEntryClick(preferredSelector) {
      if (finished || clickInFlight || clickIssued) {
        return;
      }

      const snapshot = await probeBuyButton(page, config);
      if (!snapshot.found) {
        await logger.warn("Purchase button vanished before click");
        return;
      }

      if (!snapshot.actionable) {
        await logger.info("Sale time reached but button is not actionable", {
          summary: summarizeButtonSnapshot(snapshot)
        });
        return;
      }

      clickInFlight = true;
      clickIssued = true;

      try {
        await page.bringToFront();
        const selector = preferredSelector ?? snapshot.selector;
        await page.locator(selector).first().click({ timeout: 1500, noWaitAfter: false });
        runtime.mark("firstClickAt");
        await logger.info("Clicked purchase entry", { selector });
        await inspectCurrentPage(true);
      } catch (error) {
        clickIssued = false;
        await logger.error("Failed to click purchase entry", { error: error.message });
      } finally {
        clickInFlight = false;
      }
    }

    async function inspectCurrentPage(fromClick) {
      if (finished) {
        return;
      }

      const snapshot = await takePageSnapshot(page, config);
      const queueSignal = detectPageSignal(config.queuePageSignals, snapshot);
      if (queueSignal) {
        bell(3);
        process.stdout.write(formatBanner("Queue or congestion page detected"));
        await finish(TARGET_STATES.QUEUE_BLOCKED, "Queue page detected", {
          signal: queueSignal,
          snapshot: compactSnapshot(snapshot)
        });
        return;
      }

      const confirmSignal = detectPageSignal(config.confirmPageSignals, snapshot);
      if (confirmSignal) {
        runtime.mark("confirmReadyAt");
        await prepareConfirmPage(page, config, logger);
        const mismatches = collectConfirmMismatches(snapshot, config);
        bell(4);
        process.stdout.write(formatBanner("Confirmation page ready. Review and click submit manually."));
        await finish(TARGET_STATES.CONFIRM_READY, "Confirmation page ready for manual submission", {
          signal: confirmSignal,
          mismatches
        });
        return;
      }

      if (fromClick) {
        await logger.info("Clicked purchase entry but did not yet reach a terminal page", {
          snapshot: compactSnapshot(snapshot)
        });
      }
    }
  } catch (error) {
    await runtime.transition(TARGET_STATES.FAILED, { error: error.message });
    await logger.error("Assistant failed", { error: error.message, timestamps: runtime.timestamps });
    clearTimeout(saleTimer);
    clearTimeout(prewarmTimer);
    await safeCloseContext(context, logger);
    throw error;
  }
}

async function ensureTargetPage(context, config, logger) {
  let page = context.pages().find((candidate) => candidate.url().startsWith(config.eventUrl));

  if (!page) {
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(config.eventUrl, { waitUntil: "domcontentloaded" });
    await logger.info("Opened event URL", { url: page.url() });
  }

  await page.setViewportSize({ width: config.windowWidth, height: config.windowHeight });
  await page.bringToFront();
  return page;
}

async function closeExtraPages(context, targetPage, logger) {
  const pages = context.pages();
  for (const page of pages) {
    if (page !== targetPage) {
      await logger.warn("Closing extra page to keep one focused target tab", { url: page.url() });
      await page.close();
    }
  }
}

async function ensureArmedPage(page, config, logger) {
  const currentUrl = page.url();
  if (!currentUrl.startsWith(config.eventUrl)) {
    throw new Error(`Target page URL mismatch. Expected prefix ${config.eventUrl}, received ${currentUrl}`);
  }

  if (config.expectedEventTitle) {
    const content = await page.content();
    if (!content.includes(config.expectedEventTitle)) {
      await logger.warn("Expected event title not found on armed page", {
        expectedEventTitle: config.expectedEventTitle
      });
    }
  }
}

function attachPageGuards(page, logger) {
  page.on("framenavigated", async (frame) => {
    if (frame === page.mainFrame()) {
      await logger.info("Main frame navigated", { url: page.url() });
    }
  });

  page.on("close", async () => {
    await logger.warn("Target page closed");
  });
}

async function installBuyMonitor(page, config) {
  const payload = {
    bindingName: BINDING_NAME,
    selectors: config.buyButtonSelectors,
    readyPatterns: config.buyReadyTextPatterns ?? DEFAULT_READY_TEXT_PATTERNS,
    disabledPatterns: config.disabledTextPatterns ?? DEFAULT_DISABLED_TEXT_PATTERNS
  };

  await page.addInitScript(monitorBootstrap, payload);
  await page.evaluate(monitorBootstrap, payload);
}

function monitorBootstrap({ bindingName, selectors, readyPatterns, disabledPatterns }) {
  const emitter = globalThis[bindingName];
  if (typeof emitter !== "function") {
    return;
  }

  const install = () => {
    const previous = globalThis.__damaiMonitor;
    if (previous?.disconnect) {
      previous.disconnect();
    }

    let lastButtonSignature = "";
    let lastFocusSignature = "";
    let lastVisibilitySignature = "";

    const emit = (payload) => {
      try {
        emitter(payload);
      } catch {
        // ignore page-side binding errors
      }
    };

    const scanButton = () => {
      let snapshot = { type: "buy_button", found: false };
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }

        const disabled =
          node.disabled === true ||
          node.getAttribute("disabled") !== null ||
          node.getAttribute("aria-disabled") === "true" ||
          node.classList.contains("disabled") ||
          node.classList.contains("is-disabled");
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        const actionable =
          visible &&
          !disabled &&
          readyPatterns.some((pattern) => text.includes(pattern)) &&
          !disabledPatterns.some((pattern) => text.includes(pattern));

        snapshot = {
          type: "buy_button",
          found: true,
          selector,
          text,
          disabled,
          visible,
          actionable
        };
        break;
      }

      const signature = JSON.stringify(snapshot);
      if (signature !== lastButtonSignature) {
        lastButtonSignature = signature;
        emit(snapshot);
      }
    };

    const reportFocus = () => {
      const payload = {
        type: "page_focus",
        focused: document.hasFocus()
      };
      const signature = JSON.stringify(payload);
      if (signature !== lastFocusSignature) {
        lastFocusSignature = signature;
        emit(payload);
      }
    };

    const reportVisibility = () => {
      const payload = {
        type: "page_visibility",
        hidden: document.hidden
      };
      const signature = JSON.stringify(payload);
      if (signature !== lastVisibilitySignature) {
        lastVisibilitySignature = signature;
        emit(payload);
      }
    };

    const observer = new MutationObserver(() => {
      scanButton();
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "aria-disabled"]
      });
    }

    window.addEventListener("focus", reportFocus, true);
    window.addEventListener("blur", reportFocus, true);
    document.addEventListener("visibilitychange", reportVisibility, true);

    globalThis.__damaiMonitor = {
      disconnect() {
        observer.disconnect();
        window.removeEventListener("focus", reportFocus, true);
        window.removeEventListener("blur", reportFocus, true);
        document.removeEventListener("visibilitychange", reportVisibility, true);
      }
    };

    scanButton();
    reportFocus();
    reportVisibility();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}

async function probeBuyButton(page, config) {
  return page.evaluate(
    ({ selectors, readyPatterns, disabledPatterns }) => {
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }

        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        const disabled =
          node.disabled === true ||
          node.getAttribute("disabled") !== null ||
          node.getAttribute("aria-disabled") === "true" ||
          node.classList.contains("disabled") ||
          node.classList.contains("is-disabled");
        const rect = node.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        const actionable =
          visible &&
          !disabled &&
          readyPatterns.some((pattern) => text.includes(pattern)) &&
          !disabledPatterns.some((pattern) => text.includes(pattern));

        return {
          found: true,
          selector,
          text,
          disabled,
          visible,
          actionable
        };
      }

      return { found: false, actionable: false };
    },
    {
      selectors: config.buyButtonSelectors,
      readyPatterns: config.buyReadyTextPatterns ?? DEFAULT_READY_TEXT_PATTERNS,
      disabledPatterns: config.disabledTextPatterns ?? DEFAULT_DISABLED_TEXT_PATTERNS
    }
  );
}

async function takePageSnapshot(page, config) {
  const selectorSignals = [
    ...new Set([
      ...extractSelectorSignals(config.queuePageSignals),
      ...extractSelectorSignals(config.confirmPageSignals),
      ...config.agreementSelectors,
      ...config.submitButtonSelectors
    ])
  ];

  return page.evaluate(({ selectorSignals }) => {
    const matchedSelectors = selectorSignals.filter((selector) => document.querySelector(selector));
    const text = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    return {
      url: location.href,
      title: document.title ?? "",
      text,
      matchedSelectors
    };
  }, { selectorSignals });
}

async function prepareConfirmPage(page, config, logger) {
  const checkedSelectors = [];
  for (const selector of config.agreementSelectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count();
    if (count === 0) {
      continue;
    }

    const result = await locator.evaluate((node) => {
      const isCheckbox = node instanceof HTMLInputElement && node.type === "checkbox";
      if (isCheckbox) {
        return { canClick: !node.checked, role: "checkbox" };
      }

      const ariaChecked = node.getAttribute("aria-checked");
      if (ariaChecked === "false") {
        return { canClick: true, role: "aria-checkbox" };
      }

      return { canClick: false, role: "passive" };
    });

    if (result.canClick) {
      await locator.click({ timeout: 1000 });
      checkedSelectors.push(selector);
    }
  }

  if (checkedSelectors.length > 0) {
    await logger.info("Checked agreement selectors", { checkedSelectors });
  }

  const focusedSelector = await focusSubmitButton(page, config.submitButtonSelectors);
  if (!focusedSelector) {
    await logger.warn("Submit button was not found on confirmation page");
    return;
  }

  await logger.info("Focused submit button for manual confirmation", { selector: focusedSelector });
}

async function focusSubmitButton(page, selectors) {
  return page.evaluate((buttonSelectors) => {
    const styleId = "__damai-submit-highlight";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        [data-damai-submit-target="true"] {
          outline: 4px solid #ff2d55 !important;
          outline-offset: 4px !important;
        }
      `;
      document.head.appendChild(style);
    }

    for (const selector of buttonSelectors) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      node.setAttribute("data-damai-submit-target", "true");
      node.focus?.();
      return selector;
    }

    return null;
  }, selectors);
}

function collectConfirmMismatches(snapshot, config) {
  const mismatches = [];
  if (config.expectedEventTitle && !snapshot.text.includes(config.expectedEventTitle)) {
    mismatches.push(`expectedEventTitle=${config.expectedEventTitle}`);
  }

  if (config.expectedTicketLabel && !snapshot.text.includes(config.expectedTicketLabel)) {
    mismatches.push(`expectedTicketLabel=${config.expectedTicketLabel}`);
  }

  if (Number.isInteger(config.expectedQuantity)) {
    const quantityVariants = [
      `x${config.expectedQuantity}`,
      `${config.expectedQuantity}ÕÅ`,
      `ÊýÁ¿ ${config.expectedQuantity}`
    ];
    if (!quantityVariants.some((variant) => snapshot.text.includes(variant))) {
      mismatches.push(`expectedQuantity=${config.expectedQuantity}`);
    }
  }

  return mismatches;
}

function compactSnapshot(snapshot) {
  return {
    url: snapshot.url,
    title: snapshot.title,
    textPreview: snapshot.text.slice(0, 240),
    matchedSelectors: snapshot.matchedSelectors
  };
}

function getCurrentTimeSource(clockSource) {
  if (clockSource === "browser") {
    return Date.now();
  }

  return Date.now();
}

async function safeCloseContext(context, logger) {
  if (!context) {
    return;
  }

  try {
    await logger.info("Closing browser context");
    await context.close();
  } catch {
    // ignore close errors
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
