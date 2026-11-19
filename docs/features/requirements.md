# Requirements Document

> **状态：已搁置（2026-11-12）**
> 本需求暂不实施。下方「决策记录」保存了评审结论与取舍，供下次回溯；原始需求正文保留在其后，未做修改。

## 决策记录

### 结论

暂不做内置交互式终端，也暂不做「调用外部终端打开」。需要时再从本记录重新评估。

### 为什么不做内置终端

- 终端能力难以超过 Xshell 等成熟工具（会话管理、分屏、广播输入、ZMODEM、编码切换、宏、跳板机、keyboard-interactive/OTP 登录），属于重复造轮子。
- 成本较高：需新增 xterm.js 依赖、主进程常驻 Shell 服务、独立工作区页面和审计存储，后续维护负担大。
- 本工具真正独有的价值只是「从主机列表一键进入并复用已保存凭据」，这一点不需要自建终端。

### 评审中发现的问题（若重启内置终端方案，需先解决）

与现有代码冲突：
1. 菜单快捷键会抢占终端按键：`main.js` 的 `createMenu()` 注册了 `CmdOrCtrl+R`（重新加载，会销毁全部会话；Ctrl+R 又是 bash 反向搜索）、`CmdOrCtrl+E`（导出 Excel，冲突 Ctrl+E 行尾）、`CmdOrCtrl+I`（冲突 Tab）、Windows `Ctrl+Q`（退出），编辑菜单的 undo/selectall 等，以及 zoomin/zoomout/resetzoom（与需求 12 字号快捷键冲突）。需定义终端焦点下的按键优先级。
2. Windows 下 Ctrl+F 是 bash 光标右移、vim 翻页，搜索应改用 Ctrl+Shift+F；Ctrl+C 应始终发送 SIGINT。
3. `attachContextMenu()` 全局右键菜单与「右键粘贴」冲突。
4. 认证：私钥路径不存在时会静默回落到密码；不支持私钥 passphrase；未启用 keyboard-interactive（`tryKeyboard` 被注释）。
5. 主机模型无 `name` 字段，只有 `hostname`/`system_name`/`app_name`，需定义标签显示规则。
6. `environment` 为自由文本，「生产」判定规则需明确（`getEnvironmentClass()` 为精确匹配）。另：主机表格环境徽章缺少 `badge` 类，`.badge.badge-*` 颜色可能不生效（现存 bug）。
7. 退出流程：`before-quit` 已用于退出前备份，退出确认和审计写入需接入；macOS 关窗不退出应用、渲染进程重载/崩溃时主进程 Shell 通道的清理均未覆盖；数据库为防抖写入，退出前需确保审计落盘。
8. 数据库是单个 `database.json` 整文件重写，审计日志需保留上限（参考 `ai_request_logs` 保留 200 条）。

遗漏项：
- 安全：无主机指纹校验（代码中无 hostVerifier）；无操作员身份概念，审计只能记录远程登录用户名；缺少审计查看入口；需禁用 OSC 52 等远程写剪贴板的转义序列。
- 可靠性：断线检测时限与 keepalive 参数（`config.js` 中 `ssh.keepAliveInterval: 10000` 未被使用）；会话数上限；大输出的 IPC 流控；GBK 等非 UTF-8 编码。
- 交互：页面隐藏（`display:none`）时 fit 会算出 0 列，不应发送尺寸；重连是否再次生产确认；重连分隔线；会话期间主机被编辑/删除；与现有全局底部状态栏的布局关系。

条款歧义：
- 需求 14.3：多行内容写入 Shell 时每个换行都会执行，「不自动追加回车」只对最后一行成立；需考虑 bracketed paste 与 CRLF→LF；插入生产会话是否走现有脚本风险拦截。
- 需求 7.4：仅含结尾换行是否算多行。
- 需求 16.4：展示字段本无密码/私钥，且私钥只存路径，建议改为显示认证方式。
- 需求 15.2：导出受回滚缓冲上限限制，不含备用屏幕（vim 等）内容。
- 需求 17.2：断开原因应给出枚举；需求 12.4：字号建议用独立配置键（`ui.fontSize` 已用于界面）；需求 11：时长超过 99 小时的显示格式。

