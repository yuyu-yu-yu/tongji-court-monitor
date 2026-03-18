import { chromium } from "playwright-core";
import { bell, formatBanner } from "./alerts.js";
import { createLogger } from "./logger.js";
import { buildAvailabilityDigest, formatAvailabilityMessage, isLikelyDateCardText, parseDateCardText, parseSlotText } from "./court-parser.js";
import { sendEnterpriseWechatText } from "./court-notifier.js";

const DEFAULT_MOBILE_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";

export async function watchCourts(config) {
  const logger = await createLogger(config.logsDir);
  let context;
  let page;
  let stopped = false;
  let lastDigest = "";
  let loginWarningShown = false;

  const sigintHandler = async () => {
    stopped = true;
    process.stdout.write(formatBanner("Stopping court watcher"));
    await logger.info("Interrupted by user");
    process.exitCode = 130;
  };

  try {
    await logger.info("Booting court watcher", {
      configPath: config.configPath,
      targetUrl: config.targetUrl,
      entryUrl: config.entryUrl,
      pollIntervalMs: config.pollIntervalMs
    });

    context = await chromium.launchPersistentContext(config.userDataDir, {
      channel: config.browserChannel,
      executablePath: config.chromeExecutablePath,
      headless: false,
      viewport: { width: config.windowWidth, height: config.windowHeight },
      locale: config.locale,
      timezoneId: config.timezoneId,
      userAgent: config.userAgent,
      isMobile: config.isMobile,
      hasTouch: config.hasTouch,
      deviceScaleFactor: config.deviceScaleFactor
    });

    process.on("SIGINT", sigintHandler);

    page = await ensureCourtPage(context, page, config, logger, true);

    while (!stopped) {
      const pollStartedAt = new Date().toISOString();

      try {
        page = await ensureCourtPage(context, page, config, logger, false);
        await settlePage(page, config.settleDelayMs);
        let snapshot = await collectCourtSnapshot(page, config);

        if (isShellPage(snapshot)) {
          await logger.warn("Court page looks incomplete; retrying via entry flow", {
            pollStartedAt,
            url: snapshot.url,
            title: snapshot.title
          });
          page = await ensureCourtPage(context, page, config, logger, false, { forceEntryFlow: true });
          await settlePage(page, config.settleDelayMs);
          snapshot = await collectCourtSnapshot(page, config);
        }

        if (snapshot.loginRequired) {
          if (!loginWarningShown) {
            bell(2);
            process.stdout.write(formatBanner("Login required. Complete login in the browser and leave the page on the Tongji phone site."));
            loginWarningShown = true;
          }

          await logger.warn("Login appears to be required for court monitoring", {
            pollStartedAt,
            url: snapshot.url,
            title: snapshot.title
          });
        } else {
          loginWarningShown = false;
          const digest = buildAvailabilityDigest(snapshot.availableDays);
          let notified = false;
          let webhookResult = { sent: false, reason: "no-availability" };

          if (snapshot.availableDays.length === 0) {
            lastDigest = "";
            await logger.info("No court availability found", {
              pollStartedAt,
              venueName: snapshot.venueName,
              dateCards: snapshot.dateCards
            });
          } else if (digest !== lastDigest) {
            lastDigest = digest;
            bell(4);
            process.stdout.write(formatBanner("Court availability detected"));
            const message = formatAvailabilityMessage({
              venueName: snapshot.venueName,
              targetUrl: config.targetUrl,
              days: snapshot.availableDays,
              detectedAt: pollStartedAt
            });
            webhookResult = await sendEnterpriseWechatText(config.enterpriseWechatWebhookUrl, message);
            notified = true;
            await logger.info("Court availability detected", {
              pollStartedAt,
              venueName: snapshot.venueName,
              availableDays: snapshot.availableDays,
              notified,
              webhookResult
            });
            console.log(message);
          } else {
            await logger.info("Court availability unchanged", {
              pollStartedAt,
              venueName: snapshot.venueName,
              availableDays: snapshot.availableDays,
              notified
            });
          }
        }
      } catch (error) {
        await logger.error("Court polling failed", {
          pollStartedAt,
          error: error.message
        });
      }

      if (!stopped) {
        await sleep(config.pollIntervalMs);
      }
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    if (context) {
      await safeCloseContext(context, logger);
    }
  }
}

async function ensureCourtPage(context, page, config, logger, isInitialOpen, options = {}) {
  const forceEntryFlow = options.forceEntryFlow === true;
  let activePage = page;
  if (!activePage || activePage.isClosed()) {
    activePage = context.pages().find((candidate) => !candidate.isClosed()) ?? (await context.newPage());
  }

  await activePage.setViewportSize({ width: config.windowWidth, height: config.windowHeight });
  await activePage.bringToFront();

  const useEntryFlow = isInitialOpen || forceEntryFlow || !activePage.url() || !activePage.url().includes("detailAppoint");
  if (useEntryFlow) {
    await activePage.goto(config.entryUrl, { waitUntil: "domcontentloaded" });
    await settlePage(activePage, config.entrySettleDelayMs);
    await activePage.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
    await logger.info("Opened court page via entry flow", { url: activePage.url() });
  } else if (!activePage.url().startsWith(config.targetUrl)) {
    await activePage.goto(config.entryUrl, { waitUntil: "domcontentloaded" });
    await settlePage(activePage, config.entrySettleDelayMs);
    await activePage.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
    await logger.warn("Recovered court page by navigating through entry flow", { url: activePage.url() });
  } else {
    await activePage.reload({ waitUntil: "domcontentloaded" });
  }

  return activePage;
}

async function collectCourtSnapshot(page, config) {
  const pageMetadata = await page.evaluate(({ venueNameSelectors, loginKeywords }) => {
    const bodyText = document.body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
    let venueName = "";
    for (const selector of venueNameSelectors) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length >= 2) {
        venueName = text;
        break;
      }
    }

    const loginRequired = loginKeywords.some((keyword) => bodyText.includes(keyword));
    return {
      url: location.href,
      title: document.title ?? "",
      venueName,
      bodyText,
      loginRequired
    };
  }, {
    venueNameSelectors: config.venueNameSelectors,
    loginKeywords: config.loginKeywords
  });

  const dateCards = await collectDateCards(page, config);
  const availableDays = [];
  for (const dateCard of dateCards) {
    if (dateCard.status === "full" || dateCard.status === "unavailable") {
      continue;
    }

    if (dateCard.status === "unknown" && !config.inspectUnknownDays) {
      continue;
    }

    const slots = await inspectSlotsForDateCard(page, config, dateCard.index);
    if (dateCard.status === "available" || slots.length > 0) {
      availableDays.push({
        ...dateCard,
        slots
      });
    }
  }

  return {
    ...pageMetadata,
    dateCards,
    availableDays,
    loginRequired: pageMetadata.loginRequired && dateCards.length === 0
  };
}

