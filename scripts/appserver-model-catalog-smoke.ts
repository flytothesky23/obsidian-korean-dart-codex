import { discoverCodexModels } from "../src/codex-model-catalog";

const models = await discoverCodexModels({
  runtime: {
    source: "custom",
    command: process.env.CODEX_SMOKE_COMMAND?.trim() || "codex",
    permissionMode: "auto",
    environmentVariables: "",
  },
  cwd: process.cwd(),
  timeoutMs: 30_000,
});

const required = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const available = new Set(models.map((model) => model.model));
const missing = required.filter((model) => !available.has(model));
if (missing.length > 0) {
  throw new Error(`Codex app-server model/list is missing: ${missing.join(", ")}`);
}

console.log(JSON.stringify({
  status: "ok",
  defaultModel: models.find((model) => model.isDefault)?.model ?? null,
  models: models.map((model) => ({
    model: model.model,
    reasoning: model.supportedReasoningEfforts,
  })),
}, null, 2));
