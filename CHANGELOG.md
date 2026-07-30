# Changelog

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