### 备选方案：调用外部终端（同样暂缓）

思路：主机行增加「用外部终端打开」按钮，调起本机工具，工作量约一个按钮加一个设置项，无新依赖、无审计与资源泄漏负担。

| 方案 | 优点 | 限制 |
|------|------|------|
| Xshell | 用户常用、能力强 | 商业软件，不能随应用分发；命令行参数（如 `-url ssh://user@host:port`）及密码传递方式需按版本核实 |
| PuTTY | MIT 协议，可随安装包打包，适合内网离线；支持老旧算法；首次连接有指纹确认 | 仅认 `.ppk` 私钥，而本工具存的是 OpenSSH 私钥路径，Windows 版 puttygen 无命令行转换；`-pw` 会在进程列表暴露明文，需改用 `-pwfile`（版本需核实）并及时删除临时文件；macOS 无原生版本 |
| macOS 系统终端 / iTerm | 系统自带 | `ssh -p 端口 [-i 私钥] 用户@IP`，私钥主机免输入，密码主机需用户手动输入一次 |

若重启，建议形态：设置中提供「外部终端」选项。Windows 默认用打包的 PuTTY，可改为任意 exe 路径加参数模板（Xshell、MobaXterm 等）；macOS 默认系统终端执行 `ssh`。私钥格式转换先不做，按反馈再定。

### 重新评估的触发条件

- 多名用户反馈「从主机列表跳转到终端」操作繁琐；
- 或出现必须在本工具内完成的终端场景（如与脚本库、审计强绑定的合规要求）。

---

## Introduction

在主机管理页面的主机列表行操作中新增「远程连接」按钮，点击后跳转到新增的独立「远程终端」工作区（侧边栏导航项 `data-page="terminal"`，页面容器 `page-terminal`），并为该主机打开一个新的交互式 SSH 终端会话标签页。

远程终端工作区布局：顶部为会话标签栏（显示主机名/IP 与环境颜色标记），中部为占满剩余空间的终端区域，底部为状态栏（连接状态、用户名、会话时长），右侧可展开主机基本信息侧栏。切换侧边栏其他页面时，已建立的会话保持连接。

功能范围为「基础版 + 实用增强」：
- 基础版：真实交互式 PTY（支持 vim/top、Tab 补全、命令历史）、终端尺寸自适应、选中即复制与右键粘贴、多标签会话、断线提示与一键重连、字号调整、关闭活动会话前确认。
- 实用增强：终端内搜索（Ctrl/Cmd+F）、从脚本库插入命令、导出当前会话输出为文本文件、主机基本信息侧栏。
- 不在本次范围：SFTP 文件浏览、多会话广播输入、分屏。

安全与审计：连接「生产」环境主机前弹出确认框，生产会话的标签与终端边框显示醒目的红色「生产」标识；仅记录连接事件（连接/断开时间、主机、用户名、时长、断开原因），不持久化终端内容。

## Glossary

