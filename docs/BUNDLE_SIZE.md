# PortDeck bundle-size policy

PortDeck tracks the compressed DMG and ZIP artifacts separately for ARM64, x64 and universal builds. Size checks use MiB (`1 MiB = 1,048,576 bytes`) so local and CI results are comparable.

## 1.5 baseline

The unsigned Apple Silicon 1.5 build was measured before optimization:

| Item | Size |
|---|---:|
| ARM64 DMG | 122,886,609 bytes / 117.2 MiB |
| ARM64 ZIP | 121,981,483 bytes / 116.3 MiB |
| Packaged `app.asar` | 3,458,682 bytes / 3.3 MiB |
| Electron locale resources | 49,556,569 bytes / 47.3 MiB |
| Electron locale directories | 220 |

The application code is already small. Most remaining size belongs to the Electron/Chromium runtime, so aggressive runtime-file deletion is not allowed without launch, health-check, process, log, tray and update regression testing.

## 2.0 policy

- Keep only Electron's `en` and `zh_CN` locale resources.
- Package with maximum archive compression.
- Exclude source maps, Markdown documents and test directories.
- Build the architecture-specific ARM64 artifact as the default Apple Silicon download.
- Fail CI when an artifact exceeds its budget.

| Architecture | DMG budget | ZIP budget |
|---|---:|---:|
| ARM64 | 100 MiB | 110 MiB |
| x64 | 105 MiB | 115 MiB |
| universal | 165 MiB | 180 MiB |

## 2.0 measured result

The final unsigned Apple Silicon QA build produced these results:

| Item | 1.5 baseline | 2.0 result | Change |
|---|---:|---:|---:|
| ARM64 DMG | 122,886,609 bytes | 101,674,099 bytes / 97.0 MiB | -17.3% |
| ARM64 ZIP | 121,981,483 bytes | 109,550,928 bytes / 104.5 MiB | -10.2% |
| Packaged `app.asar` | 3,458,682 bytes | 2,449,175 bytes / 2.3 MiB | -29.2% |
| Electron locale resources | 49,556,569 bytes | 1,141,364 bytes / 1.1 MiB | -97.7% |
| Electron locale directories | 220 | 2 | -99.1% |

The ZIP remains larger than the DMG because it is also the update payload and uses a format suitable for Electron's update metadata. The budget intentionally avoids deleting Chromium GPU, media or crash-handling libraries without upstream support.

Run the check after building:

```bash
npm run desktop:build:arm64
npm run size:check -- --arch=arm64
```

`PORTDECK_SIZE_BUDGET_MIB` can temporarily override a budget during investigation, but a permanent increase must be reviewed and documented here.

## Native target

Electron trimming is an incremental improvement, not the final size strategy. A material reduction below the Electron runtime floor requires moving service discovery, health checks, process management, logs, configuration and system integration to native Swift implementations, then removing Electron and the bundled Node runtime.
