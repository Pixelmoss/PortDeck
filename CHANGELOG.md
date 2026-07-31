# Changelog

## 2.0.0 - 2026-08-01

### Added

- Instant, persistent Chinese/English switching from Desktop Settings
- Shared desktop localization for the macOS menu bar, application menu, notifications and update prompts
- Automated coverage for both desktop locales and localized tray actions
- Release manifests and SHA-256 checksums generated automatically by the signed release workflow
- Automated DMG and ZIP size reporting with architecture-specific release budgets
- An unsigned Apple Silicon package-size gate in the main CI workflow
- Signed ARM64, x64 and universal package-size gates in the release workflow
- Bundle-size baseline, optimization policy and regression guidance
- An isolated `PORTDECK_USER_DATA_DIR` override for safe packaged-app QA

### Changed

- Dynamic scan, diagnostics and update status text now re-renders immediately after a language change
- Update failures now use concise localized messages without exposing raw response headers
- The Edit, View and Window application menus now follow the selected language
- Keep only the English and Simplified Chinese Electron locale resources
- Use maximum archive compression for distributable packages
- Exclude source maps, Markdown documents and test directories from the packaged application
- Updated the product version from 1.5.0 to 2.0.0

### Size target

- ARM64 artifacts must remain below 100 MiB for DMG and 110 MiB for ZIP
- x64 artifacts must remain below 105/115 MiB and universal artifacts below 165/180 MiB for DMG/ZIP
- Larger reductions remain tied to replacing the Electron runtime with native Swift capabilities

## 1.5.0 - 2026-07-31

### Added

- Workspaces, groups, favorites, tags, manual ordering and bulk service actions
- Node.js, Python, Docker Compose and static-site service templates
- First-run onboarding and command risk previews with explicit acknowledgement
- Persistent audit history with blocked, successful and failed outcomes
- Configuration import/export and registry schema v4 migration
- Health failure/recovery notifications and notification-frequency controls
- Chinese/English interface foundation and opt-in-only local crash diagnostics
- User-confirmed automatic update checks, downloads and installs through signed GitHub Releases
- Versioned local capability API for discovery, health, process, log, storage and desktop capabilities
- SwiftUI transition shell with native list/detail/log views, menu bar, notifications and `SMAppService` login launch
- ARM64, x64 and universal release matrix, production dependency audit, CycloneDX SBOM and release manifest
- Website, privacy policy, support page and distribution-readiness documentation

### Changed

- Updated the product version from 1.1.0 to 1.5.0
- Expanded the automated Node test suite and added a macOS 13-compatible Swift build check
- High-risk tray actions now route users to the main window for confirmation
- Electron remains the full capability host while the SwiftUI shell replaces it capability-by-capability

### External requirements

- Public distribution still requires the product owner's Apple Developer Program membership, Developer ID Application certificate and notarization credentials
- Mac App Store distribution still requires a separate sandbox capability matrix and App Review-ready target

## 1.1.0 - 2026-07-31

### Added

- Stable process identities based on PID, kernel start time, working directory, and command metadata
- Safe refusal when a PID has been reused before an external or recovered process is stopped
- Persistent desired state and recovery of PortDeck-owned detached processes after the desktop app restarts
- Automatic restart restoration when a previously desired service disappeared while PortDeck was offline
- Registry schema v3 with rolling configuration backups, v2 migration, corruption quarantine, and backup recovery
- Manual configuration backup and privacy-conscious diagnostic report export from Desktop Settings
- Bounded copy-truncate log rotation with three retained generations and live-process maintenance checks
- Ownership indicators for PortDeck-owned, recovered, and externally started managed services
- Recent process-operation errors and log policy information in diagnostic reports

### Changed

- Updated the product version from 1.0.0 to 1.1.0
- Expanded the automated test suite from 32 to 41 tests
- Stop and restart operations now verify process identity immediately before signaling when ownership was recovered or external
- Diagnostic reports omit full project paths, commands, notes, and log contents

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
