# PortDeck Capability API v1

PortDeck binds the API to `127.0.0.1` only. Browser mutation requests must use the same trusted origin. The SwiftUI transition shell uses this contract so the UI can migrate independently from the Node capability implementation.

## Discovery and health

- `GET /api/health` — runtime and product version
- `GET /api/capabilities` — API contract version and supported capability identifiers
- `GET /api/services?fresh=1` — merged discovered/managed catalog, health summary, preferences and workspaces
- `GET /api/templates` — built-in service templates

## Process and logs

- `GET /api/services/:id/risk/:action` — preview `start`, `stop` or `restart`
- `POST /api/services/:id/:action` — execute after `riskAcknowledged: true` when required
- `POST /api/services/bulk` — bounded batch operation (maximum 50 identifiers)
- `GET /api/services/:id/logs` — current bounded log tail
- `GET /api/services/:id/logs/stream` — Server-Sent Events log stream

## Configuration

- `POST /api/services`, `PUT /api/services/:id`, `DELETE /api/services/:id`
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/workspaces`, `POST /api/workspaces`, `PUT/DELETE /api/workspaces/:id`
- `GET /api/system/export`, `POST /api/system/import`
- `POST /api/system/backup`, `GET /api/system/diagnostics`
- `GET /api/audit?limit=200`

## Compatibility policy

`/api/capabilities` currently reports contract version `1`. New optional fields and capability identifiers may be added compatibly. A breaking route or semantic change requires a new contract version and a transition period in which the Electron and SwiftUI clients support both versions.
