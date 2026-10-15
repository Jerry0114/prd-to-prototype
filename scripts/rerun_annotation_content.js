#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project") args.project = argv[index += 1];
    else if (value === "--dry-run") args.dryRun = true;
    else throw new Error(`未知参数: ${value}`);
  }
  if (!args.project) throw new Error("请通过 --project 指定原型目录");
  return args;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readBusinessPages(projectDir) {
  const sourcePath = path.join(projectDir, "assets", "prototype-data.js");
  if (!fs.existsSync(sourcePath)) throw new Error(`业务页面数据不存在: ${sourcePath}`);
  const source = fs.readFileSync(sourcePath, "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: sourcePath });
  const pages = context.window.PrototypeData?.pages;
  if (!Array.isArray(pages)) {
    throw new Error("prototype-data.js 未提供 window.PrototypeData.pages，不能安全重跑标注内容");
  }
  return pages;
}

function buildContent(module) {
  const candidates = [
    ["模块定义", module.contentRule],
    ["展示内容", module.content],
    ["数据规则", module.data],
    ["交互逻辑", module.interaction],
    ["异常与状态", module.state],
  ];
  return candidates
    .filter(([, content]) => hasText(content))
    .map(([label, content]) => `${label}\n${content.trim()}`)
    .join("\n\n");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function rerunSpec(spec, businessPage) {
  const modules = new Map((businessPage.modules || []).map((module) => [module.id, module]));
  const changes = [];
  const sectionChanges = [];
  const unresolved = [];
  let checked = 0;

  for (const section of spec.sections || []) {
    const module = modules.get(section.id);
    if (!module) continue;
    const next = {
      title: module.title || section.title,
      component: module.component || section.component,
      contentRule: module.contentRule || section.contentRule,
    };
    const changedFields = Object.keys(next).filter((field) => !sameJson(section[field], next[field]));
    if (!changedFields.length) continue;
    for (const field of changedFields) section[field] = next[field];
    sectionChanges.push({ id: section.id, fields: changedFields });
  }

  for (const annotation of spec.annotations || []) {
    if (annotation.scope !== "module") continue;
    checked += 1;
    const module = modules.get(annotation.moduleId);
    if (!module) {
      unresolved.push(annotation.id);
      continue;
    }
    const next = {
      title: module.title || annotation.title,
      content: buildContent(module),
    };
    const fields = ["title", "content"];
    const changedFields = fields.filter((field) => !sameJson(annotation[field], next[field]));
    const removedFields = ["type", "description", "details", "relatedDocs"].filter((field) => field in annotation);
    if (!changedFields.length && !removedFields.length) continue;
    for (const field of changedFields) annotation[field] = next[field];
    for (const field of removedFields) delete annotation[field];
    changes.push({ id: annotation.id, fields: [...changedFields, ...removedFields.map((field) => `移除 ${field}`)] });
  }
  return { checked, changes, sectionChanges, unresolved };
}

function writeReport(projectDir, pageReports, dryRun) {
  const changedCount = pageReports.reduce((sum, page) => sum + page.changes.length, 0);
  const changedSectionCount = pageReports.reduce((sum, page) => sum + page.sectionChanges.length, 0);
  const checkedCount = pageReports.reduce((sum, page) => sum + page.checked, 0);
  const unresolvedCount = pageReports.reduce((sum, page) => sum + page.unresolved.length, 0);
  const lines = [
    "# 页面标注内容重跑报告",
    "",
    `- 模式：${dryRun ? "预览，不写入" : "已写入"}`,
    `- 页面数：${pageReports.length}`,
    `- 校对标注：${checkedCount}`,
    `- 更新标注：${changedCount}`,
    `- 同步模块定义：${changedSectionCount}`,
    `- 未匹配模块：${unresolvedCount}`,
    "",
    "## 页面结果",
    "",
  ];
  for (const page of pageReports) {
    lines.push(`### ${page.pageId}`, "");
    if (!page.changes.length && !page.sectionChanges.length && !page.unresolved.length) lines.push("- 无需调整");
    for (const change of page.sectionChanges) {
      lines.push(`- 模块 \`${change.id}\`：同步 ${change.fields.join("、")}`);
    }
    for (const change of page.changes) {
      lines.push(`- \`${change.id}\`：更新 ${change.fields.join("、")}`);
    }
    for (const id of page.unresolved) lines.push(`- \`${id}\`：未找到同名业务模块，保留原内容`);
    lines.push("");
  }
  if (!dryRun) {
    const reportPath = path.join(projectDir, "intermediate", "annotation-content-rerun-report.md");
    fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  }
  return { checkedCount, changedCount, changedSectionCount, unresolvedCount };
}

function main() {
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(args.project);
  const specsDir = path.join(projectDir, "intermediate", "page-specs");
  if (!fs.existsSync(specsDir)) throw new Error(`页面规格目录不存在: ${specsDir}`);

  const pages = readBusinessPages(projectDir);
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const specFiles = fs.readdirSync(specsDir).filter((name) => name.endsWith(".json")).sort();
  const reports = [];

  for (const name of specFiles) {
    const specPath = path.join(specsDir, name);
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    const businessPage = pagesById.get(spec.pageId);
    if (!businessPage) throw new Error(`${spec.pageId} 未在业务页面数据中找到`);
    const result = rerunSpec(spec, businessPage);
    reports.push({ pageId: spec.pageId, ...result });
    if (!args.dryRun) fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  }

  const totals = writeReport(projectDir, reports, args.dryRun);
  console.log(`${args.dryRun ? "预览完成" : "重跑完成"}: ${specFiles.length} 个页面，校对 ${totals.checkedCount} 条标注，同步 ${totals.changedSectionCount} 个模块，更新 ${totals.changedCount} 条标注，${totals.unresolvedCount} 条未匹配`);
  if (totals.unresolvedCount) process.exitCode = 1;
}

main();
