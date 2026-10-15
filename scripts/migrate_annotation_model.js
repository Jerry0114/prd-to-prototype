#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const annotationStore = require("../assets/prototype-viewer/annotation-store.js");

function parseArgs(argv) {
  const args = { project: null, dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--project") args.project = argv[index += 1];
    else if (argv[index] === "--dry-run") args.dryRun = true;
    else if (["--help", "-h"].includes(argv[index])) {
      console.log("用法: node migrate_annotation_model.js --project <原型目录> [--dry-run]");
      process.exit(0);
    } else throw new Error(`未知参数: ${argv[index]}`);
  }
  if (!args.project) throw new Error("缺少 --project <原型目录>");
  return args;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function migrateMarker(marker, forceContent) {
  const legacyFields = ["type", "description", "details", "relatedDocs"];
  const hasLegacyContent = legacyFields.some((field) => field in marker);
  const excluded = new Set(["id", "title", "content", ...legacyFields]);
  const metadata = Object.fromEntries(Object.entries(marker).filter(([key]) => !excluded.has(key)));
  const next = {};
  if ("id" in marker) next.id = marker.id;
  if ("title" in marker) next.title = marker.title;
  if (forceContent || "content" in marker || hasLegacyContent) next.content = annotationStore.annotationContent(marker);
  return { ...next, ...metadata };
}

function migratePageSpecs(projectDir, dryRun) {
  const specsDir = path.join(projectDir, "intermediate", "page-specs");
  if (!fs.existsSync(specsDir)) return { scannedFiles: 0, scannedAnnotations: 0, changedFiles: 0, changedAnnotations: 0 };
  let scannedFiles = 0;
  let scannedAnnotations = 0;
  let changedFiles = 0;
  let changedAnnotations = 0;
  for (const name of fs.readdirSync(specsDir).filter((item) => item.endsWith(".json")).sort()) {
    const specPath = path.join(specsDir, name);
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    scannedFiles += 1;
    scannedAnnotations += (spec.annotations || []).length;
    const source = JSON.stringify(spec.annotations || []);
    spec.annotations = (spec.annotations || []).map((marker) => migrateMarker(marker, true));
    if (JSON.stringify(spec.annotations) === source) continue;
    changedFiles += 1;
    changedAnnotations += spec.annotations.length;
    if (!dryRun) writeJson(specPath, spec);
  }
  return { scannedFiles, scannedAnnotations, changedFiles, changedAnnotations };
}

function migratePrototype(projectDir, dryRun) {
  const prototypePath = path.join(projectDir, "prototype.json");
  if (!fs.existsSync(prototypePath)) return { changed: false, markers: 0 };
  const prototype = JSON.parse(fs.readFileSync(prototypePath, "utf8"));
  const source = JSON.stringify(prototype.pages || []);
  let markers = 0;
  for (const page of prototype.pages || []) {
    page.markers = (page.markers || []).map((marker) => {
      markers += 1;
      return migrateMarker(marker, false);
    });
  }
  const changed = JSON.stringify(prototype.pages || []) !== source;
  if (changed && !dryRun) writeJson(prototypePath, prototype);
  return { changed, markers };
}

function migrateManualFile(projectDir, dryRun) {
  const filePath = path.join(projectDir, "annotations", "manual-annotations.json");
  if (!fs.existsSync(filePath)) return { changed: false, markers: 0 };
  const source = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const store = annotationStore.normalizeStore(source);
  const pageIds = new Set([...Object.keys(source.pages || {}), ...Object.keys(store.pages || {})]);
  const pages = {};
  let markers = 0;
  pageIds.forEach((pageId) => {
    const edits = annotationStore.normalizePageEdits(store.pages[pageId]);
    const current = (source.pages?.[pageId]?.current || []).map((marker) => {
      markers += 1;
      return {
        id: marker.id,
        origin: marker.origin === "manual" ? "manual" : "system",
        modified: Boolean(marker.modified),
        title: marker.title,
        content: annotationStore.annotationContent(marker),
        x: marker.x,
        y: marker.y,
        anchor: marker.anchor,
        createdAt: marker.createdAt || null,
        editedAt: marker.editedAt || null,
      };
    });
    markers += edits.added.length + Object.keys(edits.updated).length;
    pages[pageId] = { ...edits, current };
  });
  const migrated = {
    schemaVersion: "2.0",
    version: 2,
    projectId: source.projectId,
    projectName: source.projectName,
    updatedAt: source.updatedAt || null,
    storage: { kind: "project-file", path: "annotations/manual-annotations.json" },
    pages,
  };
  const changed = JSON.stringify(source) !== JSON.stringify(migrated);
  if (changed && !dryRun) writeJson(filePath, migrated);
  return { changed, markers };
}

function writeReport(projectDir, result, dryRun) {
  if (dryRun) return;
  const reportPath = path.join(projectDir, "intermediate", "annotation-model-migration-report.md");
  const lines = [
    "# 标注模型迁移报告",
    "",
    "- 目标模型：标题 + 内容",
    `- 扫描页面规格：${result.specs.scannedFiles} 个文件，${result.specs.scannedAnnotations} 条标注`,
    `- 本次更新：${result.specs.changedFiles} 个文件，${result.specs.changedAnnotations} 条标注`,
    `- prototype.json：${result.prototype.changed ? "已更新" : "无需更新"}`,
    `- prototype 标记：${result.prototype.markers}`,
    `- 人工备注文件：${result.manual.changed ? "已迁移到 v2" : "无需迁移"}`,
    `- 人工备注记录：${result.manual.markers}`,
    "",
    "旧摘要、结构化明细和关联文档已按原顺序合并到 `content` 的分段文本中；业务页面、锚点、覆盖关系和需求引用未改动。",
    "",
  ];
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(args.project);
  const result = {
    specs: migratePageSpecs(projectDir, args.dryRun),
    prototype: migratePrototype(projectDir, args.dryRun),
    manual: migrateManualFile(projectDir, args.dryRun),
  };
  writeReport(projectDir, result, args.dryRun);
  console.log(`${args.dryRun ? "迁移预检" : "迁移完成"}: 扫描 ${result.specs.scannedFiles} 个页面规格、${result.specs.scannedAnnotations} 条标注，本次更新 ${result.specs.changedFiles} 个文件，人工备注 ${result.manual.changed ? "已更新" : "无需更新"}`);
}

if (require.main === module) main();

module.exports = { migrateMarker };