- **Host_List**: 主机管理页面中的主机列表表格，由 `src/renderer/js/app.js` 的 `renderHostsTable()` 渲染，每行包含行操作按钮。
- **Remote_Connect_Button**: Host_List 每行中新增的「远程连接」操作按钮，使用终端图标，区别于现有「连接测试」（插头图标）按钮。
- **Terminal_Workspace**: 新增的「远程终端」页面（`data-page="terminal"`，容器 `page-terminal`），承载全部终端会话。
- **Sidebar_Nav**: 应用左侧导航栏，由 `src/renderer/index.html` 与 `src/renderer/js/navigation.js` 定义。
- **Terminal_Session**: 针对单台主机建立的一个交互式 SSH Shell 会话，包含一个 PTY 通道及其对应的标签页与终端视图。
- **Active_Session**: 处于「已连接」状态的 Terminal_Session。
- **Session_Tab_Bar**: Terminal_Workspace 顶部的会话标签栏，每个 Terminal_Session 对应一个标签。
- **Session_Tab**: Session_Tab_Bar 中的单个标签，显示主机名（无主机名时显示 IP）和环境颜色标记。
- **Terminal_View**: Terminal_Workspace 中部渲染终端输出并接收键盘输入的区域，使用本地打包的 xterm.js 及 fit、search 插件实现。
- **Status_Bar**: Terminal_Workspace 底部的状态栏，显示当前 Terminal_Session 的连接状态、用户名和会话时长。
- **Host_Info_Panel**: Terminal_Workspace 中可展开/收起的侧栏，显示当前 Terminal_Session 对应主机的基本信息。
- **Script_Picker**: Terminal_Workspace 中用于从脚本库（`scriptService.js`）检索并选择脚本内容插入终端的面板。
- **Terminal_Service**: 主进程中负责建立、维护、调整尺寸和关闭交互式 SSH Shell 通道的服务，复用 `sshService.js` 的认证方式与兼容性算法配置。
- **Connection_Audit_Log**: 持久化在本地数据库中的连接事件记录集合，每条记录对应一个 Terminal_Session 的一次连接周期。
- **Production_Host**: `environment` 字段值为「生产」的主机。
- **Session_Output_Buffer**: Terminal_View 当前保留的输出内容（包含回滚缓冲区），仅存在于内存中。
- **Session_Duration**: 从 Terminal_Session 连接成功时刻到当前时刻（或断开时刻）的时长，格式为 `HH:MM:SS`。

## Requirements

### Requirement 1: 主机列表远程连接入口

**User Story:** 作为运维人员，我希望在主机列表的行操作中直接点击「远程连接」，以便快速打开该主机的终端。

#### Acceptance Criteria

1. THE Host_List SHALL 在每一行的行操作区域显示一个 Remote_Connect_Button，该按钮使用终端图标并带有「远程连接」提示文本。
2. THE Host_List SHALL 将 Remote_Connect_Button 与现有「连接测试」按钮作为两个独立按钮同时显示。
3. WHEN 用户点击某行的 Remote_Connect_Button, THE Sidebar_Nav SHALL 切换到 Terminal_Workspace 并将「远程终端」导航项标记为选中状态。
4. WHEN 用户点击某行的 Remote_Connect_Button, THE Terminal_Workspace SHALL 为该行对应的主机新建一个 Terminal_Session 并激活其 Session_Tab。
5. WHEN 用户对已存在 Terminal_Session 的同一主机再次点击 Remote_Connect_Button, THE Terminal_Workspace SHALL 新建一个额外的 Terminal_Session 而保留原有 Terminal_Session。

### Requirement 2: 远程终端工作区布局与导航

**User Story:** 作为运维人员，我希望有一个独立的远程终端工作区，以便集中管理多个终端会话且切换页面时不丢失会话。

#### Acceptance Criteria

1. THE Sidebar_Nav SHALL 包含一个名为「远程终端」的导航项，对应页面标识 `terminal`。
2. THE Terminal_Workspace SHALL 自上而下依次显示 Session_Tab_Bar、Terminal_View 和 Status_Bar。
3. THE Terminal_View SHALL 占满 Terminal_Workspace 中 Session_Tab_Bar 与 Status_Bar 之间的剩余区域，并使用深色背景和本地打包的 JetBrains Mono 字体渲染。
4. WHILE Terminal_Workspace 中不存在任何 Terminal_Session, THE Terminal_Workspace SHALL 显示空状态提示，引导用户从主机管理页面发起远程连接。
5. WHEN 用户通过 Sidebar_Nav 切换到其他页面, THE Terminal_Service SHALL 保持所有 Active_Session 的连接状态。
6. WHEN 用户从其他页面切换回 Terminal_Workspace, THE Terminal_View SHALL 显示切换前当前 Terminal_Session 的全部 Session_Output_Buffer 内容，以及离开期间收到的远程输出。

### Requirement 3: 会话建立

**User Story:** 作为运维人员，我希望系统使用主机已保存的凭据自动建立交互式会话，以便无需重复输入认证信息。

#### Acceptance Criteria

