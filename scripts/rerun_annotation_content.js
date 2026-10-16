#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { mergeContent, useful, contentIssues } = require("./lib/annotation-content");

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--project") args.project = argv[++i];
    else if (argv[i] === "--source") args.source = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else throw new Error("未知参数: " + argv[i]);
  }
  if (!args.project) throw new Error("请通过 --project 指定原型目录");
  return args;
}
function readBusinessPages(projectDir, sourceArg) {
  const jsonPath = path.resolve(projectDir, sourceArg || "intermediate/annotation-source.json");
  if (sourceArg || fs.existsSync(jsonPath)) {
    const model = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (!Array.isArray(model.pages)) throw new Error("标注来源 JSON 必须提供 pages");
    return model.pages;
  }
  const sourcePath = path.join(projectDir, "assets/prototype-data.js");
  if (!fs.existsSync(sourcePath)) throw new Error("缺少 intermediate/annotation-source.json；请先整理有来源依据的模块规则，或通过 --source 指定 JSON");
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), context, { filename: sourcePath, timeout: 1000 });
  if (!Array.isArray(context.window.PrototypeData?.pages)) throw new Error("业务 JS 未提供 window.PrototypeData.pages；不能将查看器镜像当作业务规则");
  return context.window.PrototypeData.pages;
}
function uniqueIndex(items, label) {
  const map = new Map();
  for (const item of items || []) {
    if (!useful(item.id) || map.has(item.id)) throw new Error(label + " 存在空或重复 ID");
    map.set(item.id, item);
  }
  return map;
}
function rerunSpec(spec, businessPage) {
  const modules = uniqueIndex(businessPage.modules, spec.pageId + "/modules");
  const changes = [], sectionChanges = [], unresolved = [];
  for (const section of spec.sections || []) {
    const module = modules.get(section.id);
    if (!module || section.changeStatus === "unchanged") continue;
    const fields = [];
    for (const field of ["title", "component", "contentRule"]) {
      if (!Object.hasOwn(module, field)) continue;
      if (!useful(module[field])) throw new Error(section.id + "/" + field + " 为空");
      if (section[field] !== module[field]) { section[field] = module[field]; fields.push(field); }
    }
    if (fields.length) sectionChanges.push({ id: section.id, fields });
  }
  let checked = 0;
  for (const annotation of spec.annotations || []) {
    if (annotation.scope !== "module") continue;
    checked++;
    const module = modules.get(annotation.moduleId);
    if (!module) { unresolved.push(annotation.id); continue; }
    if ((spec.sections || []).find(s => s.id === annotation.moduleId)?.changeStatus === "unchanged") {
      throw new Error(annotation.id + " 属于 unchanged 模块，请先修正增量覆盖范围");
    }
    const next = { title: module.title || annotation.title, content: mergeContent(annotation.content, module) };
    for (const field of ["requiredDimensions", "requirementRefs", "ruleSources"]) {
      if (Object.hasOwn(module, field)) next[field] = module[field];
    }
    const populated = contentIssues(next.content).populated;
    const required = [...(spec.handoff?.annotationPolicy?.requiredDimensions || []), ...(next.requiredDimensions || annotation.requiredDimensions || [])];
    if (required.some(key => !populated.has(key)) || [...populated].filter(key => key !== "docs").length < (spec.handoff?.annotationPolicy?.minimumApplicableDimensions || 0)) throw new Error(annotation.id + " 合并后缺少必需维度；整批未写入");
    if ((next.ruleSources || annotation.ruleSources || []).some(source => !populated.has(source.dimension))) throw new Error(annotation.id + " 删除维度后仍有来源记录，请显式更新 ruleSources");
    const fields = Object.keys(next).filter(key => JSON.stringify(annotation[key]) !== JSON.stringify(next[key]));
    Object.assign(annotation, next);
    // Legacy structured fields must be migrated first, never silently discarded.
    if (["type", "description", "details", "relatedDocs"].some(key => key in annotation)) {
      throw new Error(annotation.id + " 仍有旧结构字段，请先运行 migrate_annotation_model.js");
    }
    if (fields.length) changes.push({ id: annotation.id, fields });
  }
  return { checked, changes, sectionChanges, unresolved };
}
function syncManifest(prototype, specs) {
  const byPage = new Map(specs.map(spec => [spec.pageId, spec]));
  for (const page of prototype.pages || []) {
    const spec = byPage.get(page.id);
    if (!spec) continue;
    const previous = new Map((page.markers || []).map(marker => [marker.id, marker]));
    page.markers = (spec.annotations || []).map(annotation => ({
      ...previous.get(annotation.id), ...annotation,
      anchor: { ...previous.get(annotation.id)?.anchor, ...annotation.anchor },
    }));
  }
  return prototype;
}
function writeBatch(files) {
  const original = new Map(files.map(([file]) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
  const written = [];
  try {
    for (const [file, content] of files) { written.push(file); fs.writeFileSync(file, content, "utf8"); }
  } catch (error) {
    for (const file of written.reverse()) {
      const before = original.get(file);
      if (before === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, before);
    }
    throw error;
  }
}
function main() {
  const args = parseArgs(process.argv), projectDir = path.resolve(args.project);
  const specsDir = path.join(projectDir, "intermediate/page-specs");
  const pages = uniqueIndex(readBusinessPages(projectDir, args.source), "pages");
  const specs = [], reports = [], writes = [];
  for (const name of fs.readdirSync(specsDir).filter(name => name.endsWith(".json")).sort()) {
    const file = path.join(specsDir, name), spec = JSON.parse(fs.readFileSync(file, "utf8"));
    const page = pages.get(spec.pageId);
    if (!page) throw new Error(spec.pageId + " 缺少来源页面；整批未写入");
    const result = rerunSpec(spec, page);
    specs.push(spec); reports.push({ pageId: spec.pageId, ...result });
    writes.push([file, JSON.stringify(spec, null, 2) + "\n"]);
  }
  uniqueIndex(specs.map(spec => ({ id: spec.pageId })), "page-specs");
  const unresolved = reports.flatMap(page => page.unresolved);
  if (unresolved.length) throw new Error("未匹配模块: " + unresolved.join("、") + "；整批未写入");
  const manifestPath = path.join(projectDir, "prototype.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = syncManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")), specs);
    writes.push([manifestPath, JSON.stringify(manifest, null, 2) + "\n"]);
    const mirrorPath = path.join(projectDir, "assets/prototype-data.js");
    if (fs.existsSync(mirrorPath) && /^\s*window\.PROTOTYPE_DATA\s*=/.test(fs.readFileSync(mirrorPath, "utf8"))) {
      writes.push([mirrorPath, "window.PROTOTYPE_DATA = " + JSON.stringify(manifest, null, 2) + ";\n"]);
    }
  }
  const checked = reports.reduce((n,p) => n + p.checked, 0);
  const changed = reports.reduce((n,p) => n + p.changes.length, 0);
  const sections = reports.reduce((n,p) => n + p.sectionChanges.length, 0);
  const lines = ["# 页面标注内容重跑报告", "", "- 模式：" + (args.dryRun ? "预览，不写入" : "已写入"),
    "- 校对标注：" + checked, "- 更新标注：" + changed, "- 同步模块定义：" + sections, "",
    "未提供维度保留；仅 removeDimensions 显式删除；系统镜像同步，人工覆盖层不修改。", ""];
  for (const page of reports) {
    lines.push("## " + page.pageId, "");
    for (const change of [...page.sectionChanges, ...page.changes]) lines.push("- " + change.id + "：" + change.fields.join("、"));
  }
  if (!args.dryRun) {
    writes.push([path.join(projectDir, "intermediate/annotation-content-rerun-report.md"), lines.join("\n") + "\n"]);
    writeBatch(writes);
  }
  console.log((args.dryRun ? "预览完成" : "重跑完成") + ": " + reports.length + " 个页面，校对 " + checked + " 条标注，更新 " + changed + " 条标注；已预检镜像同步");
}
if (require.main === module) {
  try { main(); } catch (error) { console.error("重跑失败: " + error.message); process.exitCode = 1; }
}
module.exports = { rerunSpec, syncManifest };
