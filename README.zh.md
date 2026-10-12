# dsh-windows-mcp-lite

**从 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 到 [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) 的纯配置型桥。**

[English](README.md) | 中文

它挂载 DSH 本体自带的 MCP 客户端桥，用 stdio 指向上游 Windows-MCP 服务器。整个集成就只有 [`cordis.patch.yml`](cordis.patch.yml) 一个文件——约 25 行，没有 JavaScript，装之前你能整屏读完。

```text
DSH agent
  └─ mcp__windows__Snapshot / Click / Type / ...
       └─ @deepseek-ai/dsh-mcp-client        （DSH 自带）
            └─ uvx windows-mcp@0.8.8 serve   （stdio 子进程）
                 └─ 你的桌面：UIA 树 / Win32 输入 / 屏幕采集
```

## 它刻意不做的事

这是设计取舍，不是"功能缺失清单"：

- **没有宿主插件。** 没有 `index.js`，我们没有任何代码跑在你的 harness 进程里。
- **没有 web 路由。** 不新增任何 HTTP 端点，因此不新增未鉴权的攻击面，也不会给你多一个"必须绑回环"的理由。
- **没有状态文件。** 不写 `~/.dsh/...state.json`，不占浏览器存储。
- **没有会改你 profile 的安装器。** `npm run prewarm` 在你自己的终端里装好并验证上游服务器，绝不替你改 profile patch。
- **没有运行时依赖、没有构建步骤。** `dependencies` 为空，不需要编译，也不需要你授予 `allowBuilds`。
- **不含针对某台机器的绝对路径。** 桥从 `PATH` 调 `uvx`；仓库里的测试会在任何机器相关路径漏进发布文件时让构建失败。

如果你要的是应用内依赖安装器、默认关闭的 Computer Use 开关、或 doctor 诊断工具，这个生态里别的插件提供了。这个插件用它们换的是"小到一屏能审完"——对一个要把键盘、鼠标和屏幕交出去的插件来说，这一点比平时更值钱。

## 前置条件