1. WHEN 新建 Terminal_Session, THE Terminal_Service SHALL 使用该主机已保存的 IP、端口（缺省为 22）、用户名，以及私钥路径或密码建立 SSH 连接。
2. WHEN 新建 Terminal_Session, THE Terminal_Service SHALL 使用与 `sshService.js` 相同的兼容性算法配置建立 SSH 连接。
3. WHEN SSH 连接建立成功, THE Terminal_Service SHALL 以终端类型 `xterm-256color` 和 Terminal_View 当前的列数、行数打开交互式 Shell 通道。
4. WHILE Terminal_Session 正在建立连接, THE Session_Tab SHALL 显示「连接中」状态指示。
5. IF SSH 连接在 15 秒内未完成认证, THEN THE Terminal_Service SHALL 终止该连接尝试并向 Terminal_Workspace 报告超时错误。
6. IF SSH 连接失败（认证失败、网络不可达、超时或私钥文件不可读）, THEN THE Terminal_View SHALL 显示包含失败原因的错误信息和「重新连接」按钮。

### Requirement 4: 生产环境安全确认与标识

**User Story:** 作为运维人员，我希望连接生产主机前得到确认提示，并在终端中醒目标识生产会话，以便避免误操作生产环境。

#### Acceptance Criteria

1. WHEN 用户对 Production_Host 点击 Remote_Connect_Button, THE Terminal_Workspace SHALL 在发起 SSH 连接前显示确认对话框，对话框内容包含主机名、IP 和「生产环境」警示文字。
2. WHEN 用户在生产确认对话框中选择取消, THE Terminal_Workspace SHALL 放弃本次连接且不新建 Terminal_Session。
3. WHEN 用户在生产确认对话框中选择确认, THE Terminal_Workspace SHALL 按 Requirement 3 新建 Terminal_Session。
4. WHILE Terminal_Session 对应 Production_Host, THE Session_Tab SHALL 显示红色「生产」文字标记，颜色取自设计系统的 `status-critical` 系列令牌。
5. WHILE 当前激活的 Terminal_Session 对应 Production_Host, THE Terminal_View SHALL 显示红色边框，颜色取自设计系统的 `status-critical` 系列令牌。
6. THE Session_Tab SHALL 为非生产环境主机显示与该主机 `environment` 字段对应的环境颜色标记。

### Requirement 5: 交互式终端

**User Story:** 作为运维人员，我希望终端支持完整的交互式操作，以便像使用本地终端一样运行 vim、top 等程序。

#### Acceptance Criteria

1. WHEN 用户在获得焦点的 Terminal_View 中输入按键（包括控制键组合、方向键、Tab 键）, THE Terminal_View SHALL 将对应的字节序列发送到当前 Terminal_Session 的 Shell 通道。
2. WHEN Shell 通道产生输出数据, THE Terminal_View SHALL 按 xterm-256color 转义序列渲染该输出，包括颜色、光标移动和全屏应用程序界面。
3. THE Terminal_View SHALL 支持远程 Shell 的 Tab 补全和上下方向键命令历史操作。
4. THE Terminal_View SHALL 保留每个 Terminal_Session 至少 5000 行的回滚缓冲区。

### Requirement 6: 终端尺寸自适应

**User Story:** 作为运维人员，我希望终端尺寸随窗口变化自动调整，以便全屏程序显示正确。

#### Acceptance Criteria

1. WHEN 应用窗口尺寸、Host_Info_Panel 展开状态或终端字号发生变化, THE Terminal_View SHALL 重新计算列数和行数以填满可用区域。
2. WHEN Terminal_View 的列数或行数发生变化, THE Terminal_Service SHALL 在 300 毫秒内向远程 Shell 通道发送新的窗口尺寸。
3. WHEN 用户切换到另一个 Session_Tab, THE Terminal_View SHALL 按当前可用区域重新计算该 Terminal_Session 的列数和行数并同步到远程 Shell 通道。

### Requirement 7: 复制与粘贴

**User Story:** 作为运维人员，我希望选中文本即可复制、右键即可粘贴，以便快速在终端与其他程序之间传递文本。

#### Acceptance Criteria

