import AppKit
import Foundation
import ServiceManagement
import UserNotifications

@MainActor
final class AppModel: ObservableObject {
    @Published var services: [PortDeckService] = []
    @Published var summary = ServiceSummary()
    @Published var workspaces: [Workspace] = []
    @Published var preferences = Preferences()
    @Published var selectedService: PortDeckService?
    @Published var logText = ""
    @Published var pendingAction: PendingAction?
    @Published var errorMessage: String?
    @Published var backendAvailable = false
    @Published var capabilities: [String] = []
    @Published var query = ""
    @Published var launchAtLogin = false

    private let client = BackendClient()
    private var healthStates: [String: String] = [:]

    func start() async {
        launchAtLogin = SMAppService.mainApp.status == .enabled
        do {
            capabilities = try await client.capabilities().capabilities
            backendAvailable = true
            await refresh(fresh: true)
        } catch {
            backendAvailable = false
            errorMessage = "Start the PortDeck capability server, then try again. \(error.localizedDescription)"
        }
    }

    func refresh(fresh: Bool = false) async {
        do {
            let payload = try await client.catalog(fresh: fresh)
            notifyTransitions(payload.services)
            services = payload.services
            summary = payload.summary
            workspaces = payload.workspaces ?? []
            preferences = payload.preferences ?? Preferences()
            backendAvailable = true
        } catch {
            backendAvailable = false
            errorMessage = error.localizedDescription
        }
    }

    func prepare(_ service: PortDeckService, action: String) async {
        do {
            let risk = try await client.risk(serviceID: service.id, action: action)
            pendingAction = PendingAction(service: service, action: action, risk: risk)
        } catch { errorMessage = error.localizedDescription }
    }

    func confirmPendingAction() async {
        guard let pendingAction else { return }
        self.pendingAction = nil
        do {
            try await client.action(serviceID: pendingAction.service.id, action: pendingAction.action)
            try? await Task.sleep(for: .milliseconds(500))
            await refresh(fresh: true)
        } catch { errorMessage = error.localizedDescription }
    }

    func open(_ service: PortDeckService) {
        guard let value = service.url, let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }

    func showLogs(_ service: PortDeckService) async {
        selectedService = service
        do { logText = try await client.logs(serviceID: service.id) }
        catch { logText = error.localizedDescription }
    }

    private func notifyTransitions(_ nextServices: [PortDeckService]) {
        guard preferences.notificationsEnabled != false else { return }
        for service in nextServices {
            guard let next = service.health?.status else { continue }
            let previous = healthStates[service.id]
            healthStates[service.id] = next
            guard let previous, previous != next, ["healthy", "unhealthy"].contains(next) else { continue }
            let content = UNMutableNotificationContent()
            content.title = next == "healthy" ? "PortDeck · Service recovered" : "PortDeck · Health check failed"
            content.body = service.name
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "\(service.id)-\(next)", content: content, trigger: nil))
        }
    }
}
