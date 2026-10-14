对 Shell 脚本进行风险评估，核心在于识别**破坏性操作、注入漏洞、环境失控、敏感信息泄漏及权限滥用**。

要建立一套可工程化落地的评估标准，通常采用“**静态静态语法与 AST 分析 + 规则引擎模式匹配 + 动态沙箱测试 + 人工评审门禁**”的四层评估流程。

---

## 风险等级与评估规则库

评估规则按破坏力与可控性分为四个风险等级：

| 风险等级 | 处置策略 | 典型判定特征 | 规则示例 |
| --- | --- | --- | --- |
| **高危 (L1 - Block)** | **一票否决**，CI/CD 直接阻断，禁止上线 | 涉及根目录/系统盘破坏、硬编码高危凭据、反弹 Shell/恶意网络下载、失控的通配符删除 | `rm -rf /`, `rm -rf $VAR/*` (未防空), `mkfs`, `dd of=/dev/sd*`, `curl ... | bash`, 明文 Password/Token |
| **中危 (L2 - Review)** | **人工审核**，需主管或安全专员二次确认 | 涉及全局提权、系统配置修改、核心服务生命周期重启、无限制的网络外联 | `chmod -R 777`, `kill -9 1`, `iptables -F`, `systemctl stop firewalld`, 执行未经安全审计的外部二进制 |
| **低危 (L3 - Warn)** | **告警提示**，提示整改但允许在测试环境运行 | 容错与防御机制缺失、缺少退出状态检查、变量未加引号引起的参数分词风险 | 脚本未加 `set -euo pipefail`、变量引用未带双引号 `"$var"`、未捕获命令返回码 `$?` |
| **信息 (L4 - Info)** | **代码规范**，常规代码异味（Code Smell） | 可移植性问题、过时的语法、命令冗余 | 使用已废弃的反引号 ``cmd`` 替代 `$(cmd)`、`eval` 的使用风险提示 |

---

## 落地规则清单（检测项明细）

### 1. 破坏性文件与存储操作（L1 / L2）

* **空变量导致的灾难性删除：**
* 危险模式：`rm -rf "$DIR/*"` 或 `rm -rf ${APP_PATH}/`（若 `$DIR` 为空，等价于 `rm -rf /*`）。
* 规则约束：必须带有空值断言防护，例如 `${DIR:?DIR is unset or empty}`。


* **危险路径删除：**
* 拒绝目标路径匹配以下正则：`^/(bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)?/?$`。


* **块设备与文件系统覆写：**
* 禁用 `mkfs.*`、`fdisk`、`parted` 以及直接输出重定向至 `/dev/sd*`、`/dev/nvme*` 或 `/dev/vd*` 的 `dd` 命令。



### 2. 动态执行与注入风险（L1 / L2）

* **管道执行网络脚本：**
* 阻断规则：`curl/wget/fetch ... | bash/sh/python`。必须拆分为“下载文件 -> 校验 SHA256 哈希 -> 本地执行”。


* **动态指令解析（`eval` / 变量即命令）：**
* 阻断直接接收不可信外部输入（如环境变量、HTTP 请求参数、命令行参数 `$1`）并喂给 `eval` 或通过 `sh -c` 运行的行为。



### 3. 稳健性与执行上下文（L3）

* **防御性头部声明：**
* 生产环境脚本必须包含严格模式：`set -euo pipefail`。
* `-e`：遇错即退出，防止后续依赖前置命令的逻辑发生雪崩。
* `-u`：使用未定义变量时报错退出，避免路径变量为空。
* `-o pipefail`：管道中只要有命令失败即视作整体失败。




* **工作目录漂移风险：**
* 危险模式：`cd "$PATH" && rm -rf *` 若 `cd` 失败，直接删除当前目录。
* 规范模式：`cd "$PATH" || exit 1`。



### 4. 权限与凭据安全（L1 / L2）

