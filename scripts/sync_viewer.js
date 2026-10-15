#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function parseProjectArg(argv) {
  const projectIndex = argv.indexOf("--project");
  if (projectIndex === -1 || !argv[projectIndex + 1]) {
    throw new Error("用法: node sync_viewer.js --project <原型目录>");
  }
  return path.resolve(process.cwd(), argv[projectIndex + 1]);
}

function main() {
  const projectDir = parseProjectArg(process.argv);
  const skillViewerDir = path.resolve(__dirname, "../assets/prototype-viewer");
  const templateDir = [
    path.join(projectDir, "templates", "prototype-viewer"),
  ].find((candidate) => fs.existsSync(candidate));
  const files = [
    "index.html",
    "viewer.css",
    "viewer.js",
    "annotation-store.js",
    "document-viewer.html",
    "document-viewer.css",
    "document-viewer.js",
    "document-preview-core.js",
    "marked.umd.js",
    "marked.LICENSE",
  ];
  const brandFile = "prototype-mark.svg";
  const brandTarget = path.join("assets", "prototype-viewer", brandFile);

  if (!fs.existsSync(projectDir)) {
    throw new Error(`原型目录不存在: ${projectDir}`);
  }

  for (const file of files) {
    const source = path.join(skillViewerDir, file);
    if (!fs.existsSync(source)) throw new Error(`Skill 标准查看器文件不存在: ${source}`);
    for (const target of [
      templateDir && path.join(templateDir, file),
      path.join(projectDir, file),
    ].filter(Boolean)) {
      fs.copyFileSync(source, target);
    }
  }

  const brandSource = path.join(skillViewerDir, brandFile);
  if (!fs.existsSync(brandSource)) {
    throw new Error(`Skill 品牌资产不存在: ${brandSource}`);
  }
  for (const target of [
    templateDir && path.join(templateDir, brandTarget),
    path.join(projectDir, brandTarget),
  ].filter(Boolean)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(brandSource, target);
  }

  console.log(`已从 Skill 同步标准查看器: ${projectDir}`);
}

try {
  main();
} catch (error) {
  console.error(`同步失败: ${error.message}`);
  process.exitCode = 1;
}
