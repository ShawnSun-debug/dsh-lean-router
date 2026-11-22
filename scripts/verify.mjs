// dsh-lean-router - 组合自检（票 02 骨架版）
import { check as buildCheck } from "./build-bundle.mjs";
import { doctor } from "./doctor.mjs";

const a = await buildCheck();
const b = await doctor();
console.log(a && b ? "[verify] PASS（build --check + doctor）" : "[verify] FAIL");
process.exit(a && b ? 0 : 1);
