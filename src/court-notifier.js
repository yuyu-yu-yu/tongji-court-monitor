export async function sendEnterpriseWechatText(webhookUrl, content) {
  if (!webhookUrl) {
    return { sent: false, reason: "webhook-disabled" };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      msgtype: "text",
      text: {
        content
      }
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Enterprise WeChat webhook request failed with ${response.status}: ${bodyText}`);
  }

  return { sent: true, responseText: bodyText };
}