async function collectDateCards(page, config) {
  const selectorUnion = config.dateCardSelectors.join(", ");
  const rawCards = await page.evaluate(({ selectorUnion }) => {
    return [...document.querySelectorAll(selectorUnion)]
      .map((node, index) => {
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        return {
          index,
          text,
          visible: rect.width > 0 && rect.height > 0
        };
      })
      .filter((item) => item.visible && item.text);
  }, { selectorUnion });

  const deduped = new Map();
  for (const rawCard of rawCards) {
    if (!isLikelyDateCardText(rawCard.text)) {
      continue;
    }

    const parsed = parseDateCardText(rawCard.text, config);
    const existing = deduped.get(parsed.label);
    const candidate = { ...parsed, index: rawCard.index };
    if (!existing || scoreStatus(candidate.status) > scoreStatus(existing.status)) {
      deduped.set(parsed.label, candidate);
    }
  }

  return [...deduped.values()].sort((left, right) => left.index - right.index);
}

async function inspectSlotsForDateCard(page, config, cardIndex) {
  const selectorUnion = config.dateCardSelectors.join(", ");
  const dateCard = page.locator(selectorUnion).nth(cardIndex);

  try {
    if (await dateCard.count()) {
      await dateCard.scrollIntoViewIfNeeded();
      await dateCard.click({ timeout: 2000 });
      await settlePage(page, config.settleDelayMs);
    }
  } catch {
    return [];
  }

  const slotSelectorUnion = config.slotRowSelectors.join(", ");
  const rawSlots = await page.evaluate(({ slotSelectorUnion }) => {
    return [...document.querySelectorAll(slotSelectorUnion)]
      .map((node) => {
        const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
        const rect = node.getBoundingClientRect();
        return {
          text,
          visible: rect.width > 0 && rect.height > 0
        };
      })
      .filter((item) => item.visible && item.text);
  }, { slotSelectorUnion });

  const deduped = new Map();
  for (const rawSlot of rawSlots) {
    if (!rawSlot.text.match(/\d{1,2}:\d{2}/)) {
      continue;
    }

    const parsed = parseSlotText(rawSlot.text, config);
    if (parsed.status === "full" || parsed.status === "unavailable") {
      continue;
    }

    if (!deduped.has(parsed.label)) {
      deduped.set(parsed.label, parsed);
    }
  }

  return [...deduped.values()];
}

function isShellPage(snapshot) {
  const staticLabels = ["地点", "营业时间", "联系电话", "场馆设施", "场馆介绍", "使用须知"];
  const hasOnlyStaticShell = staticLabels.every((label) => snapshot.bodyText.includes(label));
  return hasOnlyStaticShell && snapshot.dateCards.length === 0;
}

function scoreStatus(status) {
  switch (status) {
    case "available":
      return 3;
    case "unknown":
      return 2;
    case "unavailable":
      return 1;
    case "full":
      return 0;
    default:
      return -1;
  }
}

async function settlePage(page, settleDelayMs) {
  await page.waitForTimeout(settleDelayMs);
}

async function safeCloseContext(context, logger) {
  try {
    await logger.info("Closing browser context");
    await context.close();
  } catch {
    // ignore cleanup failures
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function getDefaultMobileCourtConfig() {
  return {
    entryUrl: "https://stadium.tongji.edu.cn/phone/",
    userAgent: DEFAULT_MOBILE_USER_AGENT,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2
  };
}
