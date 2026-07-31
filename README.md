# PortDeck

PortDeck 是一个本地优先的开发服务控制台。它自动发现 macOS 上正在监听的 TCP 服务，并允许你把临时发现的进程转为可持久管理、可一键启动和停止的服务。

当前源码版本是 `1.0.0` Electron 桌面应用。它把服务发现、HTTP 健康检查、智能项目识别、可靠进程管理、实时日志和 macOS 菜单栏控制整合在一个本地优先的应用中。

## 下载

已公开的稳定测试包仍可从 [PortDeck 0.3.0 Release](https://github.com/Pixelmoss/PortDeck/releases/tag/v0.3.0) 下载。1.0 安装包将在 Developer ID 签名和 Apple 公证通过后发布。

> 本机可生成 1.0 内部测试包；面向其他用户分发前必须完成 Developer ID 签名与 Apple 公证。

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
- SIGTERM 优雅停止，超时后使用 SIGKILL 兜底
- 由 PortDeck 启动的服务异常退出后可选择自动重启
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

签名、公证凭据和 GitHub Release 配置见 [docs/RELEASING.md](docs/RELEASING.md)。

## 配置与日志

浏览器/命令行版本的运行数据默认保存在：

- `data/services.json`：受管服务配置
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
    ├── Registry：JSON 原子持久化
    ├── Process Manager：进程组、优雅停止、自动重启
    └── Log Stream：SSE 实时日志
```

Electron 主进程直接嵌入同一个 Node 本地服务模块。后续 SwiftUI 版本将继续沿用稳定后的服务配置格式和状态模型。

## 1.0 发布前置条件

- 有效的 Apple Developer Program 账号
- `Developer ID Application` 签名证书
- Apple 公证凭据或 App Store Connect API Key
- 在签名后的 `.app` 上通过 `codesign`、Gatekeeper 和 Stapler 验证

> 安全提醒：受管服务的启动与停止命令会以当前用户权限执行。只保存你信任的命令，不要把控制台暴露到局域网。
