// dsh-lean-router - 副本漂移检查（票 02；仅 warn）
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function drift() {
  const userDir = join(homedir(), ".dsh", "skills");
  const entries = await readdir(join(ROOT, "assets", "skills"), { withFileTypes: true });
  let diffs = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const local = await readFile(join(ROOT, "assets", "skills", e.name, "SKILL.md"), "utf8").catch(() => null);
    const remote = await readFile(join(userDir, e.name, "SKILL.md"), "utf8").catch(() => null);
    if (local !== remote) { diffs++; console.log("[drift] " + e.name + (remote ? " 与 ~/.dsh/skills 不一致" : " 上游缺失")); }
  }
  console.log(diffs === 0 ? "[check-drift] 无漂移" : "[check-drift] " + diffs + " 个差异（warn-only）");
  return diffs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await drift();
