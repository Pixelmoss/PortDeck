import test from "node:test";
import assert from "node:assert/strict";
import { previewCommandRisk, riskForServiceAction } from "../server/services/risk.mjs";
import { listServiceTemplates } from "../server/services/templates.mjs";

test("previewCommandRisk identifies destructive and privileged commands", () => {
  const risk = previewCommandRisk("sudo rm -rf ./cache", { action: "start" });
  assert.equal(risk.severity, "critical");
  assert.equal(risk.requiresAcknowledgement, true);
  assert.ok(risk.findings.some((item) => item.id === "recursive-delete"));
});

test("riskForServiceAction warns before signaling an external process", () => {
  const risk = riskForServiceAction({ ownership: "external", stopCommand: "" }, "stop");
  assert.equal(risk.severity, "medium");
  assert.ok(risk.findings.some((item) => item.id === "external-process"));
});

test("service templates cover Node, Python, Compose and static sites", () => {
  assert.deepEqual(listServiceTemplates().map((item) => item.id), ["node", "python", "docker-compose", "static-site"]);
});
