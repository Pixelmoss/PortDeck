import SwiftUI

@main
struct PortDeckNativeApp: App {
    private let model = AppModel()
    var body: some Scene {
        WindowGroup("PortDeck") { DashboardView().environmentObject(model) }
        MenuBarExtra("PortDeck", systemImage: model.summary.unhealthy > 0 ? "exclamationmark.triangle.fill" : "server.rack") {
            MenuBarView().environmentObject(model)
        }
        Settings { NativeSettingsView().environmentObject(model) }
    }
}
