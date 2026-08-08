import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRoute = (path) =>
  readFile(new URL(`../../app/api/${path}`, import.meta.url), "utf-8");

test("POST /api/secretary/init is a thin initSecretaryFlow wrapper (ticket 06 bootstrap button)", async () => {
  const source = await readRoute("secretary/init/route.ts");
  assert.match(source, /initSecretaryFlow\(/);
  assert.match(source, /export async function POST/);
  assert.match(source, /status: 201/);
  // 模型可选项：客户端只在"已配置"时传 defaultModel 对；null 继承全局默认（04 契约）
  assert.match(source, /typeof body\.provider === "string"/);
  assert.match(source, /typeof body\.modelId === "string"/);
  assert.match(source, /typeof body\.thinkingLevel === "string"/);
  // 错误映射：与 POST /api/members 同款 400
  assert.match(source, /status: 400/);
});
