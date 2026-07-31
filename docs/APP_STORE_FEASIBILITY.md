# PortDeck Mac App Store 可行性验证

PortDeck 官网版依赖 `lsof`、`ps`、任意用户命令、进程组信号和外部项目目录。这些能力在 Developer ID 分发中可用，但 Mac App Store 要求 App Sandbox，不能默认认为行为一致。

## 产品策略

- 官网版：保留完整服务发现、任意命令和外部进程控制能力，使用 Developer ID 签名与 Apple 公证。
- App Store 版：共享服务模型、健康检查和 UI，只启用沙箱验证通过的能力。
- 不使用独立下载的未沙箱 Helper 绕过 App Store 限制。

## SwiftUI 壳现状与沙箱验证

1.5 已交付一个不启用 App Sandbox 的 SwiftUI 过渡壳，验证原生列表、详情、菜单栏、设置、日志、通知、登录启动和风险确认，并复用 loopback Capability API。它不是 App Store 构建；下面的沙箱能力仍必须在独立 Xcode target 中实机验证。

| 能力 | 当前实现 | 原型验收条件 | 初始判断 |
|---|---|---|---|
| HTTP/HTTPS 健康检查 | Node Fetch | 访问 loopback 服务并获得状态、延迟和标题 | 预计支持，需要网络 entitlement |
| 发现监听端口 | `lsof` | 沙箱内获得 PID、端口和进程名 | 必须实测 |
| 读取工作目录 | `lsof -d cwd` | 只在用户授权范围内读取路径 | 可能受限 |
| 启动项目命令 | detached shell | 在 security-scoped bookmark 目录启动子进程 | 必须实测 |
| 停止自己的子进程 | 进程组信号 | 安全停止应用启动的进程树 | 必须实测 |
| 停止外部进程 | PID 信号 | 在沙箱内向非子进程发信号 | 高风险，可能不支持 |
| 登录时启动 | Electron login item | 使用 `SMAppService` 静默启动 | 预计支持 |
| 实时日志 | 文件尾读/SSE | 读取应用创建或用户授权目录中的日志 | 预计支持 |

## App Store 原型后续交付物

1. 一个启用 App Sandbox 的最小 SwiftUI 工程。
2. 每项能力的“支持 / 需要用户授权 / 不支持”实机矩阵。
3. 所需 entitlement 与用户授权流程。
4. 官网版和 App Store 版的功能差异清单。
5. TestFlight 构建与 App Review 说明草案。

在矩阵完成前，不移除 Electron 完整能力宿主。1.5 的 schema v4、进程身份模型、诊断格式和 v1 Capability API 将作为后续原生版本的兼容契约。