1. WHEN 用户在 Terminal_View 中完成一次鼠标文本选择, THE Terminal_View SHALL 将选中文本写入系统剪贴板。
2. WHEN 用户在 Terminal_View 中点击鼠标右键, THE Terminal_View SHALL 将系统剪贴板中的文本发送到当前 Active_Session 的 Shell 通道。
3. WHEN 用户在 Terminal_View 中按下 Ctrl+Shift+V（macOS 为 Cmd+V）, THE Terminal_View SHALL 将系统剪贴板中的文本发送到当前 Active_Session 的 Shell 通道。
4. IF 待粘贴文本包含换行符, THEN THE Terminal_View SHALL 在发送前显示包含待粘贴内容预览的确认对话框，并仅在用户确认后发送。

### Requirement 8: 多标签会话管理

**User Story:** 作为运维人员，我希望以标签页形式同时保持多个主机会话，以便在多台主机间快速切换。

#### Acceptance Criteria

1. THE Session_Tab_Bar SHALL 为每个 Terminal_Session 显示一个 Session_Tab，Session_Tab 内容包含主机名（无主机名时显示 IP）、环境颜色标记、连接状态指示和关闭按钮。
2. WHEN 用户点击某个 Session_Tab, THE Terminal_Workspace SHALL 将该 Terminal_Session 设为当前会话，在 Terminal_View 中显示其输出，并使 Terminal_View 获得键盘焦点。
3. WHEN 用户点击某个 Session_Tab, THE Status_Bar SHALL 显示该 Terminal_Session 的连接状态、用户名和 Session_Duration。
4. WHILE Session_Tab 的总宽度超过 Session_Tab_Bar 的可见宽度, THE Session_Tab_Bar SHALL 支持横向滚动以访问全部 Session_Tab。
5. WHEN 当前 Terminal_Session 被关闭且仍存在其他 Terminal_Session, THE Terminal_Workspace SHALL 激活与被关闭标签相邻的 Session_Tab。

### Requirement 9: 关闭会话确认

**User Story:** 作为运维人员，我希望关闭仍在连接中的会话前得到确认，以便避免误关闭正在操作的终端。

#### Acceptance Criteria

1. WHEN 用户点击 Active_Session 对应 Session_Tab 的关闭按钮, THE Terminal_Workspace SHALL 显示关闭确认对话框。
2. WHEN 用户在关闭确认对话框中选择确认, THE Terminal_Service SHALL 关闭该 Terminal_Session 的 Shell 通道和 SSH 连接。
3. WHEN 用户在关闭确认对话框中选择确认, THE Terminal_Workspace SHALL 移除对应的 Session_Tab。
4. WHEN 用户在关闭确认对话框中选择取消, THE Terminal_Workspace SHALL 保留该 Session_Tab 及其 Active_Session 连接。
5. WHEN 用户点击非 Active_Session（已断开或连接失败）对应 Session_Tab 的关闭按钮, THE Terminal_Workspace SHALL 直接移除该 Session_Tab。
6. WHEN 用户关闭应用窗口且存在 Active_Session, THE Terminal_Workspace SHALL 显示包含 Active_Session 数量的退出确认对话框。

### Requirement 10: 断线提示与一键重连

**User Story:** 作为运维人员，我希望会话断开时得到明确提示并能一键重连，以便在网络波动后快速恢复工作。

#### Acceptance Criteria

1. IF Active_Session 的 Shell 通道或 SSH 连接意外断开, THEN THE Terminal_View SHALL 在该会话输出末尾显示包含断开原因的断线提示和「重新连接」按钮。
2. IF Active_Session 的 Shell 通道或 SSH 连接意外断开, THEN THE Session_Tab SHALL 将状态指示更新为「已断开」。
3. WHEN 远程 Shell 正常退出（用户执行 exit）, THE Terminal_View SHALL 显示「会话已结束」提示和「重新连接」按钮。
4. WHEN 用户点击「重新连接」按钮, THE Terminal_Service SHALL 在同一 Session_Tab 中使用相同主机凭据重新建立 Terminal_Session，并保留该标签已有的 Session_Output_Buffer 内容。
5. WHEN 重新连接成功, THE Status_Bar SHALL 从 00:00:00 重新开始计算 Session_Duration。

### Requirement 11: 状态栏

**User Story:** 作为运维人员，我希望在底部状态栏看到当前会话的关键状态，以便了解连接情况。

