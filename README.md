# PortDeck

PortDeck 是一个本地优先的开发服务控制台。它自动发现 macOS 上正在监听的 TCP 服务，并允许你把临时发现的进程转为可持久管理、可一键启动和停止的服务。

当前源码版本是 `1.5.0`。Electron 桌面版仍是完整能力宿主，同时提供一个可编译运行的 SwiftUI 原生壳，通过版本化本地 API 复用服务发现、健康检查、进程管理、日志和配置能力。

## 下载

历史内部测试包可从 [GitHub Releases](https://github.com/Pixelmoss/PortDeck/releases) 下载。1.5 正式包需要在仓库配置 Apple 签名与公证凭据后，由发布流水线生成。

> 没有 Developer ID 签名和 Apple 公证的本机构建仍只适合内部验证。

## 已实现

- 自动扫描 macOS 本机 TCP 监听端口
- 获取 PID、进程命令、运行时间和工作目录
- 初步识别 Node.js、Next.js、Vite、Python、FastAPI、Docker、数据库等类型
- 从 `package.json`、Python 清单、Compose 文件和进程命令推断项目类型与启动命令
- HTTP/HTTPS 健康检查、响应延迟、状态码、网页标题和 favicon 探测
- 健康异常统计与筛选
- 区分“自动发现”“受管”“离线”和“端口冲突”状态
- 将发现的服务纳入管理并持久化启动/停止命令
- 一键启动、停止和重启受管服务，防止同一服务并发执行冲突操作
- 使用 PID、进程启动时间和工作目录校验进程身份，防止 PID 复用导致误停止
- 区分 PortDeck 启动、应用重启后恢复和外部启动的进程所有权
- SIGTERM 优雅停止，超时后使用 SIGKILL 兜底
- 由 PortDeck 启动的服务异常退出后可选择自动重启
- PortDeck 重启后恢复仍在运行的受管进程和期望运行状态
- 停止外部启动的发现服务
- 通过 Server-Sent Events 实时查看由 PortDeck 启动的服务日志
- 名称、端口、命令搜索以及状态筛选
- 控制台只监听 `127.0.0.1`，并限制 API Origin
- Electron 原生窗口和 macOS 菜单栏入口
- 在菜单栏直接打开、启动、停止或重启服务
- 单实例运行，关闭窗口后继续驻留菜单栏
- 登录时静默启动，不弹出主窗口或显示 Dock 图标
- 网页桌面设置与原生应用菜单实时同步
- 服务操作完成后显示 macOS 系统通知
- 正式 PortDeck 应用图标、ASAR 打包和 Hardened Runtime 权限配置
- GitHub Actions 双架构签名、公证与 Release 工作流
- 配置保存在 macOS 标准 Application Support 目录
- schema v4 配置迁移、最近 10 份滚动备份和损坏自动恢复
- 5 MB 日志轮转、三份历史日志和一键导出隐私友好的诊断报告
- 工作区、服务分组、标签、收藏、排序和批量启停
- Node.js、Python、Docker Compose、静态网站服务模板
- 首次使用引导和高风险命令执行前确认
- 最多 500 条操作审计，以及配置合并导入和导出
- 健康异常/恢复通知与通知频率控制
- 中英文界面基础、本地崩溃诊断明确选择开启
- 用户确认式自动更新：自动检查、确认下载、确认安装
- SwiftUI 服务列表、详情、日志、菜单栏、通知和登录启动壳
- ARM64、x64、universal 发布矩阵、SBOM、校验清单和官网/隐私/支持页源码

## 运行

要求 Node.js 20 或更高版本，不需要安装任何 npm 依赖。

```bash
npm start
```

然后打开：

```text
http://127.0.0.1:4399
```

开发模式：

```bash
npm run dev
```

测试：

```bash
npm test
```

## Electron 桌面版

开发运行：

```bash
npm install
npm run desktop:dev
```

生成未签名的本机架构 `.app`：

```bash
npm run desktop:pack
```

生成 `.dmg` 和 `.zip`：

```bash
npm run desktop:build
```

构建产物位于 `release/`。构建脚本会自动使用 APFS 临时目录，避免项目位于外置卷时出现 ASAR 文件偏移错误。

Apple Silicon 内部测试包：

```bash
npm run desktop:build:arm64
```

Universal 正式包：

```bash
npm run desktop:build:universal
npm run desktop:verify -- release/mac-universal/PortDeck.app
```

签名、公证凭据和 GitHub Release 配置见 [docs/RELEASING.md](docs/RELEASING.md)，完整分发清单见 [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)。
Mac App Store 双版本策略和沙箱验证清单见 [docs/APP_STORE_FEASIBILITY.md](docs/APP_STORE_FEASIBILITY.md)。

## SwiftUI 原生壳

先启动本地能力服务器，再运行原生壳：

```bash
npm start
npm run native:build
swift run --package-path native/PortDeckNative
```

生成可直接启动的本地 QA `.app`：

```bash
npm run native:pack
```

原生壳的边界和迁移说明见 [native/PortDeckNative/README.md](native/PortDeckNative/README.md)，本地 API 契约见 [docs/CAPABILITY_API.md](docs/CAPABILITY_API.md)。

## 配置与日志

浏览器/命令行版本的运行数据默认保存在：

- `data/services.json`：受管服务配置
- `data/backups/`：自动与手动配置备份
- `data/logs/<service-id>.log`：由 PortDeck 启动的服务输出

可通过环境变量调整：

- `PORTDECK_PORT`：控制台端口，默认 `4399`
- `PORTDECK_DATA_DIR`：配置和日志目录，默认项目下的 `data/`

Electron 版本使用 macOS 标准目录：

```text
~/Library/Application Support/PortDeck/
```

## 当前架构

```text
浏览器控制台
    │ HTTP / JSON（仅 127.0.0.1）
    ▼
Node 本地守护进程
    ├── Scanner：lsof + ps + cwd
    ├── Recognizer：项目清单 + 进程命令推断
    ├── Inspector：HTTP 状态 + 延迟 + 页面元数据
    ├── Catalog：合并发现态与受管态
    ├── Registry：schema v4、工作区、偏好、审计、原子持久化与恢复
    ├── Process Manager：进程身份、所有权恢复、进程组与自动重启
    └── Log Stream：SSE 实时日志
```

Electron 主进程直接嵌入同一个 Node 本地能力模块。SwiftUI 壳通过仅监听 loopback 的 v1 Capability API 使用同一能力；后续可按能力逐项替换 Node 实现，不需要一次性重写。

## 正式发布前置条件

- 有效的 Apple Developer Program 账号
- `Developer ID Application` 签名证书
- Apple 公证凭据或 App Store Connect API Key
- 在签名后的 `.app` 上通过 `codesign`、Gatekeeper 和 Stapler 验证

> 安全提醒：受管服务的启动与停止命令会以当前用户权限执行。只保存你信任的命令，不要把控制台暴露到局域网。
