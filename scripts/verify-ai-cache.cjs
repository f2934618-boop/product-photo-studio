// Provider responses are simulated here. This verifies cache/cooldown logic,
// not live model quality; live browser results are recorded separately.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const sharp = require("sharp");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "xm-ai-cache-"));
const originalLoad = Module._load;
const originalFetch = global.fetch;
const models = ["@cf/black-forest-labs/flux-2-klein-4b", "@cf/black-forest-labs/flux-2-klein-9b"];
const settings = { ready: true, accountId: "a".repeat(32), apiToken: "test-only", model: models[0] };
function loadAdapter() {
  const file = path.resolve("src/lib/cloudflare-ai.ts");
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const adapter = new Module(file, module);
  adapter.filename = file;
  adapter.paths = module.paths;
  Module._load = function (name, parent, isMain) {
    if (name === "server-only") return {};
    if (name === "@/lib/settings") return { CLOUDFLARE_AI_MODELS: models };
    if (name === "@/lib/storage") return { MEDIA_DIR: temporary };
    return originalLoad.call(this, name, parent, isMain);
  };
  try { adapter._compile(code, file); return adapter.exports; }
  finally { Module._load = originalLoad; }
}
(async () => {
  const source = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#d52b2b" } }).png().toBuffer();
  const generated = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer();
  let calls = 0;
  global.fetch = async (_url, request) => {
    calls++;
    assert.equal(request.headers.Authorization, "Bearer test-only");
    assert.ok(request.body.get("input_image_0") instanceof Blob);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ result: { image: generated.toString("base64") } });
  };
  let adapter = loadAdapter();
  const options = { bytes: source, ratio: "3:4", quality: "standard", settings };
  const images = await Promise.all(Array.from({ length: 12 }, () => adapter.reshootProductWithCloudflare(options)));
  assert.equal(calls, 1, "identical simultaneous requests must share a single call");
  assert.ok(images.every((image) => image === images[0]));
  adapter = loadAdapter();
  assert.equal(await adapter.reshootProductWithCloudflare(options), images[0]);
  assert.equal(calls, 1, "disk cache must survive a module/process restart");
  await adapter.reshootProductWithCloudflare({ ...options, ratio: "1:1" });
  await adapter.reshootProductWithCloudflare({ ...options, quality: "quality" });
  assert.equal(calls, 3, "changed ratio or model must use separate cache entries");
  global.fetch = async () => { calls++; return Response.json({ errors: [{ code: 4006, message: "daily free allocation of 10,000 neurons" }] }, { status: 429 }); };
  const pending = await Promise.allSettled(["4:3", "9:16", "16:9"].map((ratio) => adapter.reshootProductWithCloudflare({ ...options, ratio })));
  assert.ok(pending.every((result) => result.status === "rejected" && result.reason.status === 503));
  assert.equal(calls, 4, "queue must stop calling the provider after daily exhaustion");
  assert.equal(await adapter.cloudflareAvailable(), false);
  adapter = loadAdapter();
  assert.equal(await adapter.cloudflareAvailable(), false, "cooldown must survive a restart");
  assert.equal(await adapter.reshootProductWithCloudflare(options), images[0], "successful cache remains usable during outage");
  assert.equal(calls, 4);
  console.log("PASS: duplicate coalescing, persisted cache, parameter separation, quota cooldown, restart, cached success during outage");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith("xm-ai-cache-"));
  fs.rmSync(temporary, { recursive: true, force: true });
});
