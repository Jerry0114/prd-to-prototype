#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inspectPageBriefGate } = require("../scripts/check_page_brief_gate.js");
const { validateSchema } = require("../scripts/lib/schema-validator.js");
const skillRoot = path.resolve(__dirname, "..");

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function brief(pageIds) {
  const primary = pageIds[0];
  return `---
page_id: ${primary}
title: 测试页面
status: confirmed
---

# 测试页面定义

页面 ID：${pageIds.join("、")}

## 1. 页面定位与目标

面向任务列表使用者，在完整内容浏览链路中承接入口与详情阅读。本轮只验证已确认的信息架构，不扩展运营配置。

## 2. 用户与使用场景

用户从上游入口进入，快速识别页面目的，浏览主要内容并完成下一步跳转。完成标志是用户能到达目标详情并按原路径返回。

## 3. 页面功能结构与信息架构

页面由头部、核心内容区、辅助信息区和操作区组成。头部提供定位，核心区承载主任务，辅助区补充上下文，操作区完成跳转。

## 4. 内容与数据规则

内容来自已确认来源，按业务规则展示标题、摘要和状态。空值不显示无意义占位；排序、数量和时效只使用需求模型中的明确结论。

## 5. 关键交互与路由

点击主要内容进入详情，返回时恢复来源页面。请求失败时保留可执行的重试入口，重复触发不创建重复跳转。

## 6. 页面状态与降级

正常态展示完整内容；加载态保持稳定骨架；空态说明当前无内容；失败态允许重试；无权限和失效状态按适用性显式声明。

## 7. 原型制作说明

原型使用移动端独立画布，呈现主要模块、跳转、返回和异常反馈。演示数据只用于验证结构，不冒充生产数据，也不把研发规则写进业务界面。

## 8. 待确认项

无。页面定位、功能结构、数据边界、路由和状态已经共同确认。

## 9. 确认记录

状态：已确认。确认人：用户。确认依据：测试夹具中的明确确认记录。
`;
}

function createFixture({ twoPages = false, duplicatePath = false } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "prd-prototype-gate-"));
  const intermediateDir = path.join(projectDir, "intermediate");
  const briefsDir = path.join(intermediateDir, "page-briefs");
  fs.mkdirSync(briefsDir, { recursive: true });

  const sourcePath = path.join(intermediateDir, "source.md");
  fs.writeFileSync(sourcePath, "页面必须展示已确认的核心内容。\n", "utf8");
  const pageIds = twoPages ? ["app-test-one", "app-test-two"] : ["app-test-one"];
  const requirementsPath = path.join(intermediateDir, "requirements.json");
  writeJson(requirementsPath, {
    schemaVersion: "1.0",
    projectId: "test-project",
    sourceDocuments: [{ id: "DOC-001", path: "source.md", title: "测试来源", sha256: hash(sourcePath) }],
    requirements: [{
      id: "REQ-001",
      title: "测试需求",
      type: "page",
      statement: "展示核心内容",
      sourceRefs: [{ documentId: "DOC-001", startLine: 1, endLine: 1, quote: "展示已确认的核心内容" }],
      classification: "explicit",
      confidence: 1,
      confirmationStatus: "confirmed",
      priority: "P0",
      prototypeCritical: true
    }],
    openQuestions: []
  });

  const pages = pageIds.map((pageId) => ({
    id: pageId,
    title: pageId,
    module: "测试",
    kind: "mobile",
    requirementRefs: ["REQ-001"],
    states: ["normal"],
    implementationStatus: "built",
    reason: "测试"
  }));
  const pageMapPath = path.join(intermediateDir, "page-map.json");
  writeJson(pageMapPath, {
    schemaVersion: "1.0",
    projectId: "test-project",
    requirementsPath: "requirements.json",
    requirementsSha256: hash(requirementsPath),
    confirmation: { status: "confirmed", confirmedBy: "user", evidence: "用户确认测试页面范围", confirmedAt: "2026-07-29" },
    pages,
    navigation: pageIds.map((pageId) => ({ id: `nav-${pageId}`, type: "page", title: pageId, pageId })),
    connections: [],
    uncoveredRequirements: []
  });

  const commonBriefPath = path.join(briefsDir, "app-test-one.md");
  fs.writeFileSync(commonBriefPath, brief(pageIds), "utf8");
  const documents = pageIds.map((pageId, index) => {
    const documentPath = duplicatePath || index === 0
      ? commonBriefPath
      : path.join(briefsDir, `${pageId}.md`);
    if (!fs.existsSync(documentPath)) fs.writeFileSync(documentPath, brief([pageId]), "utf8");
    return {
      pageId,
      title: pageId,
      path: path.relative(intermediateDir, documentPath),
      origin: "generated",
      openQuestionsResolved: true,
      status: "confirmed",
      confirmedBy: "user",
      confirmedAt: "2026-07-29",
      confirmationEvidence: "用户确认页面定义",
      sha256: hash(documentPath)
    };
  });
  const gatePath = path.join(intermediateDir, "page-brief-gate.json");
  writeJson(gatePath, {
    schemaVersion: "1.0",
    enabled: true,
    status: "confirmed",
    targetPageIds: pageIds,
    pageMapSha256: hash(pageMapPath),
    documents,
    bypass: null
  });
  return { projectDir, intermediateDir, sourcePath, pageMapPath, gatePath, commonBriefPath };
}

