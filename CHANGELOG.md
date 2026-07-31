# Changelog

## 1.0.0 - 2026-07-31

### Added

- HTTP/HTTPS health checks with hard timeouts, latency, status code, page title, favicon, and server metadata
- Smart service recognition from process commands, Node package metadata, Python manifests, and Compose files
- Suggested portable start commands for discovered services
- Health summary cards, unhealthy-service filtering, and health indicators in the menu bar
- Per-service operation locking and reliable detached process-group tracking
- Graceful SIGTERM shutdown with timed SIGKILL escalation
- Optional automatic restart after unexpected exits
- Server-Sent Events endpoint and live log drawer
- Version 2 service registry schema with backward-compatible migration
- PortDeck application icon, ASAR packaging, Hardened Runtime entitlements, and release verification script
- APFS staging build wrapper for repositories stored on external volumes
- GitHub Actions workflow for signed and notarized ARM64/x64 releases

### Changed

- Updated the product version from 0.3.0 to 1.0.0
- Expanded the automated test suite from 14 to 32 tests
- Log tail reads now avoid loading an entire log file into memory
- Tray summaries now include unhealthy services

### Release requirement

- A public 1.0 build must be signed with a Developer ID Application certificate and notarized by Apple
- The local build remains an internal test artifact when signing credentials are unavailable

## 0.3.0 - 2026-07-31

### Added

- Menu bar actions for opening, starting, stopping, and restarting services
- Quiet login launch that keeps the main window and Dock icon hidden
- Desktop settings dialog with login-launch status synchronized through Electron IPC
- Native macOS notifications after menu bar service actions
- Unit coverage for startup settings and tray menu generation

### Changed

- Expanded the application menu with a synchronized login-launch toggle
- Updated the product version from 0.2.0 to 0.3.0
- Expanded the automated test suite from 8 to 14 tests

### Known limitations

- The 0.3 test build is unsigned and not notarized
- The public product icon is not yet included
- ASAR remains disabled for builds made from the current external volume

## 0.2.0 - 2026-07-31

### Added

- Electron macOS desktop application shell
- Native macOS window with hidden title bar integration
- Menu bar status item with running-service summary
- Single-instance behavior and background residency after closing the window
- Login-at-startup toggle for packaged builds
- Standard `~/Library/Application Support/PortDeck` data storage
- External-link isolation and context-isolated preload bridge
- Electron Builder packaging for Apple Silicon `.app`, `.zip`, and `.dmg`

### Changed

- Refactored the local HTTP server into an embeddable module shared by CLI and Electron
- Added automatic fallback to a free loopback port when `4399` is occupied
- Updated the product version from 0.1.0 to 0.2.0

### Known limitations

- The 0.2 test build is unsigned and not notarized
- The public product icon is not yet included
- ASAR is disabled for builds made from the current external volume; restore it for signed releases built on APFS
