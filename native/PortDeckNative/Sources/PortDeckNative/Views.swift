import ServiceManagement
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var model: AppModel

    private var filtered: [PortDeckService] {
        let values = model.query.isEmpty ? model.services : model.services.filter { $0.name.localizedCaseInsensitiveContains(model.query) || String($0.port ?? $0.preferredPort ?? 0).contains(model.query) }
        return values.sorted { ($0.favorite ?? false) && !($1.favorite ?? false) }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selectedService) {
                Section("Overview") {
                    Label("\(model.summary.running) running", systemImage: "play.circle.fill")
                    Label("\(model.summary.healthy) healthy", systemImage: "heart.fill")
                    Label("\(model.summary.unhealthy) unhealthy", systemImage: "exclamationmark.triangle.fill")
                }
                Section("Workspaces") {
                    ForEach(model.workspaces) { workspace in Label(workspace.name, systemImage: "square.grid.2x2") }
                }
            }.navigationTitle("PortDeck")
        } content: {
            List(filtered, selection: $model.selectedService) { service in
                ServiceRow(service: service).tag(service)
            }
            .searchable(text: $model.query, prompt: "Name or port")
            .navigationTitle("Local services")
            .toolbar { Button { Task { await model.refresh(fresh: true) } } label: { Image(systemName: "arrow.clockwise") } }
        } detail: {
            if let service = model.selectedService { ServiceDetail(service: service) }
            else {
                VStack(spacing: 12) {
                    Image(systemName: "server.rack")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)
                    Text("Select a service")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(minWidth: 960, minHeight: 620)
        .task { await model.start() }
        .alert(item: $model.pendingAction) { pending in
            Alert(
                title: Text("\(pending.action.capitalized) \(pending.service.name)?"),
                message: Text("Risk: \(pending.risk.severity.uppercased())\n\(pending.risk.command)\n\(pending.risk.findings.map(\.message).joined(separator: "\n"))"),
                primaryButton: .destructive(Text("Continue")) { Task { await model.confirmPendingAction() } },
                secondaryButton: .cancel()
            )
        }
        .alert("PortDeck", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
}

struct ServiceRow: View {
    let service: PortDeckService
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: service.status == "running" ? "circle.fill" : service.status == "conflict" ? "exclamationmark.circle.fill" : "circle")
                .foregroundStyle(service.status == "running" ? .green : service.status == "conflict" ? .orange : .secondary)
            VStack(alignment: .leading, spacing: 4) {
                HStack { Text(service.name).fontWeight(.semibold); if service.favorite == true { Image(systemName: "star.fill").foregroundStyle(.yellow) } }
                Text("\(service.kind ?? "Service") · :\(service.port ?? service.preferredPort ?? 0)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if let health = service.health?.status { Text(health.uppercased()).font(.caption2).foregroundStyle(health == "healthy" ? .green : .orange) }
        }.padding(.vertical, 4)
    }
}

struct ServiceDetail: View {
    @EnvironmentObject var model: AppModel
    let service: PortDeckService
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { VStack(alignment: .leading) { Text(service.name).font(.largeTitle.bold()); Text(service.ownership?.uppercased() ?? service.source.uppercased()).foregroundStyle(.secondary) }; Spacer() }
            GroupBox("Status") { LabeledContent("Runtime", value: service.status); LabeledContent("Port", value: String(service.port ?? service.preferredPort ?? 0)); LabeledContent("Health", value: service.health?.status ?? "unknown") }.frame(maxWidth: 520)
            HStack {
                if service.url != nil { Button("Open") { model.open(service) } }
                Button(service.status == "running" ? "Restart" : "Start") { Task { await model.prepare(service, action: service.status == "running" ? "restart" : "start") } }
                if service.status == "running" { Button("Stop", role: .destructive) { Task { await model.prepare(service, action: "stop") } } }
                if service.source == "managed" { Button("Logs") { Task { await model.showLogs(service) } } }
            }
            if model.selectedService?.id == service.id && !model.logText.isEmpty {
                GroupBox("Logs") { ScrollView { Text(model.logText).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) } }.frame(maxHeight: 300)
            }
            Spacer()
        }.padding(28)
    }
}

struct NativeSettingsView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Form {
            Toggle("Launch quietly at login", isOn: $model.launchAtLogin).onChange(of: model.launchAtLogin) { enabled in
                do { enabled ? try SMAppService.mainApp.register() : try SMAppService.mainApp.unregister() } catch { model.errorMessage = error.localizedDescription }
            }
            LabeledContent("Capability API", value: model.backendAvailable ? "Connected" : "Unavailable")
            LabeledContent("Capabilities", value: "\(model.capabilities.count)")
            Text("Crash diagnostics and exported reports remain opt-in in PortDeck settings.").font(.caption).foregroundStyle(.secondary)
        }.padding(24).frame(width: 460)
    }
}

struct MenuBarView: View {
    @EnvironmentObject var model: AppModel
    var body: some View {
        Text("\(model.summary.running) running · \(model.summary.unhealthy) unhealthy").font(.caption)
        Divider()
        ForEach(model.services.filter { $0.favorite == true || $0.status == "running" }.prefix(10)) { service in
            Menu(service.name) {
                if service.url != nil { Button("Open") { model.open(service) } }
                Button(service.status == "running" ? "Restart" : "Start") { Task { await model.prepare(service, action: service.status == "running" ? "restart" : "start") } }
                if service.status == "running" { Button("Stop") { Task { await model.prepare(service, action: "stop") } } }
            }
        }
        Divider()
        Button("Refresh") { Task { await model.refresh(fresh: true) } }
        Button("Quit PortDeck") { NSApplication.shared.terminate(nil) }
    }
}