function codes(projectDir) {
  return inspectPageBriefGate(projectDir).errors.map((error) => error.code);
}

const tests = [
  ["合法关卡通过", () => {
    const fixture = createFixture();
    assert.deepEqual(codes(fixture.projectDir), []);
  }],
  ["来源文档变更会失效", () => {
    const fixture = createFixture();
    fs.appendFileSync(fixture.sourcePath, "来源发生变化。\n", "utf8");
    assert(codes(fixture.projectDir).includes("REQUIREMENTS_SOURCE_CHANGED"));
  }],
  ["页面地图未确认会阻断", () => {
    const fixture = createFixture();
    const pageMap = JSON.parse(fs.readFileSync(fixture.pageMapPath, "utf8"));
    pageMap.confirmation.status = "needs-confirmation";
    delete pageMap.confirmation.confirmedBy;
    writeJson(fixture.pageMapPath, pageMap);
    assert(codes(fixture.projectDir).includes("PAGE_MAP_UNCONFIRMED"));
  }],
  ["两个页面不能复用同一份 MD", () => {
    const fixture = createFixture({ twoPages: true, duplicatePath: true });
    assert(codes(fixture.projectDir).includes("PAGE_BRIEF_DOCUMENT_PATH_DUPLICATE"));
  }],
  ["页面 MD 确认后变更会失效", () => {
    const fixture = createFixture();
    fs.appendFileSync(fixture.commonBriefPath, "\n确认后的新增内容。\n", "utf8");
    assert(codes(fixture.projectDir).includes("PAGE_BRIEF_DOCUMENT_CHANGED"));
  }],
  ["页面地图确认后变更会失效", () => {
    const fixture = createFixture();
    const pageMap = JSON.parse(fs.readFileSync(fixture.pageMapPath, "utf8"));
    pageMap.confirmation.evidence = "确认依据后来变化";
    writeJson(fixture.pageMapPath, pageMap);
    assert(codes(fixture.projectDir).includes("PAGE_BRIEF_PAGE_MAP_CHANGED"));
  }],
  ["关闭逐页关卡不能绕过页面地图确认", () => {
    const fixture = createFixture();
    const pageMap = JSON.parse(fs.readFileSync(fixture.pageMapPath, "utf8"));
    pageMap.confirmation.status = "needs-confirmation";
    delete pageMap.confirmation.confirmedBy;
    writeJson(fixture.pageMapPath, pageMap);
    const gate = JSON.parse(fs.readFileSync(fixture.gatePath, "utf8"));
    gate.enabled = false;
    gate.status = "bypassed";
    gate.pageMapSha256 = hash(fixture.pageMapPath);
    gate.bypass = { confirmedBy: "user", confirmedAt: "2026-07-29", reason: "仅测试关闭逐页确认", evidence: "用户明确要求关闭" };
    writeJson(fixture.gatePath, gate);
    assert(codes(fixture.projectDir).includes("PAGE_MAP_UNCONFIRMED"));
  }],
  ["Schema 子集校验 required 与 additionalProperties", () => {
    const errors = validateSchema({
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false
    }, { extra: true });
    assert.equal(errors.length, 2);
    const dynamicErrors = validateSchema({
      type: "object",
      additionalProperties: { type: "string" }
    }, { valid: "内容", invalid: 2 });
    assert.equal(dynamicErrors.length, 1);
  }],
  ["标准查看器离线资源、标注入口与同步完整性", () => {
    const skillViewerDir = path.join(skillRoot, "assets", "prototype-viewer");
    const viewerHtml = fs.readFileSync(path.join(skillViewerDir, "index.html"), "utf8");
    const viewerCss = fs.readFileSync(path.join(skillViewerDir, "viewer.css"), "utf8");
    const viewerJs = fs.readFileSync(path.join(skillViewerDir, "viewer.js"), "utf8");
    const annotationStoreJs = fs.readFileSync(path.join(skillViewerDir, "annotation-store.js"), "utf8");
    assert.doesNotMatch(viewerHtml, /(?:src|href)=["']https?:\/\//);
    assert.doesNotMatch(viewerCss, /@import|url\(["']?https?:\/\//);
    assert.match(viewerHtml, /id="inspector"/);
    assert.doesNotMatch(viewerHtml, /id="pageStateSelect"/);
    assert.match(viewerJs, /function positionMarkersFromAnchors\(node, frame\)/);
    assert.match(viewerJs, /frameDocument\.getElementById\(anchorId\)/);
    assert.match(viewerJs, /point\.dataset\.anchorResolved = "true"/);
    assert.match(viewerJs, /new frameWindow\.ResizeObserver\(queueSync\)/);
    assert.match(viewerJs, /new frameWindow\.MutationObserver\(queueSync\)/);
    assert.match(viewerJs, /point\.dataset\.anchorResolved = "pending"/);
    assert.match(viewerJs, /function markerTriggerFor\(frameDocument, triggerId\)/);
    assert.match(viewerJs, /data-prototype-trigger-for/);
    assert.match(viewerJs, /point\.dataset\.anchorResolved = "preview"/);
    assert.match(viewerCss, /\.annotation-marker\[hidden\] \{ display: none; \}/);
    assert.match(viewerJs, /initialView = decodeURIComponent\(rawInitialView\)/);
    assert.doesNotMatch(viewerHtml, /<h1>页面<\/h1>/);
    assert.doesNotMatch(viewerHtml, /class="status-dot"/);
    assert.doesNotMatch(viewerHtml, /id="schemaVersion"/);
    assert.doesNotMatch(viewerJs, /els\.schemaVersion/);
    assert.match(viewerHtml, /class="annotation-add-button"/);
    assert.match(viewerHtml, /annotation-store\.js/);
    assert.match(viewerHtml, /class="annotation-storage-status"/);
    assert.match(viewerCss, /\.marker-placement-layer \{/);
    assert.match(viewerCss, /\.annotation-edit-form \{/);
    assert.match(viewerCss, /white-space: pre-wrap;/);
    assert.match(viewerCss, /\.annotation-source\.is-manual \{/);
    assert.match(viewerJs, /function placeMarker\(node, page, screen, event\)/);
    assert.match(viewerJs, /function markerEditorValues\(form\)/);
    assert.match(viewerJs, /textarea name="content"/);
    assert.doesNotMatch(viewerJs, /input name="type"/);
    assert.doesNotMatch(viewerJs, /data-editor-rows="details"/);
    assert.match(viewerJs, /fetch\("\/api\/manual-annotations"/);
    assert.match(viewerJs, /window\.localStorage\.setItem/);
    assert.match(annotationStoreJs, /function mergeMarkers\(systemMarkers, edits\)/);
    const syncedProject = fs.mkdtempSync(path.join(os.tmpdir(), "prd-prototype-viewer-"));
    const syncResult = spawnSync(process.execPath, [
      path.join(skillRoot, "scripts", "sync_viewer.js"),
      "--project", syncedProject
    ], { cwd: os.tmpdir(), encoding: "utf8" });
    assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);
    for (const file of ["index.html", "viewer.css", "viewer.js", "annotation-store.js"]) {
      assert.equal(hash(path.join(skillViewerDir, file)), hash(path.join(syncedProject, file)));
    }
  }],
  ["关联 Markdown 文档使用标准 HTML 阅读页", () => {
    const skillViewerDir = path.join(skillRoot, "assets", "prototype-viewer");
    const previewCorePath = path.join(skillViewerDir, "document-preview-core.js");
    const viewerFiles = [
      "document-viewer.html",
      "document-viewer.css",
      "document-viewer.js",
      "document-preview-core.js",
      "marked.umd.js",
      "marked.LICENSE",
    ];
    assert.ok(fs.existsSync(previewCorePath), "标准查看器缺少文档预览路由核心");
    const previewCore = require(previewCorePath);
    assert.equal(
      previewCore.relatedDocHref({ label: "功能需求", path: "docs/功能需求.md" }),
      "document-viewer.html?src=docs%2F%E5%8A%9F%E8%83%BD%E9%9C%80%E6%B1%82.md&title=%E5%8A%9F%E8%83%BD%E9%9C%80%E6%B1%82"
    );
    assert.equal(previewCore.relatedDocHref({ label: "页面定义", path: "docs/page.html" }), "docs/page.html");
    assert.equal(previewCore.relatedDocHref({ label: "越界", path: "../secret.md" }), "#");
    assert.equal(previewCore.isSafeDocumentPath("docs/功能需求.md"), true);
    assert.equal(previewCore.isSafeDocumentPath("https://example.com/a.md"), false);
    assert.equal(previewCore.escapeRawHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");

    const viewerJs = fs.readFileSync(path.join(skillViewerDir, "viewer.js"), "utf8");
    assert.match(viewerJs, /PrototypeDocumentPreview\.relatedDocHref\(doc\)/);
    const syncedProject = fs.mkdtempSync(path.join(os.tmpdir(), "prd-prototype-doc-viewer-"));
    const syncResult = spawnSync(process.execPath, [
      path.join(skillRoot, "scripts", "sync_viewer.js"),
      "--project", syncedProject
    ], { cwd: os.tmpdir(), encoding: "utf8" });
    assert.equal(syncResult.status, 0, syncResult.stderr || syncResult.stdout);
    for (const file of viewerFiles) {
      assert.equal(hash(path.join(skillViewerDir, file)), hash(path.join(syncedProject, file)));
    }
  }],
  ["人工标注覆盖层合并系统备注并保留长页面坐标", () => {
    const store = require(path.join(skillRoot, "assets", "prototype-viewer", "annotation-store.js"));
    const merged = store.mergeMarkers([
      {
        id: "SYS-01",
        title: "系统备注一",
        description: "系统说明",
        details: [{ dimension: "definition", label: "模块定义", content: "系统定义" }],
        relatedDocs: [{ label: "系统文档", path: "docs/system.md" }],
        anchor: { bindingStatus: "bound" }
      },
      { id: "SYS-02", title: "系统备注二" }
    ], {
      added: [{ id: "USR-01", title: "人工备注" }],
      updated: {
        "SYS-01": {
          title: "用户调整后备注",
          description: "人工说明",
          details: [{ dimension: "data", label: "数据规则", content: "人工调整后的数据规则" }],
          relatedDocs: [{ label: "人工文档", path: "docs/manual.md", section: "数据口径" }],
          x: 10,
          y: 20,
          anchor: { bindingStatus: "fallback-only" }
        }
      },
      deleted: ["SYS-02"]
    });
    assert.deepEqual(merged.map((item) => item.id), ["SYS-01", "USR-01"]);
    assert.equal(merged[0].title, "用户调整后备注");
    assert.equal(merged[0].origin, "system");
    assert.equal(merged[0].modified, true);
    assert.match(merged[0].content, /说明\n人工说明/);
    assert.match(merged[0].content, /数据规则\n人工调整后的数据规则/);
    assert.match(merged[0].content, /关联文档\n人工文档：docs\/manual\.md（数据口径）/);
    assert.equal(merged[1].origin, "manual");
    const point = store.documentPointFromClient({
      clientX: 250,
      clientY: 150,
      rect: { left: 50, top: 50, width: 400, height: 200 },
      screenWidth: 800,
      screenHeight: 400,
      viewportWidth: 1600,
      viewportHeight: 800,
      scrollY: 400
    });
    assert.deepEqual(point, { x: 50, y: 100 });
    const projectFile = store.buildProjectFile({
      version: 2,
      updatedAt: "2026-08-06T00:00:00.000Z",
      pages: {
        page: {
          added: [],
          updated: {
            "SYS-01": {
              title: "系统备注",
              content: "数据规则\n人工调整后的数据规则\n\n关联文档\n人工文档：docs/manual.md（数据口径）",
              x: 10,
              y: 20,
              anchor: { bindingStatus: "fallback-only" },
              editedAt: "2026-08-06T00:00:00.000Z"
            }
          },
          deleted: [],
          updatedAt: "2026-08-06T00:00:00.000Z"
        }
      }
    }, { id: "test-project", name: "测试原型" }, [{
      id: "page",
      markers: [{
        id: "SYS-01",
        origin: "system",
        title: "系统备注",
        content: "数据规则\n人工调整后的数据规则\n\n关联文档\n人工文档：docs/manual.md（数据口径）",
        x: 10,
        y: 20,
        anchor: { bindingStatus: "fallback-only" }
      }]
    }]);
    const { validateAnnotationPayload } = require(path.join(skillRoot, "scripts", "serve_prototype_project.js"));
    assert.deepEqual(validateAnnotationPayload(projectFile, { id: "test-project", name: "测试原型" }), []);
    assert.equal(projectFile.schemaVersion, "2.0");
    assert.equal(projectFile.pages.page.current[0].content, "数据规则\n人工调整后的数据规则\n\n关联文档\n人工文档：docs/manual.md（数据口径）");
    assert.match(projectFile.pages.page.updated["SYS-01"].content, /数据规则/);
    assert.equal("details" in projectFile.pages.page.current[0], false);
    const { migrateMarker } = require(path.join(skillRoot, "scripts", "migrate_annotation_model.js"));
    const migrated = migrateMarker({
      id: "LEGACY-01",
      type: "模块",
      title: "旧标注",
      description: "旧说明",
      details: [{ label: "交互逻辑", content: "点击后进入详情。" }],
      relatedDocs: [{ label: "需求文档", path: "docs/prd.md" }],
      x: 1,
      y: 2,
      anchor: { bindingStatus: "fallback-only" }
    }, true);
    assert.deepEqual(Object.keys(migrated).slice(0, 3), ["id", "title", "content"]);
    assert.match(migrated.content, /说明\n旧说明[\s\S]*交互逻辑\n点击后进入详情。[\s\S]*关联文档\n需求文档：docs\/prd\.md/);
    assert.equal("description" in migrated, false);
    assert(validateAnnotationPayload(projectFile, { id: "other-project", name: "其他原型" }).some((error) => error.path === "$.projectId"));
  }],
  ["标注内容重跑同步模块规则且不改锚点", () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-content-rerun-"));
    const specsDir = path.join(fixtureDir, "intermediate", "page-specs");
    const assetsDir = path.join(fixtureDir, "assets");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "prototype-data.js"), `window.PrototypeData = {"pages":[{"id":"测试页","modules":[{"id":"module-one","title":"真实模块","component":"列表","contentRule":"展示真实内容。","content":"字段甲和字段乙。","data":"数据按时间倒序。","interaction":"点击进入详情。","state":"失败时允许重试。"}]}]};\n`, "utf8");
    writeJson(path.join(specsDir, "test.json"), {
      pageId: "测试页",
      sections: [{ id: "module-one", title: "旧模块", component: "旧组件", contentRule: "旧规则" }],
      annotations: [{
        id: "ANN-TEST-01",
        scope: "module",
        moduleId: "module-one",
        title: "旧模块",
        content: "旧内容",
        anchor: { anchorId: "module-one", bindingStatus: "bound" },
        requirementRefs: ["REQ-001"]
      }]
    });
    const result = spawnSync(process.execPath, [
      path.join(skillRoot, "scripts", "rerun_annotation_content.js"),
      "--project", fixtureDir
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const spec = JSON.parse(fs.readFileSync(path.join(specsDir, "test.json"), "utf8"));
    assert.equal(spec.sections[0].title, "真实模块");
    assert.equal(spec.annotations[0].content, "旧内容\n\n模块定义\n展示真实内容。\n\n展示内容\n字段甲和字段乙。\n\n数据规则\n数据按时间倒序。\n\n交互逻辑\n点击进入详情。\n\n异常与状态\n失败时允许重试。");
    assert.deepEqual(spec.annotations[0].anchor, { anchorId: "module-one", bindingStatus: "bound" });
    assert.equal("details" in spec.annotations[0], false);
    assert.match(fs.readFileSync(path.join(fixtureDir, "intermediate", "annotation-content-rerun-report.md"), "utf8"), /校对标注：1/);
  }],

];

let failed = 0;
for (const [name, test] of tests) {
  try {
    test();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(error.stack || error.message);
  }
}

console.log(`\n测试结果：${tests.length - failed}/${tests.length} 通过`);
if (failed) process.exitCode = 1;
