# PortDeck Native shell

This SwiftUI shell consumes PortDeck's versioned local capability API. It includes the main service list, detail and log views, menu-bar controls, native notifications, risk confirmation and login launch.

Run the capability server first:

```sh
npm start
```

Then run the native shell:

```sh
npm run native:build
swift run --package-path native/PortDeckNative
```

Create a launchable development app bundle:

```sh
npm run native:pack
open release/PortDeckNative.app
```

The generated bundle is an unsigned transition build for local QA. A public or App Store native build still requires an Xcode signing target, entitlements, sandbox validation, and notarization/App Store submission settings.

Set `PORTDECK_URL` when the capability server uses a fallback port. The Electron shell remains the production host until the Node capability runtime is bundled independently or replaced capability-by-capability with native implementations.
