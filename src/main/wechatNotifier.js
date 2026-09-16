const https = require('https');
const http = require('http');

/**
 * 企业微信通知服务
 */
class WechatNotifier {

    /**
     * 发送工程任务执行通知
     */
    async sendProjectTaskNotification(task, execution, status, errorMessage) {
        if (!task.notify_webhook) return;

        const statusMap = {
            completed: { emoji: '✅', text: '执行成功' },
            failed:    { emoji: '❌', text: '执行失败' },
            interrupted: { emoji: '⚠️', text: '执行中断' }
        };
        const statusInfo = statusMap[status] || { emoji: '❔', text: status };

        const duration = this._formatDuration(execution.started_at, execution.completed_at);
        const stepInfo = `完成 ${execution.completed_steps || 0}/${execution.total_steps || 0} 步`;

        let content = `## 万象匣 - 工程任务通知

> **工程名称**: ${task.name}
> **执行状态**: ${statusInfo.emoji} ${statusInfo.text}
> **执行时长**: ${duration}
> **步骤统计**: ${stepInfo}`;

        if (errorMessage) {
            content += `\n> **失败原因**: ${errorMessage}`;
        }

        content += `\n\n*${new Date().toLocaleString('zh-CN')} 由 万象匣 自动发送*`;

        const message = {
            msgtype: 'markdown',
            markdown: { content }
        };

        return await this.sendMessage(task.notify_webhook, message);
    }

    /**
     * 发送消息到企业微信 Webhook
     */
    async sendMessage(webhookUrl, message) {
        return new Promise((resolve, reject) => {
            try {
                const body = JSON.stringify(message);
                const url = new URL(webhookUrl);
                const options = {
                    hostname: url.hostname,
                    port: url.port || (url.protocol === 'https:' ? 443 : 80),
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    },
                    timeout: 10000
                };

                const requester = url.protocol === 'https:' ? https : http;
                const req = requester.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const result = JSON.parse(data);
                            if (result.errcode === 0) {
                                console.log('企业微信通知发送成功');
                                resolve({ success: true });
                            } else {
                                console.error('企业微信通知发送失败:', result);
                                resolve({ success: false, error: result.errmsg });
                            }
                        } catch (e) {
                            resolve({ success: false, error: '响应解析失败' });
                        }
                    });
                });

                req.on('error', (err) => {
                    console.error('企业微信请求错误:', err);
                    resolve({ success: false, error: err.message });
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve({ success: false, error: '请求超时' });
                });

                req.write(body);
                req.end();
            } catch (err) {
                console.error('企业微信通知异常:', err);
                resolve({ success: false, error: err.message });
            }
        });
    }

    /**
     * 测试 Webhook 连通性
     */
    async testWebhook(webhookUrl) {
        const testMsg = {
            msgtype: 'text',
            text: { content: '万象匣 Webhook 测试消息，如收到此消息说明配置正确 ✅' }
        };
        return await this.sendMessage(webhookUrl, testMsg);
    }

    _formatDuration(startedAt, completedAt) {
        if (!startedAt) return '-';
        const start = new Date(startedAt);
        const end = completedAt ? new Date(completedAt) : new Date();
        const ms = end - start;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds} 秒`;
        const minutes = Math.floor(seconds / 60);
        const remainSecs = seconds % 60;
        if (minutes < 60) return `${minutes} 分 ${remainSecs} 秒`;
        const hours = Math.floor(minutes / 60);
        const remainMins = minutes % 60;
        return `${hours} 小时 ${remainMins} 分`;
    }
}

module.exports = { WechatNotifier };
