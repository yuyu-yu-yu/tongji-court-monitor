# TicketHunter

This repository contains two separate tools:

- [tongji-courts-monitor.user.js](/C:/TicketHunter/tampermonkey/tongji-courts-monitor.user.js): a Tongji stadium H5 availability monitor that runs inside your normal Chrome page through Tampermonkey.
- `arm`: the older Damai helper that only prepares the page and stops before final order submission.

## Tongji Court Monitor

The recommended Tongji path is now the Tampermonkey userscript, not the Playwright watcher. The Tongji H5 site did not render reliably inside an automated browser profile, so the monitor now runs in your everyday Chrome session and only reads page content plus sends alerts.

### Install Tampermonkey

1. Install the Tampermonkey Chrome extension.
2. Open [tongji-courts-monitor.user.js](/C:/TicketHunter/tampermonkey/tongji-courts-monitor.user.js).
3. Copy the whole file content.
4. In Tampermonkey, create a new script and replace the default content with the copied script.
5. Save the script.

### Use It

1. Open your normal Chrome browser.
2. Log into the Tongji stadium site the same way you normally do.
3. Open the target venue page:
   `https://stadium.tongji.edu.cn/phone/#/detailAppoint?id=c7018ac0-af1f-4eb9-8f42-29156770a09c`
4. Leave that page open.

The script will:

- watch the page in your normal browser session
- scan date cards and nearby slot rows
- show a small status panel in the lower-right corner
- alert when availability appears
- optionally send a text message to an Enterprise WeChat webhook

### Configure It

Edit the `CONFIG` object at the top of the userscript.

Most important fields:

- `pollIntervalMs`
- `enterpriseWechatWebhookUrl`
- `fullKeywords`
- `availableKeywords`
- `unavailableKeywords`

Enterprise WeChat setup:

1. Create a group robot in Enterprise WeChat.
2. Copy the webhook URL.
3. Paste it into:

```js
enterpriseWechatWebhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY"
```

If you leave it empty, the script still works with local browser notifications and sound.

### Current Limits

- It does not click anything.
- It does not book courts automatically.
- It depends on the Tongji page structure staying similar.
- If the page stops updating by itself, you may still need to refresh the page manually or enhance the script later.

## Damai Assistant

The original Damai assistant is still available:

```powershell
npm run arm -- --config .\config\damai.config.json
```
