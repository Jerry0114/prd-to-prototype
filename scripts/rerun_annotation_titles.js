#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

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

function normalizedId(value) {
  return String(value || "").trim().toLowerCase();
}

function indexById(items) {
  return new Map((items || []).filter((item) => hasText(item.id)).map((item) => [item.id, item]));
}

const stateLabels = {
  normal: "正常状态",
  loading: "加载状态",
  empty: "空状态",
  error: "失败状态",
  forbidden: "无权限状态",
  expired: "失效状态",
};

function coveredTarget(annotation, spec) {
  const indexes = {
    section: indexById(spec.sections),
    field: indexById(spec.fields),
    action: indexById(spec.actions),
    state: indexById(spec.states),
  };
  const priority = ["section", "field", "action", "state"];
  for (const kind of priority) {
    const cover = (annotation.covers || []).find((item) => item.startsWith(`${kind}:`));
    if (!cover) continue;
    const id = cover.slice(kind.length + 1);
    const target = indexes[kind].get(id);
    if (!target) continue;
    return target.title || target.label || stateLabels[target.id] || target.id;
  }
  return null;
}

function anchoredTarget(annotation, spec) {
  const anchorId = normalizedId(annotation.anchor?.anchorId);
  if (!anchorId) return null;
  const candidates = [
    ...(spec.sections || []).map((item) => ({ id: item.id, label: item.title })),
    ...(spec.fields || []).map((item) => ({ id: item.id, label: item.label })),
    ...(spec.actions || []).map((item) => ({ id: item.id, label: item.label })),
  ].filter((item) => hasText(item.id) && hasText(item.label));

  const exact = candidates.find((item) => normalizedId(item.id) === anchorId);
  if (exact) return exact.label;

  const related = candidates
    .filter((item) => {
      const candidateId = normalizedId(item.id);
      return anchorId.startsWith(candidateId) || candidateId.startsWith(anchorId);
    })
    .sort((left, right) => right.id.length - left.id.length)[0];
  return related?.label || null;
}

function resolveBaseTitle(annotation, spec, titleOverrides) {
  return titleOverrides[annotation.id] || anchoredTarget(annotation, spec) || coveredTarget(annotation, spec);
}

function rerunSpec(spec, titleOverrides) {
  const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  const resolved = annotations.map((annotation) => ({
    annotation,
    baseTitle: resolveBaseTitle(annotation, spec, titleOverrides),
  }));
  const counts = new Map();
  for (const item of resolved) {
    if (item.baseTitle) counts.set(item.baseTitle, (counts.get(item.baseTitle) || 0) + 1);
  }

  const changes = [];
  const unresolved = [];
  for (const item of resolved) {
    const { annotation, baseTitle } = item;
    if (!baseTitle) {
      unresolved.push(annotation.id);
      continue;
    }
    const nextTitle = counts.get(baseTitle) > 1 ? annotation.title : baseTitle;
    if (annotation.title === nextTitle) continue;
    changes.push({ id: annotation.id, from: annotation.title, to: nextTitle });
    annotation.title = nextTitle;
  }
  return { changes, unresolved };
}

function updatePrototype(projectDir, annotationsById, dryRun) {
  const prototypePath = path.join(projectDir, "prototype.json");
  if (!fs.existsSync(prototypePath)) return;
  const prototype = JSON.parse(fs.readFileSync(prototypePath, "utf8"));
  for (const page of prototype.pages || []) {
    for (const marker of page.markers || []) {
      const annotation = annotationsById.get(marker.id);
      if (!annotation) continue;
      if ("title" in marker) marker.title = annotation.title;
      if ("content" in marker) marker.content = annotation.content;
      delete marker.type;
      delete marker.description;
      delete marker.details;
      delete marker.relatedDocs;
    }
  }
  if (!dryRun) fs.writeFileSync(prototypePath, `${JSON.stringify(prototype, null, 2)}\n`, "utf8");

  const mirrorPath = path.join(projectDir, "assets", "prototype-data.js");
  if (fs.existsSync(mirrorPath) && !dryRun) {
    const mirrorSource = fs.readFileSync(mirrorPath, "utf8");
    if (/^\s*window\.PROTOTYPE_DATA\s*=/.test(mirrorSource)) {
      fs.writeFileSync(mirrorPath, `window.PROTOTYPE_DATA = ${JSON.stringify(prototype, null, 2)};\n`, "utf8");
    }
  }
}

function writeReport(projectDir, pageReports, dryRun) {
  const changedCount = pageReports.reduce((sum, page) => sum + page.changes.length, 0);
  const unresolvedCount = pageReports.reduce((sum, page) => sum + page.unresolved.length, 0);
  const lines = [
    "# 页面标注标题重跑报告",
    "",
    `- 模式：${dryRun ? "预览，不写入" : "已写入"}`,
    `- 页面数：${pageReports.length}`,
    `- 标题更新：${changedCount}`,
    `- 未能定位对象：${unresolvedCount}`,
    "",
    "## 页面结果",
    "",
  ];
  for (const page of pageReports) {
    lines.push(`### ${page.pageId}`);
    lines.push("");
    if (!page.changes.length && !page.unresolved.length) {
      lines.push("- 无需调整");
    } else {
      for (const change of page.changes) lines.push(`- \`${change.id}\`：${change.from} → ${change.to}`);
      for (const id of page.unresolved) lines.push(`- \`${id}\`：未找到稳定对象名称，保留原标题`);
    }
    lines.push("");
  }
  if (!dryRun) {
    const reportPath = path.join(projectDir, "intermediate", "annotation-rerun-report.md");
    fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
  }
  return { changedCount, unresolvedCount };
}

function main() {
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(args.project);
  const specsDir = path.join(projectDir, "intermediate", "page-specs");
  if (!fs.existsSync(specsDir)) throw new Error(`页面规格目录不存在: ${specsDir}`);

  const specFiles = fs.readdirSync(specsDir).filter((name) => name.endsWith(".json")).sort();
  const overridesPath = path.join(projectDir, "intermediate", "annotation-title-overrides.json");
  const titleOverrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, "utf8")).titles || {}
    : {};
  const annotationsById = new Map();
  const pageReports = [];

  for (const name of specFiles) {
    const specPath = path.join(specsDir, name);
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    const result = rerunSpec(spec, titleOverrides);
    pageReports.push({ pageId: spec.pageId || name.replace(/\.json$/, ""), ...result });
    for (const annotation of spec.annotations || []) annotationsById.set(annotation.id, annotation);
    if (!args.dryRun) fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  }

  updatePrototype(projectDir, annotationsById, args.dryRun);
  const totals = writeReport(projectDir, pageReports, args.dryRun);
  console.log(`${args.dryRun ? "预览完成" : "重跑完成"}: ${specFiles.length} 个页面，更新 ${totals.changedCount} 个标题，${totals.unresolvedCount} 个标题保留`);
  if (args.dryRun && totals.unresolvedCount) {
    for (const page of pageReports.filter((item) => item.unresolved.length)) {
      console.log(`- ${page.pageId}: ${page.unresolved.join(", ")}`);
    }
  }
}

main();