* **明文敏感词检测：**
* 匹配正则：`(password|passwd|secret|token|api_key|private_key)\s*=\s*['"][^'"]+['"]`。


* **过度提权与权限泛滥：**
* 拒绝 `chmod 777` 或 `chmod -R 777`。
* 审计 `sudoers` 修改行为，如往 `/etc/sudoers` 追加 `NOPASSWD: ALL`。



---

## 落地标准程序（Pipeline 设计）

在 CI/CD 流水线或自动化运维平台（如发布系统、堡垒机脚本审计模块）中，建议采用标准化的四阶段评估流程：

```
       [脚本提交 / 变更]
               │
               ▼
┌───────────────────────────────┐
│   Phase 1: 静态语法与 AST 解析  │ ──(语法错误)──> 立即阻断 (Fail)
└───────────────────────────────┘
               │
               ▼
┌───────────────────────────────┐
│   Phase 2: 规则引擎策略审计     │ ──(命中 L1)───> 立即阻断 (Fail)
└───────────────────────────────┘
               │ (命中 L2 标记待审)
               ▼
┌───────────────────────────────┐
│   Phase 3: 隔离环境 Dry-Run    │ ──(崩溃/违规)─> 立即阻断 (Fail)
└───────────────────────────────┘
               │
               ▼
┌───────────────────────────────┐
│   Phase 4: 风险评分与放行门禁   │ ──(Score < 80 或含 L2)──> 触发人工审批
└───────────────────────────────┘
               │ (通过)
               ▼
          [允许生产发布]

```

### Phase 1: 语法与 AST 检查

* **工具集成：** `bash -n script.sh` + **ShellCheck**。
* **目标：** 拦截未闭合引号、语法错误，并导出 Checkstyle/JSON 格式的异味报告。

### Phase 2: 规则引擎特征匹配

* **工具集成：** 自定义 Semgrep 规则或定制的 AST 解析脚本（如基于 `mvdan/sh` Go 库）。
* **目标：** 精准识别模式，相比纯 Regex，AST 能解析出真实的命令名与参数，剔除注释与普通字符串中的误报。

### Phase 3: 沙箱隔离 Dry-Run（试运行）

* **运行机制：** 在轻量容器（Docker）中挂载只读卷执行，并利用内核机制探测系统调用：
* 使用 `strace -f -e trace=file,process,network` 监控其真实产生的文件改动和系统调用。
* 验证其执行过程是否触碰预期外的文件系统或向外连网。



### Phase 4: 风险评分量化模型

建立量化公式：


$$\text{Score} = 100 - (N_{L1} \times 100) - (N_{L2} \times 20) - (N_{L3} \times 5) - (N_{L4} \times 1)$$

* **判定阈值：**
* `Score == 100` 且无任何 L2：**自动放行**。
* `80 <= Score < 100` 且不含 L1：**测试环境放行，生产环境需二级审批**。
* `Score < 80` 或含有任意 L1 违规：**阻断，退回修改**。



---

## 快速落地方案：基于 ShellCheck + Semgrep 的规则示范

无需从零开发复杂引擎，可以利用 **Semgrep** 编写 YAML 规则实现开箱即用的风险审计：

```yaml
rules:
  - id: dangerous-empty-variable-deletion
    languages: [bash]
    severity: ERROR
    message: "检测到可能导致全盘清空的删除操作：变量未做防空值保护"
    patterns:
      - pattern-either:
          - pattern: rm -rf $$VAR/*
          - pattern: rm -fr $$VAR/*
      - pattern-not: rm -rf ${$$VAR:?...}/*

  - id: curl-pipe-to-shell
    languages: [bash]
    severity: ERROR
    message: "禁止直接通过管道执行远程网络脚本"
    patterns:
      - pattern: $FETCH ... | $SHELL
      - metavariable-regex:
          metavariable: $FETCH
          regex: ^(curl|wget|fetch)$
      - metavariable-regex:
          metavariable: $SHELL
          regex: ^(bash|sh|zsh)$

```
