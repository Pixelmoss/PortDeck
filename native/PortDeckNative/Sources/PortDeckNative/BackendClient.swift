import Foundation

struct BackendClient: Sendable {
    let baseURL: URL

    init(baseURL: URL = URL(string: ProcessInfo.processInfo.environment["PORTDECK_URL"] ?? "http://127.0.0.1:4399")!) {
        self.baseURL = baseURL
    }

    func request<T: Decodable>(_ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> T {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        if let body { request.httpBody = try JSONEncoder().encode(AnyEncodable(body)) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data)
            throw PortDeckAPIError(message: payload?.error ?? "PortDeck backend request failed")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func catalog(fresh: Bool = false) async throws -> CatalogResponse {
        try await request(fresh ? "/api/services?fresh=1" : "/api/services")
    }

    func capabilities() async throws -> CapabilitiesResponse { try await request("/api/capabilities") }
    func risk(serviceID: String, action: String) async throws -> CommandRisk {
        let response: RiskResponse = try await request("/api/services/\(serviceID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? serviceID)/risk/\(action)")
        return response.risk
    }
    func logs(serviceID: String) async throws -> String {
        let response: LogsResponse = try await request("/api/services/\(serviceID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? serviceID)/logs")
        return response.logs
    }
    func action(serviceID: String, action: String) async throws {
        let _: ActionResponse = try await request(
            "/api/services/\(serviceID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? serviceID)/\(action)",
            method: "POST",
            body: ActionRequest(riskAcknowledged: true, source: "native")
        )
    }
}

private struct ActionRequest: Encodable {
    let riskAcknowledged: Bool
    let source: String
}

struct PortDeckAPIError: LocalizedError { let message: String; var errorDescription: String? { message } }

private struct AnyEncodable: Encodable {
    private let encodeValue: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) { encodeValue = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeValue(encoder) }
}
