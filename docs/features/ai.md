把 AI 引入 Shell 脚本的审查与分析，核心不在于让大模型写一篇“长篇大论”，而在于**在 5 秒钟内打消运维/开发人员对脚本上线与执行的顾虑**。

---

## 运维与工程团队最在意的核心指标

人在看一段既有脚本或准备上线执行一段脚本时，最关注的并非代码规范（语法糖、变量命名），而是**破坏力、稳定性与生产不可控因素**：

1. **破坏力与不可逆操作（Blast Radius）**：
* 是否有未受保护的 `rm -rf`、`kill -9`、直接格式化磁盘或清空数据库操作。
* 变量未定义导致路径坍缩（如 `rm -rf $DIR/`，当 `$DIR` 为空时直接清空根目录）。


2. **幂等性与重试安全（Idempotency）**：
* 脚本重复执行一次会不会产生重复数据、覆盖运行中的服务或引发死锁？


3. **环境与权限依赖（Prerequisites）**：
* 是否要求 `root` 权限？依赖哪些外部工具（`jq`、`curl`、`awk`、特定系统架构或内核版本）？


4. **容错机制与退出状态（Fail-Safe）**：
* 是否配置了 `set -euo pipefail`？发生错误时会静默继续执行破坏性逻辑，还是立即中断？
* 关键管道命令的退出码是否被掩盖？


5. **执行效率与死循环/阻塞风险**：
* 缺乏超时的 `while true`、无限制等待的远程 SSH/HTTP 请求、大规模遍历大目录导致 I/O 打死。



---

## 评估维度与标准输出定义

为了标准化与机器消费（如展示到管理控制台、CI/CD 报告），AI 的分析结果应强制输出结构化格式（JSON 为底座，前端渲染成卡片/摘要）。

### 1. 评估维度（Evaluation Matrix）

| 维度 | 审查要点 | 关键指标 |
| --- | --- | --- |
| **安全与破坏性** | 路径注入、变量未定义引用、提权行为、硬编码敏感信息 | 危险等级（高/中/低）、高危代码行数 |
| **健壮与健壮性** | 错误中断（`set -e`）、未捕获退出码、信号处理（`trap`） | 异常容错完备度（布尔/评分） |
| **依赖与运行环境** | 系统工具依赖、Bash/Sh 语法方言（Bashism）、网络/端口连通性要求 | 依赖清单、最低权限要求 |
| **逻辑与幂等性** | 重复执行安全、文件/目录已存在检测、进程重入防护 | 幂等状态、重入风险点 |

### 2. 标准输出格式（Structured Output）

让 AI 直接输出严格的 JSON Schema，便于前端解析成卡片，最关键数据置顶：

```json
{
  "summary": {
    "purpose": "脚本主要作用（1句话说明业务意图）",
    "risk_level": "CRITICAL | HIGH | MEDIUM | LOW | SAFE",
    "is_idempotent": false,
    "requires_root": true,
    "execution_time_estimate": "< 10s | 1-5min | long-running"
  },
  "critical_risks": [
    {
      "line": 42,
      "snippet": "rm -rf /data/logs/$APP_NAME/*",
      "issue": "若 APP_NAME 未传入或为空，将匹配 /data/logs/ 并删除上级目录所有文件",
      "solution": "使用 rm -rf \"/data/logs/${APP_NAME:?APP_NAME is required}/*\" 或先判空"
    }
  ],
  "dependencies": {
    "system_commands": ["rsync", "jq", "systemctl"],
    "external_resources": ["远程服务器 10.10.x.x SSH 访问", "外部 API: api.example.com"]
  },
  "robustness_check": {
    "strict_mode_configured": false,
    "missing_traps": ["EXIT", "SIGTERM"],
    "unhandled_subshells": true
  },
  "recommended_patch": "修复核心安全隐患后的 diff 或修改建议"
}

```

---

## 结果展示设计：人在 UI 上最看重什么？

前端展示绝不能堆砌长文本，必须遵循“交通灯”法则：

```
+-----------------------------------------------------------------------+
|  [HIGH RISK] 生产高危 | 权限: Root | 幂等: 否 | 耗时: <30s            |
|  功能摘要: 清理 /data 目录下的归档日志并压缩发送到备份机              |
+-----------------------------------------------------------------------+
|  [!] 2 项严重阻断问题 (必须修复)                                     |
|   - 行 14: 变量 $BACKUP_DIR 未赋默认值，可能造成根目录误删          |
|   - 行 29: 未开启 set -e，tar 打包失败后仍会删除原始日志             |
+-----------------------------------------------------------------------+
|  [-] 依赖检测: jq (需提前安装), rsync, ssh 免密配置                   |
+-----------------------------------------------------------------------+
|  [>] 推荐改动 (Diff / 关键修复代码)                                   |
+-----------------------------------------------------------------------+

```

---

## 实用 Prompt 设计（System + User 模板）

### System Prompt

```text
你是一个资深的 Linux 自动化与基础设施安全工程师。你的任务是对传入的 Shell 脚本进行安全合规、生产健壮性及逻辑影响评估。

【核心原则】
1. 生产安全性高于代码优雅度：优先捕获未受保护的删除、kill、无限循环、未定义变量使用。
2. 保持极致精炼，直击要害，绝不堆砌套话。
3. 必须严格按照指定 JSON Schema 输出，不得输出任何未经 JSON 包装的自然语言。

【重点审查项】
- 变量展开风险（如缺少双引号导致分词或 globbing、空变量导致路径坍缩）
- 错误中断策略（set -euo pipefail、管道退出状态 PIPESTATUS）
- 幂等性（重复执行是否安全）
- 资源清理机制（trap 捕获信号并清理临时文件）
- 外部依赖项（特殊外部二进制、网络连通性、特定执行权限）

```

### User Prompt 模板

```text
请对以下 Shell 脚本进行安全与工程健壮性审查：

```bash
{{YOUR_SHELL_SCRIPT_CONTENT}}

```

请严格按照以下 JSON 格式返回分析结果：
{
"summary": {
"purpose": "用1句话解释该脚本做什么",
"risk_level": "CRITICAL / HIGH / MEDIUM / LOW / SAFE",
"is_idempotent": true / false,
"requires_root": true / false
},
"critical_risks": [
{
"line": 脚本行号,
"snippet": "涉及代码片段",
"issue": "风险具体解释",
"solution": "修复建议"
}
],
"dependencies": {
"commands": ["外部命令清单"],
"env_vars": ["依赖的环境变量"]
},
"robustness_score": 1到10分（评估其错误捕获与退出安全）,
"optimized_snippet": "关键风险点修复后的代码片段"
}


软件设置按钮
#大模型接入
提供商
Base URL
智谱示例：https://open.bigmodel.cn/api/paas/v4。基础地址自动补全路径；以 /chat/completions 结尾的完整端点原样使用。 必须使用 https:// 地址（明文 http:// 仅允许本机或内网地址，如本地 Ollama、192.168.x.x、10.x.x.x、.local/.internal 主机名）。
API Key
密钥将用 AES-GCM 加密存储于本地。
模型
Temperature
流式渲染 (SSE)
测试连接