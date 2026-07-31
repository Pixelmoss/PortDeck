export const SERVICE_TEMPLATES = Object.freeze([
  {
    id: "node",
    name: "Node.js",
    kind: "Node.js",
    startCommand: "npm run dev",
    stopCommand: "",
    preferredPort: 3000,
    healthPath: "/",
    notes: "Node.js development server",
  },
  {
    id: "python",
    name: "Python",
    kind: "Python",
    startCommand: "python -m app",
    stopCommand: "",
    preferredPort: 8000,
    healthPath: "/health",
    notes: "Python application",
  },
  {
    id: "docker-compose",
    name: "Docker Compose",
    kind: "Docker Compose",
    startCommand: "docker compose up -d",
    stopCommand: "docker compose down",
    preferredPort: null,
    healthPath: "/",
    notes: "Docker Compose stack",
  },
  {
    id: "static-site",
    name: "Static website",
    kind: "Static",
    startCommand: "python3 -m http.server ${PORT:-8080}",
    stopCommand: "",
    preferredPort: 8080,
    healthPath: "/",
    notes: "Static website preview",
  },
]);

export function listServiceTemplates() {
  return SERVICE_TEMPLATES.map((template) => ({ ...template }));
}
