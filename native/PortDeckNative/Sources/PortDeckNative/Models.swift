import Foundation

struct ServiceSummary: Codable {
    var total = 0
    var running = 0
    var managed = 0
    var discovered = 0
    var conflicts = 0
    var healthy = 0
    var unhealthy = 0
}

struct ServiceHealth: Codable {
    var status: String?
    var latencyMs: Int?
    var error: String?
    var title: String?
}

struct ServiceRuntime: Codable {
    var operation: String?
    var ownership: String?
    var recovered: Bool?
}

struct PortDeckService: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var kind: String?
    var source: String
    var status: String
    var ownership: String?
    var port: Int?
    var preferredPort: Int?
    var url: String?
    var cwd: String?
    var startCommand: String?
    var stopCommand: String?
    var workspaceId: String?
    var group: String?
    var tags: [String]?
    var favorite: Bool?
    var health: ServiceHealth?
    var runtime: ServiceRuntime?

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct Workspace: Codable, Identifiable, Hashable {
    let id: String
    var name: String
    var color: String?
}

struct Preferences: Codable {
    var locale: String?
    var onboardingComplete: Bool?
    var notificationsEnabled: Bool?
    var notificationFrequency: String?
    var crashReportingEnabled: Bool?
    var sortBy: String?
    var sortDirection: String?
}

struct CatalogResponse: Codable {
    var services: [PortDeckService]
    var summary: ServiceSummary
    var scannedAt: String?
    var preferences: Preferences?
    var workspaces: [Workspace]?
}

struct RiskFinding: Codable, Identifiable {
    var id: String
    var severity: String
    var message: String
}

struct CommandRisk: Codable {
    var action: String
    var command: String
    var severity: String
    var requiresAcknowledgement: Bool
    var findings: [RiskFinding]
}

struct RiskResponse: Codable { var risk: CommandRisk }
struct LogsResponse: Codable { var logs: String }
struct ActionResponse: Codable { var ok: Bool }
struct CapabilitiesResponse: Codable { var version: Int; var capabilities: [String] }

struct APIErrorPayload: Codable { var error: String? }

struct PendingAction: Identifiable {
    let id = UUID()
    let service: PortDeckService
    let action: String
    let risk: CommandRisk
}
