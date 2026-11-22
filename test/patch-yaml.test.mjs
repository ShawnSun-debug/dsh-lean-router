// test/patch-yaml.test.mjs - 补丁 YAML 解析回归（dsh 用 js-yaml + !!js 自定义标签装载 overlay）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const jsType = new yaml.Type("tag:yaml.org,2002:js", { kind: "scalar", construct: (data) => ({ __js: data }) });
const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);

function parseFile(path) {
  return yaml.load(readFileSync(path, "utf8"), { schema });
}

test("cordis.patch.yml 可被 dsh 等价解析器装载", () => {
  const doc = parseFile(join(root, "cordis.patch.yml"));
  assert.ok(Array.isArray(doc), "顶层必须是操作数组");
  assert.equal(doc.length, 8, "8 个顶层操作");
  const rows = doc.flatMap((op) => op.insert ?? []);
  assert.ok(rows.some((row) => row.id === "preset-lean-router"), "含 preset-lean-router 行");
});

test("全部 presets/base 补丁片段可解析", () => {
  const dir = join(root, "presets", "base");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  assert.ok(files.length >= 5, "至少 5 个片段");
  for (const f of files) {
    const doc = parseFile(join(dir, f));
    assert.ok(Array.isArray(doc), f + " 顶层必须是操作数组");
  }
});

test("ptc-runtime 行缩进正确（1.0.0 事故回归）", () => {
  const doc = parseFile(join(root, "presets", "base", "frag-preset.patch.yml"));
  assert.ok(Array.isArray(doc), "frag 是裸行数组");
  const preset = doc.find((p) => p.id === "preset-lean-router");
  assert.ok(preset, "preset 行存在");
  const row = preset.config.plugins.find((p) => p.id === "ptc-runtime");
  assert.ok(row, "ptc-runtime 行必须作为合法列表项被解析出来");
  assert.equal(row.name, "@deepseek-ai/dsh-ptc-runtime-node");
});
