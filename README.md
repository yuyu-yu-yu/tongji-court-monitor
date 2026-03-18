# 同济羽毛球场地监控脚本

这是一个运行在 Tampermonkey 中的用户脚本，用于监控同济大学场馆预约 H5 页面里的羽毛球场地空余情况。

## 功能

- 运行在你自己的 Chrome 会话中
- 监控同济场馆 H5 详情页
- 检测羽毛球场地是否出现空位
- 本地弹出浏览器通知并播放提示音
- 可选发送企业微信 webhook 消息
- 同一个未变化的空位只推送一次

## 安装方式

1. 安装 Chrome 扩展 `Tampermonkey`
2. 打开 [tampermonkey/tongji-courts-monitor.user.js](tampermonkey/tongji-courts-monitor.user.js)
3. 复制整个脚本内容
4. 在 Tampermonkey 里新建脚本
5. 用复制的内容替换默认内容
6. 保存脚本

## 使用方式

1. 打开你平时正常使用的 Chrome 浏览器
2. 用你平时的方式登录同济场馆预约系统
3. 进入羽毛球馆详情页：
   `https://stadium.tongji.edu.cn/phone/#/detailAppoint?id=c7018ac0-af1f-4eb9-8f42-29156770a09c`
4. 保持页面打开

脚本会周期性检查当前页面，并按设定间隔自动刷新页面来重新获取最新状态。

## 配置项

脚本顶部的 `CONFIG` 可以自行调整。

常用字段：

- `pollIntervalMs`：当前页面 DOM 的检查间隔
- `pageReloadIntervalMs`：强制刷新页面的间隔
- `enterpriseWechatWebhookUrl`：企业微信机器人 webhook
- `fullKeywords`
- `availableKeywords`
- `unavailableKeywords`

企业微信示例：

```js
enterpriseWechatWebhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY"
```

## 当前行为

- 高频检查当前页面内容
- 定时强制刷新页面获取最新服务端数据
- 同一批未变化的空位只通知一次
- 空位消失后再次出现时会重新通知

## 限制

- 不会自动预约场地
- 依赖同济页面结构保持大致稳定
- 对非常短暂的空位变化仍然可能漏检
