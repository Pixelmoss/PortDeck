# PortDeck 1.0 macOS 发布流程

PortDeck 的构建配置支持 Developer ID 签名、Hardened Runtime 和 Apple 公证。不要把证书、密码、API Key 或公证凭据提交到仓库。

## 本机准备

1. 在 Apple Developer 网站创建并安装 `Developer ID Application` 证书。
2. 使用以下命令确认钥匙串能找到有效证书：

   ```bash
   security find-identity -v -p codesigning
   ```

3. 配置 electron-builder 支持的任意一套公证凭据：

   - App Store Connect API Key：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
   - Apple ID：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
   - Keychain Profile：`APPLE_KEYCHAIN`、`APPLE_KEYCHAIN_PROFILE`

## 构建和验证

```bash
npm ci
npm test
npm run desktop:build:universal
npm run desktop:verify -- release/mac-universal/PortDeck.app
```

`desktop:verify` 会依次验证：

- 应用版本必须是 `1.0.0`
- Developer ID Application 签名有效
- Gatekeeper 接受应用
- 公证票据已 Staple 到应用包

没有签名凭据时，electron-builder 会明确跳过签名和公证；这种产物只能用于本机内部测试，不能作为正式 1.0 发布包。

## GitHub Actions Secrets

仓库的 `Release macOS` 工作流使用以下 Secrets：

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

推送 `v1.0.0` 标签后，工作流会测试并分别构建 ARM64 和 x64 安装包，签名、公证成功后创建 GitHub Release。请在推送标签前确认所有 Secrets 已配置。
