// dsh-lean-router - 安装说明与校验（票 02 骨架；票 09 实现真安装器）
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function installSteps() {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  return [
    "1) 发布后：dsh plugin --profile desktop add npm:dsh-lean-router@" + pkg.version,
    "   本地开发：dsh plugin --profile desktop add \"link:" + ROOT + "\"",
    "2) 重启 DSH，新会话选择 Lean router 预设",
    "3) 体检：node scripts/doctor.mjs",
    "TODO(ticket-09): 真安装器（认领边界 / --uninstall 回滚 / doctor 联动 / Windows 支持）",
  ];
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) for (const l of await installSteps()) console.log(l);
