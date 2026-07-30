# PortDeck

PortDeck 是一个本地优先的开发服务控制台。它自动发现 macOS 上正在监听的 TCP 服务，并允许你把临时发现的进程转为可持久管理、可一键启动和停止的服务。

当前版本是可运行的 `0.2.0` Electron 桌面版本。扫描、状态模型、进程管理和 UI 主流程可以独立在浏览器中运行，也可以内嵌到 PortDeck macOS 应用中。

## 下载

Apple Silicon Mac 可从 [PortDeck 0.2.0 Release](https://github.com/Pixelmoss/PortDeck/releases/tag/v0.2.0) 下载 `.dmg` 安装包或 `.zip` 压缩包。

> 当前安装包尚未进行 Developer ID 签名和 Apple 公证，仅用于本机开发与内部测试。

## 已实现

- 自动扫描 macOS 本机 TCP 监听端口
- 获取 PID、进程命令、运行时间和工作目录
- 初步识别 Node.js、Next.js、Vite、Python、FastAPI、Docker、数据库等类型
- 区分“自动发现”“受管”“离线”和“端口冲突”状态
- 将发现的服务纳入管理并持久化启动/停止命令
- 一键启动、停止和重启受管服务
- 停止外部启动的发现服务
- 查看由 PortDeck 启动的服务日志
- 名称、端口、命令搜索以及状态筛选
- 控制台只监听 `127.0.0.1`，并限制 API Origin
- Electron 原生窗口和 macOS 菜单栏入口
- 单实例运行，关闭窗口后继续驻留菜单栏
- 登录时自动启动开关
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

构建产物位于 `release/`。0.2 版本用于本机开发和内部测试；面向其他用户分发前仍需配置 Developer ID 签名、公证和正式应用图标。

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
    ├── Catalog：合并发现态与受管态
    ├── Registry：JSON 原子持久化
    └── Process Manager：启动、信号停止、日志
```

Electron 主进程直接嵌入同一个 Node 本地服务模块。后续 SwiftUI 版本将继续沿用稳定后的服务配置格式和状态模型。

## 下一阶段建议

1. HTTP/HTTPS 健康检查与网页标题、favicon 探测
2. 从 `package.json`、`.env`、Compose 文件推断更可靠的启动命令
3. 服务事件历史和系统通知
4. Docker 容器名称、镜像和 Compose 项目关联
5. SQLite 持久化与日志流式传输
6. SwiftUI 菜单栏客户端与开机自启

> 安全提醒：受管服务的启动与停止命令会以当前用户权限执行。只保存你信任的命令，不要把控制台暴露到局域网。