#### Acceptance Criteria

1. THE Status_Bar SHALL 显示当前 Terminal_Session 的连接状态（连接中、已连接、已断开、连接失败）、登录用户名、主机 IP:端口和 Session_Duration。
2. WHILE 当前 Terminal_Session 为 Active_Session, THE Status_Bar SHALL 每 1 秒更新一次 Session_Duration。
3. WHILE 当前 Terminal_Session 处于已断开状态, THE Status_Bar SHALL 显示该会话断开时刻的 Session_Duration 并停止更新。

### Requirement 12: 字号调整

**User Story:** 作为运维人员，我希望调整终端字号，以便在不同显示器上获得合适的阅读体验。

#### Acceptance Criteria

1. WHEN 用户按下 Ctrl/Cmd+加号键或点击字号增大按钮, THE Terminal_View SHALL 将字号增大 1 像素，上限为 32 像素。
2. WHEN 用户按下 Ctrl/Cmd+减号键或点击字号减小按钮, THE Terminal_View SHALL 将字号减小 1 像素，下限为 10 像素。
3. WHEN 用户按下 Ctrl/Cmd+0 键, THE Terminal_View SHALL 将字号恢复为默认值 14 像素。
4. WHEN 终端字号发生变化, THE Terminal_View SHALL 将新字号应用到所有 Terminal_Session，并保存该字号以便下次启动应用时恢复。

### Requirement 13: 终端内搜索

**User Story:** 作为运维人员，我希望在终端输出中搜索关键字，以便快速定位日志或命令结果。

#### Acceptance Criteria

1. WHEN 用户在获得焦点的 Terminal_View 中按下 Ctrl+F（macOS 为 Cmd+F）, THE Terminal_View SHALL 显示搜索框并使搜索框获得焦点。
2. WHEN 用户在搜索框中输入关键字, THE Terminal_View SHALL 在当前 Terminal_Session 的 Session_Output_Buffer 中高亮第一个匹配项。
3. WHEN 用户在搜索框中按下 Enter 或点击「下一个」, THE Terminal_View SHALL 高亮并滚动到下一个匹配项。
4. WHEN 用户在搜索框中按下 Shift+Enter 或点击「上一个」, THE Terminal_View SHALL 高亮并滚动到上一个匹配项。
5. THE Terminal_View SHALL 在搜索框中提供区分大小写和正则表达式两个搜索选项。
6. IF 关键字在 Session_Output_Buffer 中无匹配项, THEN THE Terminal_View SHALL 在搜索框中显示「无匹配」提示。
7. WHEN 用户在搜索框中按下 Esc 键, THE Terminal_View SHALL 关闭搜索框、清除高亮并使终端重新获得键盘焦点。

### Requirement 14: 从脚本库插入命令

**User Story:** 作为运维人员，我希望从已有脚本库中选择命令插入终端，以便复用常用命令而无需手工输入。

#### Acceptance Criteria

1. WHEN 用户点击 Terminal_Workspace 工具栏中的「插入脚本」按钮, THE Script_Picker SHALL 显示脚本库中的脚本列表，并提供按脚本名称和内容的关键字搜索。
2. WHEN 用户在 Script_Picker 中选择一个脚本, THE Script_Picker SHALL 显示该脚本内容的预览。
3. WHEN 用户在 Script_Picker 中确认插入, THE Terminal_View SHALL 将脚本内容作为输入文本写入当前 Active_Session 的 Shell 通道，且不自动追加回车。
4. IF 待插入的脚本内容包含多行, THEN THE Script_Picker SHALL 在插入前显示多行内容提示，并仅在用户确认后插入。
5. WHILE 当前 Terminal_Session 不是 Active_Session, THE Terminal_Workspace SHALL 将「插入脚本」按钮显示为禁用状态。

### Requirement 15: 导出会话输出

**User Story:** 作为运维人员，我希望将当前会话输出导出为文本文件，以便留存操作记录或分享排查结果。

#### Acceptance Criteria