- **Windows 10 / 11。** 上游服务器只支持 Windows。
- **带内置 MCP 客户端桥的 DeepSeek Harness。** 声明范围 `>=0.2.0-rc.1 <0.3.0-0`；作者在 **0.2.0-rc.2**（桌面版）上实测通过。声明的是范围，实测的是那一个版本，两者别混。
- **运行 DSH 的那个进程的 `PATH` 上要有 [uv](https://docs.astral.sh/uv/)。** `uvx` 负责拉起上游服务器并为它建隔离环境。用官方安装脚本装过 uv 的话，这一条已经满足。
- 可选：**支持图片输入的模型**，这样 `Screenshot` 才会以真正的图片进入对话。不支持时桥会把它退化成文本诊断；`Snapshot` 返回纯文本，完全不依赖视觉。

## 安装

应用内：**设置 → 插件 → 添加插件**，填其中一种：

```text
dsh-windows-mcp-lite                                # npm 包名
github:sheilacraig/dsh-windows-mcp-lite             # GitHub 仓库
C:\path\to\a\local\checkout                         # 本地绝对路径
```

CLI 持有的 profile：

```sh
dsh plugin --profile <profile> add dsh-windows-mcp-lite
```

Electron 桌面版的 `desktop` profile 属于应用本身，请走应用的插件面板。

装完**重启 DSH**，让新的补丁层在启动时合成。

## 第一次启动最慢

`uvx` 第一次会为上游服务器建隔离环境，需要下载几十 MB 的 Python 依赖。慢网下这是好几分钟，而桥等初始连接的时间远不到那么久；依赖缓存好之后就很快了。

所以放到 harness 外面做，那里没有超时：

```sh
npm run prewarm
```

脚本会跑 `uvx windows-mcp@0.8.8 serve --exclude-tools ...`——**与桥完全相同的 argv**——对它说 `initialize` + `tools/list`，打印服务器身份、耗时和完整工具清单，然后退出。它拉起的正是桥将要拉起的同一个进程，所以这一步成功就说明 harness 那侧再没有要下载或要发现的东西。环境预热后，作者本机实测 `initialize` 在 2.1 秒内返回。

## 模型能拿到什么

**16 个工具**，名字形如 `mcp__windows__<工具>`。上游 0.8.8 公布 21 个；本插件默认排除 5 个（见「默认最小权限」）。

| 工具 | 作用 |
| --- | --- |
| `Screenshot` | 截屏，附光标位置与窗口列表 |
| `Snapshot` | 完整桌面状态：无障碍树、可交互元素、可滚动区域 |
| `DisplayInventory` | 显示器布局、工作区、DPI |
| `Click`、`Move`、`Scroll` | 鼠标输入，含显式拖拽 |
| `Type`、`Shortcut` | 键盘输入 |
| `Wait`、`WaitFor` | 固定等待，或轮询直到界面条件成立 |
| `MultiSelect`、`MultiEdit` | 批量选中 / 批量输入 |
| `Clipboard` | 读写剪贴板 |
| `Notification` | Windows 通知 |
| `App` | 启动应用、调整或聚焦窗口 |
| `ControlStatus` | 当前谁在控制桌面——上游不提供排除它的方式 |

## 验证

1. 先跑一次 `npm run prewarm`（见上），它同时验证服务器与钉住的版本。
2. 在 DSH 里让 agent 调 `mcp__windows__DisplayInventory`。它只读显示几何，不点不敲。
3. 再调 `mcp__windows__Snapshot` 拿无障碍树文本。

## 默认最小权限

`--exclude-tools PowerShell,Registry,FileSystem,Process,Scrape` —— 上游这 5 个工具默认关闭，因为 DeepSeek Harness 已经有一套受自身审批策略与沙箱约束的 shell、文件、注册表、进程能力。再开一份上游的等价物，等于给同样的能力多开一条完全没有这些控制的路径。

要改这套集合，就在你自己的 profile patch 里覆盖那一行（见下）。去掉 `--exclude-tools` 即恢复全部 21 个工具。

## 配置

所有默认值都在 [`cordis.patch.yml`](cordis.patch.yml)。要改，请在**你自己的 profile**里覆盖那一行——不要改装好的那份：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- id: windows-mcp-lite
  config:
    serverName: windows
    transport: stdio
    command: uvx
    args: [windows-mcp@0.8.8, serve, --exclude-tools, "PowerShell,Registry,FileSystem,Process,Scrape,App"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
    env:
      ANONYMIZED_TELEMETRY: "false"
      WINDOWS_MCP_DISABLE_FLASH: "1"
```

关于这个覆盖，有两点最容易让人踩坑：

- **补丁是整块替换 `config`，不是深合并。** 你漏写的每个键都等于删掉它。`serverName`、`transport` 必填，stdio 形态下 `command` 必填，`streamable-http` 形态下 `url` 必填。
- **`serverName` 决定所有工具名**（`mcp__<serverName>__<工具>`）。改了它等于改掉整套工具名，并且会让 prompt 缓存前缀失效。

**一个 profile 只能有一份 Windows-MCP 桥。** 两行用同一个 `serverName` 会冲突，后加载的那行在加载时失败。启用本插件前，请先停用同一 profile 里其它的 Windows-MCP 插件。

想用预装好的解释器而不是 `uvx`？先 `uv tool install windows-mcp`，然后把 `command` 设为 `windows-mcp`、`args` 设为 `[serve, --exclude-tools, ...]`。想用常驻 HTTP 服务？把 `transport` 换成 `streamable-http` 并给 `url`——注意 HTTP 形态没有 `env`，遥测与闪框的设置就归启动那个服务的方式管了。

## 安全

装上它，等于把你的鼠标、键盘、剪贴板和屏幕交给一个以你自己权限运行的进程里的 agent。请按"交出这个桌面会话"来评估。

- **stdio，不是监听端口。** 桥启动的是管道连接的子进程，不绑任何端口。
- **默认最小权限**，见上。
- **上游遥测默认关闭**（上游默认向 PostHog 匿名上报）；同时关掉了那圈橙色截屏边框。
- **Harness 的文件沙箱管不到它。** MCP 工具调用是普通工具调用，审批策略能拦；沙箱实现在 harness 自己的文件与 shell 工具里，不约束这个子进程。
- **控制权交还是尽力而为，不是边界。** 上游允许真人通过明显移动物理鼠标或按 `Ctrl+Alt+Shift+Backspace` 夺回桌面；它已经启动的外部命令在夺权后仍会继续跑。
- **钉住上游版本。** `windows-mcp@0.8.8` 是固定版本，上游发版不会悄悄改变这座桥的行为。要升级就显式改这一行并重跑 `npm run prewarm`。
- **装之前请读 [`cordis.patch.yml`](cordis.patch.yml)。** 那个文件就是插件本体，其余都是元数据、文档和测试。

## 排障

| 现象 | 原因与处理 |
| --- | --- |
| 工具调用返回 `USER_CONTROL`，或 `ControlStatus` 报 `state: "user"` | 上游把桌面**优先给人**，只有约 10 秒没有物理输入后才交给 agent。此刻控制权在你手里，`wait_seconds` 是它还在等的空闲时长。明显移动鼠标或按 `Ctrl+Alt+Shift+Backspace` 可以主动夺回控制权。`ControlStatus` 在其它调用全被拦下时仍然可用——工具被拒时先调它。 |
| 完全没有 `mcp__windows__*` 工具 | 桥没能拉起服务器。在终端里跑 `npm run prewarm`，它会以同样的原因失败并给出提示。最常见的原因是**运行 DSH 的那个进程**的 `PATH` 上没有 `uvx`：桌面快捷方式或编辑器带的 `PATH` 可能和你装 uv 的那个终端不一样。harness 日志里有 `mcp-client(windows)` 那一行。 |
| 升级后工具全变名字了 | 工具名是 `mcp__<serverName>__<工具>`。改 `serverName`，或者把钉住的上游版本换成一个工具名不同的版本，都会重命名整套工具。 |
| `Screenshot` 返回的是文本 | 当前模型不接受图片输入。改用 `Snapshot`：它抽的是无障碍树，不是像素。 |
| 所有桌面工具一起被拒 | 同一 profile 里有第二行 Windows-MCP 用了相同的 `serverName`，只有先加载的那行生效。停用另一个插件。 |

## 开发

```sh
npm install     # 唯一的 devDependency：js-yaml，只给测试用
npm test        # node --test，校验桥的各项不变量
npm run prewarm # 安装并验证上游服务器
```

`npm test` 会强制检查：有且只有一行 insert 指向 `@deepseek-ai/dsh-mcp-client`；`serverName` 符合工具名命名规则；`args` 里是钉住的 `windows-mcp@x.y.z`；排除清单与文档一致；工具数量与文档一致；以及**任何发布文件里都不允许出现绝对路径或盘符**。

## 卸载

在**设置 → 插件**里移除这个 bundle，或删掉 profile patch 里的那一行。停用 bundle 会连同整行配置一起撤掉。不会留残留：本插件不写任何文件。

## 许可与致谢

MIT —— 见 [LICENSE](LICENSE)。

- 真正干活的桌面自动化全部来自 [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)（MIT），本仓库只负责接线。
- MCP 客户端桥属于 DeepSeek Harness，本仓库不分发它。
- 与 DeepSeek 官方及 Windows-MCP 作者均无隶属关系。
