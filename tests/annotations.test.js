#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const { mergeContent, contentIssues } = require("../scripts/lib/annotation-content");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "annotation-rules-"));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS: " + name); }
function run(script, args) { return spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], { encoding: "utf8" }); }
function write(file, model) { fs.writeFileSync(file, JSON.stringify(model, null, 2) + "\n"); }
function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(temp, "fixture-"));
  fs.cpSync(path.join(root, "examples/task-board/prototype"), dir, { recursive: true });
  fs.rmSync(path.join(dir, "annotations"), { recursive: true, force: true });
  // Validate with the current source viewer rather than contributor-local copies.
  assert.equal(run("sync_viewer.js", ["--project", dir]).status, 0);
  const file = path.join(dir, "intermediate/page-specs/task-list.json");
  const spec = JSON.parse(fs.readFileSync(file));
  fn(dir, file, spec);
}
function expectValidation(dir, code) {
  const result = run("validate_artifacts.js", ["--project", dir]);
  const report = fs.readFileSync(path.join(dir, "intermediate/validation-report.md"), "utf8");
  if (code) { assert.notEqual(result.status, 0, result.stdout); assert(report.includes(code), report); }
  else assert.equal(result.status, 0, result.stdout + report);
}
try {
  test("空段、占位和相同维度别名不能充当有效正文", () => {
    assert.equal(contentIssues("模块定义\n\n展示内容\n\n交互逻辑").hasBody, false);
    assert.equal(contentIssues("数据规则\nTBD").empty.length, 1);
    assert.deepEqual(contentIssues("展示内容\n字段甲\n\n内容说明\n字段乙").duplicate, ["content"]);
  });
  test("重跑合并保留布局、合规、文档与未知文本；显式删除才移除", () => {
    const original = "数据规则\n旧数据\n\n布局说明\n单列\n\n合规说明\n风险提示必显\n\n关联文档\ndocs/rules.md\n\n自定义约定\n保留这段";
    const result = mergeContent(original, { data: "新数据" });
    for (const text of ["新数据", "单列", "风险提示必显", "docs/rules.md", "自定义约定"]) assert(result.includes(text));
    assert(!mergeContent(original, { removeDimensions: ["layout"] }).includes("单列"));
    assert.throws(() => mergeContent(original, { data: "" }), /为空/);
    assert.throws(() => mergeContent(original, { data: "新数据", removeDimensions: ["data"] }), /冲突/);
  });
  test("v2.2 单维度静态模块可通过，不强迫定义与三段", () => withFixture((dir, file, spec) => {
    spec.annotations[0].content = "展示内容\n关键词与进度筛选。";
    spec.annotations[0].requiredDimensions = ["content"];
    delete spec.annotations[0].ruleSources;
    write(file, spec);
    const manifestPath = path.join(dir, "prototype.json"), manifest = JSON.parse(fs.readFileSync(manifestPath));
    delete manifest.pages[0].markers; write(manifestPath, manifest);
    expectValidation(dir);
  }));
  test("空标题段不能绕过校验", () => withFixture((dir, file, spec) => {
    spec.annotations[0].content = "模块定义\n\n展示内容\n\n交互逻辑";
    write(file, spec); expectValidation(dir, "ANNOTATION_BODY_INVALID");
  }));
  test("v2.2 背景按需提供，不为角色与入口造说明", () => withFixture((dir, file, spec) => {
    delete spec.handoff.pageOverview;
    spec.handoff.coverageDimensions = ["acceptance"];
    write(file, spec); expectValidation(dir);
    spec.handoff.pageOverview = { roles: [{ label: "受邀成员" }] };
    write(file, spec); expectValidation(dir);
    spec.handoff.pageOverview.roles[0].label = "";
    write(file, spec); expectValidation(dir, "HANDOFF_OVERVIEW_ITEM_INVALID");
  }));
  test("旧 v2.1 完整背景与覆盖契约仍可验证", () => withFixture((dir, file, spec) => {
    spec.handoff.version = "2.1";
    spec.handoff.annotationPolicy.requiredDimensions = ["definition", "content", "interaction"];
    spec.handoff.annotationPolicy.minimumApplicableDimensions = 3;
    spec.handoff.coverageDimensions.push("roles", "preconditions");
    spec.handoff.pageOverview = Object.fromEntries(["roles", "entries", "exits", "preconditions"].map(key => [key, [{ label: key, description: "旧版背景说明" }]]));
    for (const a of spec.annotations) a.content = "模块定义\n筛选或查看任务\n\n展示内容\n任务标题与进度\n\n交互逻辑\n查看对应结果\n\n数据规则\n使用当前任务数据\n\n异常与状态\n无匹配时提示";
    spec.annotations.at(-1).covers.push(...spec.states.filter(s => s.applicable).map(s => "state:" + s.id));
    write(file, spec); expectValidation(dir);
    delete spec.handoff.pageOverview; write(file, spec); expectValidation(dir, "HANDOFF_OVERVIEW_MISSING");
  }));
  test("只有文档链接不能代替模块说明", () => withFixture((dir, file, spec) => {
    spec.annotations[0].content = "关联文档\ndocs/PRD.md";
    spec.annotations[0].requiredDimensions = []; delete spec.annotations[0].ruleSources;
    write(file, spec); expectValidation(dir, "HANDOFF_MODULE_CONTENT_DIMENSIONS_INCOMPLETE");
  }));
  test("策略及单条声明的必需维度必须实际有正文", () => withFixture((dir, file, spec) => {
    spec.handoff.annotationPolicy.requiredDimensions = ["layout"];
    write(file, spec); expectValidation(dir, "HANDOFF_MODULE_CONTENT_DIMENSIONS_INCOMPLETE");
  }));
  test("旧 v2.1 契约仍要求定义和三维度，缺必需交互同样失败", () => withFixture((dir, file, spec) => {
    spec.handoff.version = "2.1"; spec.handoff.annotationPolicy.requiredDimensions = ["definition", "content", "interaction"];
    spec.handoff.annotationPolicy.minimumApplicableDimensions = 3;
    spec.annotations[0].content = "模块定义\n筛选任务\n\n数据规则\n按标题匹配\n\n异常与状态\n无结果提示";
    write(file, spec); expectValidation(dir, "HANDOFF_MODULE_CONTENT_DIMENSIONS_INCOMPLETE");
  }));
  test("未改模块与其字段在增量模式下无需强行覆盖", () => withFixture((dir, file, spec) => {
    spec.handoff.annotationPolicy.coverageScope = "change-impact";
    for (const s of spec.sections) { s.changeStatus = s.id === "filters" ? "unchanged" : "changed"; s.changeReason = "测试范围"; }
    spec.annotations = spec.annotations.filter(a => a.moduleId !== "filters"); write(file, spec); expectValidation(dir);
  }));
  test("跨模块覆盖与变更父子范围冲突会阻断", () => withFixture((dir, file, spec) => {
    spec.annotations[1].covers.push("field:keyword"); write(file, spec); expectValidation(dir, "HANDOFF_CROSS_MODULE_COVERAGE");
    spec.annotations[1].covers.pop(); spec.handoff.annotationPolicy.coverageScope = "change-impact";
    for (const s of spec.sections) { s.changeStatus = "unchanged"; s.changeReason = "原有模块"; }
    spec.fields[0].changeStatus = "changed"; spec.fields[0].changeReason = "更改字段";
    write(file, spec); expectValidation(dir, "HANDOFF_TARGET_CHANGE_CONFLICT");
  }));
  test("镜像旧内容及无效来源引用会阻断", () => withFixture((dir, file, spec) => {
    spec.annotations[0].content += "\n\n布局说明\n窄屏单列"; write(file, spec); expectValidation(dir, "ANNOTATION_MIRROR_STALE");
    spec.annotations[0].ruleSources[0].requirementRefs = ["REQ-NOT-FOUND"]; write(file, spec); expectValidation(dir, "ANNOTATION_SOURCE_REF_INVALID");
  }));
  test("整批重跑同步镜像，幂等且不触碰人工标注或锚点", () => withFixture((dir, file, spec) => {
    const noteDir = path.join(dir, "annotations"); fs.mkdirSync(noteDir);
    const manual = path.join(noteDir, "manual-annotations.json"); fs.writeFileSync(manual, '{"user-note":"keep"}');
    const sourcePath = path.join(dir, "intermediate/annotation-source.json"), source = JSON.parse(fs.readFileSync(sourcePath));
    source.pages[0].modules[0].data = "关键词按当前标题匹配，进度同时生效。"; write(sourcePath, source);
    const before = fs.readFileSync(file), anchor = spec.annotations[0].anchor;
    assert.equal(run("rerun_annotation_content.js", ["--project", dir, "--dry-run"]).status, 0);
    assert.deepEqual(fs.readFileSync(file), before);
    const result = run("rerun_annotation_content.js", ["--project", dir]);
    assert.equal(result.status, 0, result.stderr);
    const after = JSON.parse(fs.readFileSync(file)), manifest = JSON.parse(fs.readFileSync(path.join(dir, "prototype.json")));
    assert.deepEqual(after.annotations[0].anchor, anchor);
    assert.equal(after.annotations[0].content, manifest.pages[0].markers[0].content);
    assert.equal(fs.readFileSync(manual, "utf8"), '{"user-note":"keep"}');
    assert.equal(run("rerun_annotation_content.js", ["--project", dir, "--dry-run"]).status, 0);
    assert.match(run("rerun_annotation_content.js", ["--project", dir, "--dry-run"]).stdout, /更新 0 条/);
  }));
  test("来源缺失或重复 ID 时不发生跨文件部分写入", () => withFixture((dir, file) => {
    const sourcePath = path.join(dir, "intermediate/annotation-source.json"), source = JSON.parse(fs.readFileSync(sourcePath));
    source.pages[0].modules[0].data = "本轮新内容"; source.pages[1].modules = []; write(sourcePath, source);
    const before = fs.readFileSync(file);
    assert.notEqual(run("rerun_annotation_content.js", ["--project", dir]).status, 0);
    assert.deepEqual(fs.readFileSync(file), before);
    source.pages[1].modules = [source.pages[0].modules[0], source.pages[0].modules[0]]; write(sourcePath, source);
    assert.notEqual(run("rerun_annotation_content.js", ["--project", dir]).status, 0);
    assert.deepEqual(fs.readFileSync(file), before);
  }));
  test("显式删除必需维度或空值更新会阻断整批写入", () => withFixture((dir, file) => {
    const sourcePath = path.join(dir, "intermediate/annotation-source.json"), source = JSON.parse(fs.readFileSync(sourcePath));
    delete source.pages[0].modules[0].interaction; source.pages[0].modules[0].removeDimensions = ["interaction"];
    write(sourcePath, source); const before = fs.readFileSync(file);
    assert.notEqual(run("rerun_annotation_content.js", ["--project", dir]).status, 0);
    assert.deepEqual(fs.readFileSync(file), before);
    source.pages[0].modules[0].removeDimensions = []; source.pages[0].modules[0].interaction = ""; write(sourcePath, source);
    assert.notEqual(run("rerun_annotation_content.js", ["--project", dir]).status, 0);
    assert.deepEqual(fs.readFileSync(file), before);
  }));
  console.log("\n标注规则测试：" + passed + " 组通过");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