1. WHEN 用户点击 Terminal_Workspace 工具栏中的「导出输出」按钮, THE Terminal_Workspace SHALL 打开系统保存文件对话框，默认文件名格式为 `{主机名或IP}_{YYYYMMDD_HHmmss}.txt`。
2. WHEN 用户在保存文件对话框中确认保存路径, THE Terminal_Workspace SHALL 将当前 Terminal_Session 的 Session_Output_Buffer 以去除 ANSI 转义序列的 UTF-8 纯文本写入该文件。
3. WHEN 导出文件写入成功, THE Terminal_Workspace SHALL 显示包含文件路径的成功提示。
4. IF 导出文件写入失败, THEN THE Terminal_Workspace SHALL 显示包含失败原因的错误提示。

### Requirement 16: 主机信息侧栏

**User Story:** 作为运维人员，我希望在终端旁查看当前主机的基本信息，以便确认自己操作的是哪台主机。

#### Acceptance Criteria

1. WHEN 用户点击 Terminal_Workspace 工具栏中的「主机信息」按钮, THE Host_Info_Panel SHALL 在展开与收起两种状态之间切换。
2. WHILE Host_Info_Panel 处于展开状态, THE Host_Info_Panel SHALL 显示当前 Terminal_Session 对应主机的主机名、IP、端口、用户名、系统名称、应用名称、环境、数据中心、负责人、操作系统类型及版本。
3. WHEN 用户切换 Session_Tab, THE Host_Info_Panel SHALL 显示新的当前 Terminal_Session 对应主机的信息。
4. THE Host_Info_Panel SHALL 以掩码形式处理主机密码和私钥内容，不显示其明文。
5. IF 某个主机信息字段为空, THEN THE Host_Info_Panel SHALL 在该字段位置显示「-」。

### Requirement 17: 连接事件审计

**User Story:** 作为运维负责人，我希望系统记录每次远程终端的连接事件，以便事后追溯谁在何时连接了哪台主机。

#### Acceptance Criteria

1. WHEN Terminal_Session 连接成功, THE Connection_Audit_Log SHALL 新增一条记录，包含主机标识、主机名、IP、端口、登录用户名、环境和连接时间。
2. WHEN Terminal_Session 断开（用户关闭、远程退出、意外断开或应用退出）, THE Connection_Audit_Log SHALL 在对应记录中写入断开时间、Session_Duration（秒）和断开原因。
3. IF Terminal_Session 连接失败, THEN THE Connection_Audit_Log SHALL 新增一条记录，包含主机标识、主机名、IP、端口、登录用户名、尝试时间和失败原因。
4. THE Connection_Audit_Log SHALL 仅保存连接事件元数据，不保存任何终端输入或输出内容。
5. THE Connection_Audit_Log SHALL 将记录持久化到本地数据库的独立集合中，应用重启后记录仍可读取。

### Requirement 18: 会话资源管理

**User Story:** 作为运维人员，我希望终端会话关闭后相关资源被彻底释放，以便长时间使用应用时不会出现连接残留或内存泄漏。

#### Acceptance Criteria

1. WHEN Terminal_Session 被关闭或断开, THE Terminal_Service SHALL 关闭该会话的 Shell 通道并释放对应 SSH 连接。
2. WHEN Terminal_Session 被关闭, THE Terminal_Workspace SHALL 移除该会话注册的所有 IPC 事件监听器并销毁对应的终端实例。
3. WHEN 应用退出, THE Terminal_Service SHALL 关闭全部 Terminal_Session 的 Shell 通道和 SSH 连接，并为每个会话写入 Connection_Audit_Log 断开记录。
4. THE Terminal_Service SHALL 仅将 Shell 输出数据发送到发起该 Terminal_Session 的渲染窗口，并按会话标识区分不同 Terminal_Session 的数据。

### Requirement 19: 离线依赖

**User Story:** 作为在内网环境使用本工具的运维人员，我希望终端功能无需访问互联网即可工作，以便在隔离网络中正常使用。

#### Acceptance Criteria

1. THE Terminal_View SHALL 从应用本地目录 `src/renderer/lib/` 加载 xterm.js 核心库及其 fit、search 插件与样式文件。
2. THE Terminal_Workspace SHALL 在无互联网连接的环境中完成全部终端功能的加载与运行。
