#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
  console.error(`原型目录初始化失败：${message}`);
  process.exit(1);
}

if (args.includes("--help")) {
  console.log("用法：node init-prototype-project.mjs --project <业务项目根目录> [--directory prototype]");
  process.exit(0);
}

const projectValue = option("--project");
if (!projectValue) fail("缺少 --project <业务项目根目录>。");

const projectRoot = path.resolve(projectValue);
if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
  fail(`业务项目根目录不存在：${projectRoot}`);
}

const directoryName = option("--directory") || "prototype";
if (!/^[A-Za-z0-9._-]+$/.test(directoryName) || directoryName === "." || directoryName === "..") {
  fail("--directory 只能是单层安全目录名。");
}

const prototypeRoot = path.join(projectRoot, directoryName);
if (fs.existsSync(prototypeRoot)) {
  if (!fs.statSync(prototypeRoot).isDirectory()) fail(`目标路径不是目录：${prototypeRoot}`);
  console.log(`原型目录已存在，未覆盖任何文件：${prototypeRoot}`);
  console.log(`后续命令请将 --project / --target 指向：${prototypeRoot}`);
  process.exit(0);
}

fs.mkdirSync(prototypeRoot, { recursive: true });
console.log(`已创建独立原型目录：${prototypeRoot}`);
console.log(`后续命令请将 --project / --target 指向：${prototypeRoot}`);
