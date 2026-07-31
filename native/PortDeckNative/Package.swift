// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PortDeckNative",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "PortDeckNative", targets: ["PortDeckNative"])],
    targets: [.executableTarget(name: "PortDeckNative")]
)
