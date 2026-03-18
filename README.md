# Tongji Court Monitor

A Tampermonkey userscript for monitoring Tongji stadium badminton court availability on the Tongji H5 venue page.

## What It Does

- runs inside your normal Chrome session
- watches the Tongji H5 venue detail page
- detects when court availability appears
- sends a local browser notification and sound alert
- optionally sends an Enterprise WeChat webhook message
- avoids repeated alerts for the same unchanged availability

## Install

1. Install the Tampermonkey Chrome extension.
2. Open [tampermonkey/tongji-courts-monitor.user.js](tampermonkey/tongji-courts-monitor.user.js).
3. Copy the entire file.
4. Create a new script in Tampermonkey.
5. Replace the default content with the copied script.
6. Save the script.

## Use

1. Open your normal Chrome browser.
2. Log into the Tongji stadium site the same way you normally do.
3. Navigate to the badminton venue page:
   `https://stadium.tongji.edu.cn/phone/#/detailAppoint?id=c7018ac0-af1f-4eb9-8f42-29156770a09c`
4. Leave the page open.

The script polls the visible page, auto-reloads the page periodically to fetch fresh data, and only notifies once for the same unchanged availability.

## Configure

Edit the `CONFIG` object at the top of the userscript.

Useful fields:

- `pollIntervalMs`
- `pageReloadIntervalMs`
- `enterpriseWechatWebhookUrl`
- `fullKeywords`
- `availableKeywords`
- `unavailableKeywords`

Enterprise WeChat example:

```js
enterpriseWechatWebhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY"
```

## Current Behavior

- checks the current DOM frequently
- forces a page reload on a longer interval to fetch fresh server data
- sends one alert per distinct availability state
- sends another alert only if availability changes and later reappears

## Limits

- it does not book courts automatically
- it depends on the Tongji page structure staying similar
- it can still miss very short-lived availability changes between refreshes
