// dsh-lean-router - 体检（票 02 骨架版；票 04/06 将加四层接缝自检）
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function doctor() {
  const lines = []; let fail = 0;
  const ok = (name, cond, extra) => { lines.push((cond ? "[PASS] " : "[FAIL] ") + name + (extra ? " | " + extra : "")); if (!cond) fail++; };
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  ok("package.name", pkg.name === "dsh-lean-router", pkg.name);
  ok("package.engines.dsh", typeof (pkg.engines ?? {}).dsh === "string" && pkg.engines.dsh.includes("0.2.1-rc.5"), pkg.engines?.dsh);
  const patch = await readFile(join(ROOT, "cordis.patch.yml"), "utf8").catch(() => null);
  ok("cordis.patch.yml 存在", !!patch);
  ok("patch 含预设行", !!patch && patch.includes("preset-lean-router"));
  const manifest = JSON.parse(await readFile(join(ROOT, "skills.manifest.json"), "utf8"));
  ok("manifest 31 技能", manifest.skills.length === 31, String(manifest.skills.length));
  const dirs = (await readdir(join(ROOT, "assets", "skills"), { withFileTypes: true })).filter(d => d.isDirectory());
  ok("assets/skills 目录数", dirs.length === 31, String(dirs.length));
  const matrix = JSON.parse(await readFile(join(ROOT, "assets", "skills.matrix.json"), "utf8"));
  const c = { both: 0, modelOnly: 0, userOnly: 0 };
  for (const s of matrix.skills) { if (s.model && s.user) c.both++; else if (s.model) c.modelOnly++; else c.userOnly++; }
  ok("矩阵计数 13/10/8", c.both === 13 && c.modelOnly === 10 && c.userOnly === 8, JSON.stringify(c));
  console.log(lines.join("\n"));
  return fail === 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) process.exit((await doctor()) ? 0 : 1);
