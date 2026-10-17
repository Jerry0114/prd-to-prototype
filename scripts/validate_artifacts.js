#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { inspectPageBriefGate } = require("./check_page_brief_gate.js");
const { validateSchema, formatSchemaErrors } = require("./lib/schema-validator");
const { contentIssues, dimensions } = require("./lib/annotation-content");

function parseArgs(argv) {
  const args = { project: null };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--project") {
      args.project = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("用法: node validate_artifacts.js --project <原型目录>");
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${argv[index]}`);
    }
  }
  if (!args.project) throw new Error("缺少 --project 参数（请指向原型目录）");
  return args;
}

function uniqueDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}


function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const internalCopyPatterns = [
  { label: "原型或演示说明", pattern: /原型反馈|原型未真实|演示内容|脱敏演示/ },
  { label: "实现顺序或排序规则", pattern: /固定顺序(?:展示|排列)?|按(?:上线时间|发布时间|时间)倒序(?:展示|排列)?/ },
  { label: "内部页面状态", pattern: /返回正常态|页面状态机|第一期不做/ },
  { label: "内部数据或审核流程", pattern: /上线后会|通过审核后|未到上线时间|旧正文不再展示|页面自动收起空白/ },
  { label: "原型交互说明", pattern: /落地页已唤起|未真实外发/ },
  { label: "技术字段", pattern: /\b(?:column_id|content_id|source_page|source_module|published_at)\b/ },
];

function decodeBasicHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractVisibleHtmlCopy(html) {
  const withoutCode = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const text = withoutCode.replace(/<[^>]+>/g, " ");
  const attributes = [...html.matchAll(/\b(?:aria-label|title|placeholder|data-toast)\s*=\s*(["'])(.*?)\1/gi)]
    .map((match) => match[2]);
  return decodeBasicHtml([text, ...attributes].join(" ")).replace(/\s+/g, " ").trim();
}

function extractVisibleScriptCopy(source) {
  const messages = [];
  const patterns = [
    /\bshowToast\(\s*(["'`])([^"'`]*?)\1\s*\)/g,
    /\bmessage\s*:\s*(["'`])([^"'`]*?)\1/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) messages.push(match[2]);
  }
  return messages.join(" ");
}

function main() {
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(process.cwd(), args.project);
  const intermediateDir = path.join(projectDir, "intermediate");
  const specsDir = path.join(intermediateDir, "page-specs");
  const errors = [];
  const warnings = [];
  const addError = (code, message) => errors.push({ code, message });
  const addWarning = (code, message) => warnings.push({ code, message });
  const schemasDir = path.resolve(__dirname, "../schemas");

  function readJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
      addError("FILE_MISSING", `${label}不存在: ${filePath}`);
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      addError("JSON_INVALID", `${label}无法解析: ${error.message}`);
      return null;
    }
  }

  const requirementsPath = path.join(intermediateDir, "requirements.json");
  const pageMapPath = path.join(intermediateDir, "page-map.json");
  const prototypePath = path.join(projectDir, "prototype.json");
  const requirementsModel = readJson(requirementsPath, "requirements.json");
  const pageMap = readJson(pageMapPath, "page-map.json");
  const prototype = readJson(prototypePath, "prototype.json");
  const manualAnnotationsPath = path.join(projectDir, "annotations", "manual-annotations.json");
  const manualAnnotations = fs.existsSync(manualAnnotationsPath)
    ? readJson(manualAnnotationsPath, "annotations/manual-annotations.json")
    : null;
  const pageBriefGateResult = inspectPageBriefGate(projectDir, { allowLegacyMissing: true });
  for (const item of pageBriefGateResult.errors) addError(item.code, item.message);
  for (const item of pageBriefGateResult.warnings) addWarning(item.code, item.message);

  function validateArtifactSchema(schemaName, data, label) {
    if (!data) return;
    const schemaPath = path.join(schemasDir, schemaName);
    if (!fs.existsSync(schemaPath)) {
      addError("SCHEMA_MISSING", `缺少 ${label} 的 JSON Schema：${schemaPath}`);
      return;
    }
    const schema = readJson(schemaPath, schemaName);
    if (!schema) return;
    for (const message of formatSchemaErrors(label, validateSchema(schema, data))) {
      addError("SCHEMA_INVALID", message);
    }
  }

  validateArtifactSchema("requirements.schema.json", requirementsModel, "requirements.json");
  validateArtifactSchema("page-map.schema.json", pageMap, "page-map.json");
  validateArtifactSchema("manual-annotations.schema.json", manualAnnotations, "annotations/manual-annotations.json");
  const prototypeProjectId = prototype?.project?.id || prototype?.projectId;
  if (manualAnnotations && prototypeProjectId && manualAnnotations.projectId !== prototypeProjectId) {
    addError("ANNOTATION_PROJECT_MISMATCH", "annotations/manual-annotations.json 的 projectId 与 prototype.json 不一致");
  }

  const skillViewerDir = path.resolve(__dirname, "../assets/prototype-viewer");
  const templateCandidates = [
    path.join(projectDir, "templates", "prototype-viewer"),
  ];
  const viewerTemplateDir = templateCandidates.find((candidate) => fs.existsSync(candidate));
  for (const file of ["index.html", "viewer.css", "viewer.js", "annotation-store.js"]) {
    const skillFile = path.join(skillViewerDir, file);
    if (!fs.existsSync(skillFile)) {
      addError("VIEWER_SKILL_ASSET_MISSING", `Skill 缺少标准查看器文件: ${skillFile}`);
      continue;
    }
    for (const [label, targetFile] of [
      ["项目模板", viewerTemplateDir && path.join(viewerTemplateDir, file)],
      ["原型项目", path.join(projectDir, file)],
    ].filter(([, targetFile]) => Boolean(targetFile))) {
      if (!fs.existsSync(targetFile)) {
        addError("VIEWER_FILE_MISSING", `${label}缺少标准查看器文件: ${file}`);
      } else if (fileHash(skillFile) !== fileHash(targetFile)) {
        addError("VIEWER_TEMPLATE_MISMATCH", `${label}的 ${file} 与 Skill 标准查看器不一致，请运行 sync_viewer.js`);
      }
    }
  }

  const brandAssetRelativePath = path.join("assets", "prototype-viewer", "prototype-mark.svg");
  const skillBrandAsset = path.join(skillViewerDir, "prototype-mark.svg");
  if (!fs.existsSync(skillBrandAsset)) {
    addError("VIEWER_BRAND_ASSET_MISSING", `Skill 缺少标准品牌资产: ${skillBrandAsset}`);
  } else {
    for (const [label, assetPath] of [
      ["项目模板", viewerTemplateDir && path.join(viewerTemplateDir, brandAssetRelativePath)],
      ["原型项目", path.join(projectDir, brandAssetRelativePath)],
    ].filter(([, assetPath]) => Boolean(assetPath))) {
      if (!fs.existsSync(assetPath)) {
        addError("VIEWER_BRAND_ASSET_MISSING", `${label}缺少标准品牌资产: ${assetPath}`);
      } else if (fileHash(skillBrandAsset) !== fileHash(assetPath)) {
        addError("VIEWER_BRAND_ASSET_MISMATCH", `${label}品牌资产与 Skill 主资产不一致，请运行 sync_viewer.js`);
      }
    }
  }

  const requirements = requirementsModel?.requirements || [];
  const requirementIds = new Set(requirements.map((item) => item.id));
  const sourceDocumentIds = new Set((requirementsModel?.sourceDocuments || []).map((item) => item.id));
  const validClassifications = new Set(["explicit", "inferred", "proposed", "unresolved"]);
  const validConfirmationStatuses = new Set(["confirmed", "needs-confirmation", "rejected"]);

  if (requirementsModel) {
    if (requirementsModel.schemaVersion !== "1.0" || !hasText(requirementsModel.projectId)) {
      addError("REQ_MODEL_REQUIRED_FIELD", "requirements.json 缺少有效 schemaVersion 或 projectId");
    }
    for (const sourceDocument of requirementsModel.sourceDocuments || []) {
      if (![sourceDocument.id, sourceDocument.path, sourceDocument.title].every(hasText)) {
        addError("SOURCE_DOCUMENT_INVALID", "来源文档缺少 id、path 或 title");
        continue;
      }
      const sourcePath = path.resolve(intermediateDir, sourceDocument.path);
      if (!fs.existsSync(sourcePath)) {
        addError("SOURCE_DOCUMENT_MISSING", `来源文档不存在: ${sourceDocument.path}`);
      }
    }
  }

  for (const duplicate of uniqueDuplicates(requirements.map((item) => item.id))) {
    addError("REQ_ID_DUPLICATE", `需求 ID 重复: ${duplicate}`);
  }
  for (const requirement of requirements) {
    if (!hasText(requirement.id) || !hasText(requirement.statement)) {
      addError("REQ_REQUIRED_FIELD", "需求缺少 id 或 statement");
    }
    if (!Array.isArray(requirement.sourceRefs) || requirement.sourceRefs.length === 0) {
      addError("REQ_SOURCE_MISSING", `${requirement.id} 没有来源引用`);
    }
    for (const sourceRef of requirement.sourceRefs || []) {
      if (!sourceDocumentIds.has(sourceRef.documentId)) {
        addError("REQ_SOURCE_UNKNOWN", `${requirement.id} 引用了未知文档 ${sourceRef.documentId}`);
      }
      if (!Number.isInteger(sourceRef.startLine) || !Number.isInteger(sourceRef.endLine) || !hasText(sourceRef.quote)) {
        addError("REQ_SOURCE_INVALID", `${requirement.id} 的来源行号或引文无效`);
      }
    }
    if (!validClassifications.has(requirement.classification)) {
      addError("REQ_CLASSIFICATION_INVALID", `${requirement.id} 的 classification 非法`);
    }
    if (!validConfirmationStatuses.has(requirement.confirmationStatus)) {
      addError("REQ_CONFIRMATION_INVALID", `${requirement.id} 的 confirmationStatus 非法`);
    }
    if (requirement.classification === "unresolved" && requirement.confirmationStatus === "confirmed") {
      addError("REQ_UNRESOLVED_CONFIRMED", `${requirement.id} 是 unresolved，不能标记为 confirmed`);
    }
  }

  const pages = pageMap?.pages || [];
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const validImplementationStatuses = new Set(["built", "planned", "deferred", "blocked"]);
  if (pageMap) {
    if (pageMap.schemaVersion !== "1.0" || !hasText(pageMap.projectId) || !hasText(pageMap.requirementsPath)) {
      addError("PAGE_MAP_REQUIRED_FIELD", "page-map.json 缺少有效 schemaVersion、projectId 或 requirementsPath");
    } else if (!fs.existsSync(path.resolve(intermediateDir, pageMap.requirementsPath))) {
      addError("PAGE_MAP_REQUIREMENTS_MISSING", `page-map 引用的需求模型不存在: ${pageMap.requirementsPath}`);
    }
  }
  for (const duplicate of uniqueDuplicates(pages.map((page) => page.id))) {
    addError("PAGE_ID_DUPLICATE", `页面 ID 重复: ${duplicate}`);
  }
  if (pageMap && pageMap.confirmation?.status !== "confirmed") {
    addWarning("PAGE_MAP_UNCONFIRMED", "页面地图尚未通过产品确认关卡");
  }
  for (const page of pages) {
    if (!validImplementationStatuses.has(page.implementationStatus)) {
      addError("PAGE_STATUS_INVALID", `${page.id} 的 implementationStatus 非法`);
    }
    if (page.parentPageId && !pageById.has(page.parentPageId)) {
      addError("PAGE_PARENT_UNKNOWN", `${page.id} 的父页面不存在: ${page.parentPageId}`);
    }
    for (const requirementId of page.requirementRefs || []) {
      if (!requirementIds.has(requirementId)) {
        addError("PAGE_REQ_UNKNOWN", `${page.id} 引用了未知需求 ${requirementId}`);
      }
    }
    if (page.implementationStatus !== "built" && !hasText(page.reason)) {
      addError("PAGE_REASON_MISSING", `${page.id} 未生成但没有说明原因`);
    }
    if (["planned", "deferred"].includes(page.implementationStatus) && !page.targetVersion) {
      addWarning("PAGE_TARGET_MISSING", `${page.id} 未声明目标版本`);
    }
  }

  const navigationPageCounts = new Map();
  let navigationFolderCount = 0;
  function validateNavigation(nodes, depth = 1) {
    for (const node of nodes || []) {
      if (depth > 3) {
        addError("NAV_DEPTH_EXCEEDED", `目录节点 ${node.id} 超过三层限制`);
      }
      if (node.type === "folder") {
        navigationFolderCount += 1;
        if (!Array.isArray(node.children) || node.children.length === 0) {
          addError("NAV_FOLDER_EMPTY", `目录文件夹 ${node.id} 没有子节点`);
        }
      }
      if (node.type === "page") {
        navigationPageCounts.set(node.pageId, (navigationPageCounts.get(node.pageId) || 0) + 1);
        if (!pageById.has(node.pageId)) {
          addError("NAV_PAGE_UNKNOWN", `目录节点 ${node.id} 引用了未知页面 ${node.pageId}`);
        }
      }
      validateNavigation(node.children, depth + 1);
    }
  }
  validateNavigation(pageMap?.navigation);
  const builtPages = pages.filter((page) => page.implementationStatus === "built");
  if (builtPages.length > 1 && navigationFolderCount === 0) {
    addError("NAV_HIERARCHY_MISSING", "多页面项目必须使用文件夹表达二至三层目录关系");
  }
  for (const page of builtPages) {
    const count = navigationPageCounts.get(page.id) || 0;
    if (count === 0) addError("NAV_BUILT_PAGE_MISSING", `已生成页面 ${page.id} 未出现在目录树中`);
    if (count > 1) addError("NAV_BUILT_PAGE_DUPLICATE", `已生成页面 ${page.id} 在目录树中出现 ${count} 次`);
  }

  for (const connection of pageMap?.connections || []) {
    if (!pageById.has(connection.from) || !pageById.has(connection.to)) {
      addError("CONNECTION_PAGE_UNKNOWN", `跳转 ${connection.id} 的来源或目标页面不存在`);
    }
    for (const requirementId of connection.requirementRefs || []) {
      if (!requirementIds.has(requirementId)) {
        addError("CONNECTION_REQ_UNKNOWN", `跳转 ${connection.id} 引用了未知需求 ${requirementId}`);
      }
    }
  }

  const coveredRequirementIds = new Set(pages.flatMap((page) => page.requirementRefs || []));
  const uncoveredRequirementIds = new Set((pageMap?.uncoveredRequirements || []).map((item) => item.requirementId));
  for (const item of pageMap?.uncoveredRequirements || []) {
    if (!requirementIds.has(item.requirementId)) {
      addError("UNCOVERED_REQ_UNKNOWN", `未覆盖清单引用未知需求 ${item.requirementId}`);
    }
  }
  for (const requirement of requirements.filter((item) => item.prototypeCritical)) {
    if (!coveredRequirementIds.has(requirement.id) && !uncoveredRequirementIds.has(requirement.id)) {
      addError("CRITICAL_REQ_UNACCOUNTED", `关键需求 ${requirement.id} 既无页面覆盖，也无未覆盖说明`);
    }
  }

  const specFiles = fs.existsSync(specsDir)
    ? fs.readdirSync(specsDir).filter((file) => file.endsWith(".json")).sort()
    : [];
  if (!fs.existsSync(specsDir)) addError("SPECS_DIR_MISSING", `page-specs 目录不存在: ${specsDir}`);
  const specs = new Map();
  for (const file of specFiles) {
    const spec = readJson(path.join(specsDir, file), `page-specs/${file}`);
    if (!spec) continue;
    validateArtifactSchema("page-spec.schema.json", spec, `page-specs/${file}`);
    if (specs.has(spec.pageId)) addError("SPEC_PAGE_DUPLICATE", `page spec 重复: ${spec.pageId}`);
    specs.set(spec.pageId, spec);
  }

  const prototypePages = new Map((prototype?.pages || []).map((page) => [page.id, page]));
  for (const page of pages.filter((item) => item.implementationStatus === "built")) {
    const spec = specs.get(page.id);
    if (!spec) {
      addError("SPEC_MISSING", `${page.id} 缺少 page spec`);
      continue;
    }
    if (!prototypePages.has(page.id)) {
      addError("PROTOTYPE_PAGE_MISSING", `${page.id} 未写入 prototype.json`);
    } else {
      const prototypePage = prototypePages.get(page.id);
      if (!hasText(prototypePage.path) || !fs.existsSync(path.join(projectDir, prototypePage.path))) {
        addError("HTML_MISSING", `${page.id} 的 HTML 入口不存在: ${prototypePage.path || "未声明"}`);
      }
    }
  }

  for (const page of builtPages) {
    const prototypePage = prototypePages.get(page.id);
    if (!prototypePage?.path) continue;
    const htmlPath = path.join(projectDir, prototypePage.path);
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    let candidateCopy = extractVisibleHtmlCopy(html);
    const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)]
      .map((match) => path.resolve(path.dirname(htmlPath), match[2].split(/[?#]/)[0]))
      .filter((scriptPath) => scriptPath.startsWith(`${projectDir}${path.sep}`) && fs.existsSync(scriptPath));
    for (const scriptPath of scriptSources) {
      candidateCopy += ` ${extractVisibleScriptCopy(fs.readFileSync(scriptPath, "utf8"))}`;
    }
    for (const rule of internalCopyPatterns) {
      const match = candidateCopy.match(rule.pattern);
      if (match) {
        addWarning("UI_COPY_INTERNAL_LANGUAGE", `${page.id} 的用户可见文案包含“${match[0]}”（${rule.label}），请改写为目标用户语言，并把规则保留在页面规格或标注中`);
      }
    }
  }

  for (const [pageId, spec] of specs) {
    if (!pageById.has(pageId)) addError("SPEC_PAGE_UNKNOWN", `${pageId} 不在 page-map 中`);
    if (spec.schemaVersion !== "1.0" || !hasText(spec.projectId) || !hasText(spec.title) || !hasText(spec.purpose)) {
      addError("SPEC_REQUIRED_FIELD", `${pageId} 缺少有效 schemaVersion、projectId、title 或 purpose`);
    }
    if (!spec.viewport || !["web", "mobile"].includes(spec.viewport.kind)
      || !Number.isInteger(spec.viewport.width) || !Number.isInteger(spec.viewport.height)) {
      addError("SPEC_VIEWPORT_INVALID", `${pageId} 的 viewport 无效`);
    }
    if (!Array.isArray(spec.sections) || spec.sections.length === 0
      || !Array.isArray(spec.informationPriority) || spec.informationPriority.length === 0) {
      addError("SPEC_STRUCTURE_MISSING", `${pageId} 缺少信息优先级或页面区块`);
    }
    const sections = spec.sections || [];
    const fields = spec.fields || [];
    const actions = spec.actions || [];
    const states = spec.states || [];
    const annotations = spec.annotations || [];
    const entityGroups = [
      ["section", sections],
      ["field", fields],
      ["action", actions],
      ["state", states],
    ];
    for (const [entityType, entities] of entityGroups) {
      for (const duplicate of uniqueDuplicates(entities.map((entity) => entity.id))) {
        addError("SPEC_ENTITY_ID_DUPLICATE", `${pageId} 的 ${entityType} ID 重复: ${duplicate}`);
      }
    }
    for (const requirementId of spec.requirementRefs || []) {
      if (!requirementIds.has(requirementId)) addError("SPEC_REQ_UNKNOWN", `${pageId} 引用了未知需求 ${requirementId}`);
    }
    for (const field of fields) {
      if (![field.id, field.label, field.dataRule].every(hasText)) {
        addError("FIELD_REQUIRED_FIELD", `${pageId} 存在字段规格缺少 id、label 或 dataRule`);
      }
      for (const requirementId of field.requirementRefs || []) {
        if (!requirementIds.has(requirementId)) addError("FIELD_REQ_UNKNOWN", `${pageId}/${field.id} 引用了未知需求 ${requirementId}`);
      }
    }
    const stateIds = new Set(states.map((state) => state.id));
    if (!stateIds.has("normal")) addError("STATE_NORMAL_MISSING", `${pageId} 缺少 normal 状态`);
    for (const requiredState of ["empty", "error", "forbidden"]) {
      if (!stateIds.has(requiredState)) {
        addError("STATE_APPLICABILITY_MISSING", `${pageId} 未声明 ${requiredState} 是否适用`);
      }
    }
    const annotationIds = annotations.map((annotation) => annotation.id);
    for (const duplicate of uniqueDuplicates(annotationIds)) {
      addError("ANNOTATION_ID_DUPLICATE", `${pageId} 的标注 ID 重复: ${duplicate}`);
    }
    for (const annotation of annotations) {
      if (![annotation.title, annotation.content].every(hasText)) {
        addError("ANNOTATION_REQUIRED_FIELD", `${pageId}/${annotation.id} 缺少标题或内容`);
      }
      const contentCheck = contentIssues(annotation.content);
      if (!contentCheck.hasBody || contentCheck.empty.length || contentCheck.duplicate.length) {
        addError("ANNOTATION_BODY_INVALID", `${pageId}/${annotation.id} 存在空段落、占位正文或重复维度`);
      }
      if (hasText(annotation.title) && /(必须|不得|不可|不能|需要|应当|应该|不允许)/.test(annotation.title)) {
        addWarning("ANNOTATION_TITLE_RULE_LIKE", `${pageId}/${annotation.id} 的标题“${annotation.title}”包含规则结论，请改为被说明的模块或元素名称，并把规则放入 content`);
      }
      if (!Array.isArray(annotation.requirementRefs) || annotation.requirementRefs.length === 0) {
        addError("ANNOTATION_REQ_MISSING", `${pageId}/${annotation.id} 没有需求引用`);
      }
      for (const requirementId of annotation.requirementRefs || []) {
        if (!requirementIds.has(requirementId)) {
          addError("ANNOTATION_REQ_UNKNOWN", `${pageId}/${annotation.id} 引用了未知需求 ${requirementId}`);
        }
      }
      const anchor = annotation.anchor;
      if (!anchor || !anchor.fallback || !Number.isFinite(anchor.fallback.x) || !Number.isFinite(anchor.fallback.y)) {
        addError("ANNOTATION_ANCHOR_INVALID", `${pageId}/${annotation.id} 缺少有效回退坐标`);
      } else if (anchor.bindingStatus === "fallback-only") {
        addWarning("ANNOTATION_FALLBACK_ONLY", `${pageId}/${annotation.id} 尚未绑定 DOM 锚点`);
      } else if (anchor.bindingStatus === "bound" && !hasText(anchor.anchorId)) {
        addError("ANNOTATION_BOUND_WITHOUT_ID", `${pageId}/${annotation.id} 声明 bound 但没有 anchorId`);
      }
    }
    for (const action of actions) {
      if (![action.id, action.label, action.trigger, action.result, action.failure].every(hasText)) {
        addError("ACTION_REQUIRED_FIELD", `${pageId} 存在操作规格缺少必要字段`);
      }
      if (action.targetPageId && !pageById.has(action.targetPageId)) {
        addError("ACTION_TARGET_UNKNOWN", `${pageId}/${action.id} 的目标页面不存在: ${action.targetPageId}`);
      }
      for (const requirementId of action.requirementRefs || []) {
        if (!requirementIds.has(requirementId)) addError("ACTION_REQ_UNKNOWN", `${pageId}/${action.id} 引用了未知需求 ${requirementId}`);
      }
    }

    const handoffVersion = spec.handoff?.version;
    const isHandoffV2 = ["2.0", "2.1", "2.2"].includes(handoffVersion);
    const isConciseHandoff = handoffVersion === "2.2";
    const isModuleCompleteHandoff = ["2.1", "2.2"].includes(handoffVersion);
    const annotationCoverageScope = isModuleCompleteHandoff
      ? spec.handoff?.annotationPolicy?.coverageScope
      : "full-page";
    const annotatedSections = isModuleCompleteHandoff && annotationCoverageScope === "change-impact"
      ? sections.filter((section) => ["new", "changed", "impacted"].includes(section.changeStatus))
      : sections;
    const sectionIndex = new Map(sections.map(section => [section.id, section]));
    const ownerIndex = new Map([...fields.map(item => [`field:${item.id}`, item]), ...actions.map(item => [`action:${item.id}`, item]), ...states.map(item => [`state:${item.id}`, item])]);
    function targetInScope(item) {
      if (!isConciseHandoff || annotationCoverageScope !== "change-impact") return true;
      const status = item.changeStatus || sectionIndex.get(item.moduleId)?.changeStatus;
      return ["new", "changed", "impacted"].includes(status);
    }
    if (isConciseHandoff) {
      for (const [target, item] of ownerIndex) {
        const globalState = target.startsWith("state:") && !item.moduleId;
        if (!globalState && !sectionIndex.has(item.moduleId)) addError("HANDOFF_TARGET_OWNER_INVALID", `${pageId}/${target} 必须声明有效 moduleId`);
        if (item.changeStatus && (!hasText(item.changeReason) || !["new", "changed", "impacted", "unchanged"].includes(item.changeStatus))) addError("HANDOFF_TARGET_CHANGE_INVALID", `${pageId}/${target} 的变更状态或依据无效`);
        if (annotationCoverageScope === "change-impact" && item.changeStatus && item.changeStatus !== "unchanged" && sectionIndex.get(item.moduleId)?.changeStatus === "unchanged") addError("HANDOFF_TARGET_CHANGE_CONFLICT", `${pageId}/${target} 已变更，但所属模块仍为 unchanged`);
      }
      for (const annotation of annotations) {
        const mirror = prototypePages.get(pageId)?.markers?.find(marker => marker.id === annotation.id);
        if (mirror && ["title", "content"].some(key => key in mirror && mirror[key] !== annotation[key])) addError("ANNOTATION_MIRROR_STALE", `${pageId}/${annotation.id} 的 prototype.json 标注镜像未同步`);
        for (const source of annotation.ruleSources || []) {
          if (source.classification === "explicit" && !source.requirementRefs?.length) addError("ANNOTATION_SOURCE_MISSING", `${pageId}/${annotation.id} 的明确规则缺少来源`);
          if (source.classification !== "explicit" && !hasText(source.note)) addError("ANNOTATION_SOURCE_NOTE_MISSING", `${pageId}/${annotation.id} 的非明确规则必须说明依据或不确定性`);
          for (const ref of source.requirementRefs || []) if (!requirementIds.has(ref) || !annotation.requirementRefs?.includes(ref)) addError("ANNOTATION_SOURCE_REF_INVALID", `${pageId}/${annotation.id} 的规则来源引用无效或超出本标注需求范围`);
          if (!contentIssues(annotation.content).populated.has(source.dimension)) addError("ANNOTATION_SOURCE_DIMENSION_INVALID", `${pageId}/${annotation.id} 的来源维度没有对应正文`);
        }
      }
      const seenContent = new Set();
      for (const annotation of annotations) {
        const normalized = String(annotation.content).replace(/\s/g, "");
        if (seenContent.has(normalized)) addWarning("ANNOTATION_CONTENT_DUPLICATE", `${pageId}/${annotation.id} 与同页标注正文相同，请复核模块边界`);
        seenContent.add(normalized);
      }
    }
    if (!isHandoffV2) {
      addWarning("HANDOFF_COVERAGE_LEGACY", `${pageId} 尚未升级为开发交付说明 v2，当前标注不保证覆盖全部字段、操作和状态`);
    } else {
      const validTargets = new Set([
        ...sections.map((section) => `section:${section.id}`),
        ...fields.map((field) => `field:${field.id}`),
        ...actions.map((action) => `action:${action.id}`),
        ...states.map((state) => `state:${state.id}`),
      ]);
      const requiredTargets = new Set([
        ...annotatedSections.map((section) => `section:${section.id}`),
        ...fields.filter(targetInScope).map((field) => `field:${field.id}`),
        ...actions.filter(targetInScope).map((action) => `action:${action.id}`),
        ...states.filter((state) => state.applicable && (!isConciseHandoff || state.moduleId) && targetInScope(state)).map((state) => `state:${state.id}`),
      ]);
      const coveredTargets = new Set();

      for (const annotation of annotations) {
        if (!Array.isArray(annotation.covers) || annotation.covers.length === 0) {
          addError("HANDOFF_COVERS_MISSING", `${pageId}/${annotation.id} 未声明 covers，无法验证说明覆盖范围`);
        }
        if (!hasText(annotation.content)) {
          addError("HANDOFF_CONTENT_MISSING", `${pageId}/${annotation.id} 缺少标注内容，不能作为开发交付说明`);
        }
        for (const target of annotation.covers || []) {
          if (!validTargets.has(target)) {
            addError("HANDOFF_COVERAGE_TARGET_UNKNOWN", `${pageId}/${annotation.id} 覆盖了不存在的对象 ${target}`);
          } else {
            coveredTargets.add(target);
            const owner = ownerIndex.get(target);
            if (isConciseHandoff && owner?.moduleId && annotation.moduleId !== owner.moduleId) addError("HANDOFF_CROSS_MODULE_COVERAGE", `${pageId}/${annotation.id} 跨模块覆盖 ${target}`);
            if (isConciseHandoff && owner && !targetInScope(owner)) addError("HANDOFF_UNCHANGED_TARGET_ANNOTATED", `${pageId}/${annotation.id} 为未改对象 ${target} 生成了覆盖`);
          }
        }
      }

      for (const target of requiredTargets) {
        if (!coveredTargets.has(target)) {
          addError("HANDOFF_COVERAGE_MISSING", `${pageId} 的 ${target} 没有任何页面说明覆盖`);
        }
      }

      if (isModuleCompleteHandoff) {
        const policy = spec.handoff.annotationPolicy;
        if (!policy
          || policy.strategy !== "module-complete"
          || policy.moduleSource !== "sections"
          || !["full-page", "change-impact"].includes(policy.coverageScope)
          || !Array.isArray(policy.requiredDimensions)
          || (!isConciseHandoff && !policy.requiredDimensions.includes("definition"))
          || !Number.isInteger(policy.minimumApplicableDimensions)
          || policy.minimumApplicableDimensions < (isConciseHandoff ? 1 : 3)) {
          addError("HANDOFF_MODULE_POLICY_INVALID", `${pageId} 的 annotationPolicy 不符合 ${handoffVersion} 标注规则`);
        }

        const minimumDimensions = Number.isInteger(policy?.minimumApplicableDimensions)
          ? policy.minimumApplicableDimensions
          : 3;
        const sectionIds = new Set(sections.map((section) => section.id));
        const requiredModuleSectionIds = new Set(annotatedSections.map((section) => section.id));
        const moduleAnnotations = annotations.filter((annotation) => annotation.scope === "module");
        const moduleCounts = new Map();
        const currentPrototypePage = prototypePages.get(pageId);
        let htmlAnchorIds = null;
        if (currentPrototypePage?.path) {
          const htmlPath = path.join(projectDir, currentPrototypePage.path);
          if (fs.existsSync(htmlPath)) {
            const html = fs.readFileSync(htmlPath, "utf8");
            htmlAnchorIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
          }
        }

        for (const annotation of annotations) {
          if (!["module", "page", "element"].includes(annotation.scope)) {
            addError("HANDOFF_ANNOTATION_SCOPE_INVALID", `${pageId}/${annotation.id} 的模块标注缺少有效 scope`);
          }
        }

        if (policy?.coverageScope === "change-impact") {
          for (const section of sections) {
            if (!["new", "changed", "impacted", "unchanged"].includes(section.changeStatus) || !hasText(section.changeReason)) {
              addError("HANDOFF_SECTION_CHANGE_STATUS_INVALID", `${pageId}/section:${section.id} 缺少有效 changeStatus 或 changeReason`);
            }
          }
        }

        for (const annotation of moduleAnnotations) {
          if (!hasText(annotation.moduleId) || !sectionIds.has(annotation.moduleId)) {
            addError("HANDOFF_MODULE_ID_INVALID", `${pageId}/${annotation.id} 的 moduleId 未对应 sections 中的模块`);
            continue;
          }
          moduleCounts.set(annotation.moduleId, (moduleCounts.get(annotation.moduleId) || 0) + 1);
          if (policy?.coverageScope === "change-impact" && !requiredModuleSectionIds.has(annotation.moduleId)) {
            addError("HANDOFF_UNCHANGED_MODULE_ANNOTATED", `${pageId}/${annotation.id} 为未改模块 ${annotation.moduleId} 生成了标注`);
          }

          const sectionTargets = (annotation.covers || []).filter((target) => target.startsWith("section:"));
          if (sectionTargets.length !== 1 || sectionTargets[0] !== `section:${annotation.moduleId}`) {
            addError("HANDOFF_MODULE_SECTION_MISMATCH", `${pageId}/${annotation.id} 必须且只能覆盖自身模块 section:${annotation.moduleId}`);
          }

          const contentDimensions = contentIssues(annotation.content).populated;
          const required = [...(policy?.requiredDimensions || []), ...(annotation.requiredDimensions || [])];
          const substantiveDimensions = [...contentDimensions].filter(key => key !== "docs").length;
          if (required.some(key => !Object.hasOwn(dimensions, key) || !contentDimensions.has(key)) || (!isConciseHandoff && !contentDimensions.has("definition")) || substantiveDimensions < minimumDimensions) {
            addError("HANDOFF_MODULE_CONTENT_DIMENSIONS_INCOMPLETE", `${pageId}/${annotation.id} 缺少声明的必需维度或有效正文；最低 ${minimumDimensions} 个适用维度`);
          }

          if (annotation.anchor?.bindingStatus !== "bound" || annotation.anchor?.anchorId !== annotation.moduleId) {
            addError("HANDOFF_MODULE_ANCHOR_MISMATCH", `${pageId}/${annotation.id} 的主锚点必须绑定模块自身 DOM ID ${annotation.moduleId}`);
          } else if (htmlAnchorIds && !htmlAnchorIds.has(annotation.moduleId)) {
            addError("HANDOFF_MODULE_ANCHOR_NOT_FOUND", `${pageId}/${annotation.id} 声明的模块 DOM ID 不存在于页面 HTML：${annotation.moduleId}`);
          }
        }

        for (const section of annotatedSections) {
          const count = moduleCounts.get(section.id) || 0;
          if (count === 0) {
            addError("HANDOFF_MODULE_ANNOTATION_MISSING", `${pageId}/section:${section.id} 没有独立的模块主标注`);
          } else if (count > 1) {
            addError("HANDOFF_MODULE_ANNOTATION_DUPLICATE", `${pageId}/section:${section.id} 存在 ${count} 条模块主标注，应保持一一对应`);
          }
        }
      }

      for (const field of fields.filter((item) => ["select", "multi-select"].includes(item.controlType))) {
        if ((!Array.isArray(field.options) || field.options.length === 0) && !hasText(field.dataSource)) {
          addError("HANDOFF_FIELD_OPTIONS_MISSING", `${pageId}/${field.id} 是选择型字段，但没有选项或动态数据来源说明`);
        }
      }
      for (const action of actions) {
        if (!Array.isArray(action.logic) || action.logic.length === 0 || action.logic.some((item) => !hasText(item))) {
          addError("HANDOFF_ACTION_LOGIC_MISSING", `${pageId}/${action.id} 缺少可执行的操作逻辑说明`);
        }
      }
      if (!Array.isArray(spec.handoff.coverageDimensions) || spec.handoff.coverageDimensions.length < (isConciseHandoff ? 1 : 6)) {
        addError("HANDOFF_DIMENSIONS_INCOMPLETE", `${pageId} 的开发交付说明覆盖维度不足`);
      }
      const requiredHandoffDimensions = isConciseHandoff ? ["acceptance"] : ["roles", "preconditions", "acceptance"];
      for (const dimension of requiredHandoffDimensions) {
        if (!spec.handoff.coverageDimensions?.includes(dimension)) {
          addError("HANDOFF_DIMENSION_MISSING", `${pageId} 的开发交付说明未声明 ${dimension} 覆盖维度`);
        }
      }

      const pageOverview = spec.handoff.pageOverview;
      if (!pageOverview && !isConciseHandoff) {
        addError("HANDOFF_OVERVIEW_MISSING", `${pageId} 缺少页面目的之外的角色、入口、出口和前置条件`);
      } else if (pageOverview) {
        for (const groupName of ["roles", "entries", "exits", "preconditions"]) {
          const items = pageOverview[groupName];
          if (isConciseHandoff && (items === undefined || (Array.isArray(items) && items.length === 0))) continue;
          if (!Array.isArray(items) || items.length === 0) {
            addError("HANDOFF_OVERVIEW_GROUP_MISSING", `${pageId} 的 pageOverview.${groupName} 不能为空`);
            continue;
          }
          for (const item of items) {
            if (!hasText(item.label) || (!isConciseHandoff && !hasText(item.description))) {
              addError("HANDOFF_OVERVIEW_ITEM_INVALID", `${pageId} 的 pageOverview.${groupName} 存在缺少名称或说明的条目`);
            }
            for (const requirementId of item.requirementRefs || []) {
              if (!requirementIds.has(requirementId)) {
                addError("HANDOFF_OVERVIEW_REQ_UNKNOWN", `${pageId} 的 pageOverview.${groupName} 引用了未知需求 ${requirementId}`);
              }
            }
          }
        }
      }

      if (!Array.isArray(spec.handoff.statusTransitions)) {
        addError("HANDOFF_STATUS_TRANSITIONS_MISSING", `${pageId} 未声明 statusTransitions；没有业务状态变化时应使用空数组`);
      } else {
        for (const duplicate of uniqueDuplicates(spec.handoff.statusTransitions.map((item) => item.id))) {
          addError("HANDOFF_STATUS_TRANSITION_DUPLICATE", `${pageId} 的状态变化 ID 重复: ${duplicate}`);
        }
        for (const transition of spec.handoff.statusTransitions) {
          if (![transition.id, transition.from, transition.trigger, transition.to, transition.rule].every(hasText)) {
            addError("HANDOFF_STATUS_TRANSITION_INVALID", `${pageId} 存在缺少必要字段的状态变化`);
          }
          if (!Array.isArray(transition.requirementRefs) || transition.requirementRefs.length === 0) {
            addError("HANDOFF_STATUS_TRANSITION_REQ_MISSING", `${pageId}/${transition.id} 没有需求引用`);
          }
          for (const requirementId of transition.requirementRefs || []) {
            if (!requirementIds.has(requirementId)) {
              addError("HANDOFF_STATUS_TRANSITION_REQ_UNKNOWN", `${pageId}/${transition.id} 引用了未知需求 ${requirementId}`);
            }
          }
        }
      }

      const acceptanceCriteria = spec.handoff.acceptanceCriteria;
      if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
        addError("HANDOFF_ACCEPTANCE_MISSING", `${pageId} 缺少结构化验收标准`);
      } else {
        for (const duplicate of uniqueDuplicates(acceptanceCriteria.map((item) => item.id))) {
          addError("HANDOFF_ACCEPTANCE_DUPLICATE", `${pageId} 的验收标准 ID 重复: ${duplicate}`);
        }
        for (const criterion of acceptanceCriteria) {
          if (![criterion.id, criterion.title, criterion.given, criterion.when, criterion.then].every(hasText)) {
            addError("HANDOFF_ACCEPTANCE_INVALID", `${pageId} 存在缺少前置、操作或预期结果的验收标准`);
          }
          if (!Array.isArray(criterion.requirementRefs) || criterion.requirementRefs.length === 0) {
            addError("HANDOFF_ACCEPTANCE_REQ_MISSING", `${pageId}/${criterion.id} 没有需求引用`);
          }
          for (const requirementId of criterion.requirementRefs || []) {
            if (!requirementIds.has(requirementId)) {
              addError("HANDOFF_ACCEPTANCE_REQ_UNKNOWN", `${pageId}/${criterion.id} 引用了未知需求 ${requirementId}`);
            }
          }
        }
      }

      for (const question of spec.openQuestions || []) {
        if (typeof question === "string") {
          addError("HANDOFF_OPEN_QUESTION_LEGACY", `${pageId} 的待确认事项仍是纯文本，缺少影响、状态和当前假设`);
          continue;
        }
        if (![question.id, question.question, question.impact, question.status].every(hasText)
          || !["open", "confirmed", "rejected"].includes(question.status)) {
          addError("HANDOFF_OPEN_QUESTION_INVALID", `${pageId} 存在结构不完整的待确认事项`);
        }
        for (const requirementId of question.requirementRefs || []) {
          if (!requirementIds.has(requirementId)) {
            addError("HANDOFF_OPEN_QUESTION_REQ_UNKNOWN", `${pageId}/${question.id} 引用了未知需求 ${requirementId}`);
          }
        }
      }
      if (!Array.isArray(spec.handoff.relatedDocs) || spec.handoff.relatedDocs.length === 0) {
        addWarning("HANDOFF_RELATED_DOCS_MISSING", `${pageId} 未提供关联需求或接口文档入口`);
      }
    }
    if ((spec.openQuestions || []).length > 0) {
      addWarning("SPEC_OPEN_QUESTIONS", `${pageId} 仍有 ${spec.openQuestions.length} 个待确认项`);
    }

    const prototypePage = prototypePages.get(pageId);
    if (prototypePage) {
      const markerIds = new Set((prototypePage.markers || []).map((marker) => marker.id));
      const specAnnotationIds = new Set(annotationIds);
      for (const annotationId of specAnnotationIds) {
        if (!markerIds.has(annotationId)) addWarning("PROTOTYPE_MARKER_MISSING", `${pageId}/${annotationId} 尚未写入 prototype.json`);
      }
      for (const markerId of markerIds) {
        if (!specAnnotationIds.has(markerId)) addWarning("SPEC_ANNOTATION_MISSING", `${pageId}/${markerId} 尚未写入 page spec`);
      }
    }
  }

  const reportPath = path.join(intermediateDir, "validation-report.md");
  const timestamp = new Date().toISOString();
  const renderItems = (items) => items.length
    ? items.map((item) => `- \`${item.code}\`：${item.message}`).join("\n")
    : "- 无";
  const report = [
    "# PRD 原型生成验证报告",
    "",
    `- 运行时间：${timestamp}`,
    `- 项目目录：\`${path.relative(process.cwd(), projectDir).split(path.sep).join("/") || "."}\``,
    `- 结果：${errors.length === 0 ? "通过" : "失败"}`,
    `- 需求数：${requirements.length}`,
    `- 页面地图：${pages.length} 页，其中 ${(pages.filter((page) => page.implementationStatus === "built")).length} 页已生成`,
    `- 页面定义确认：${pageBriefGateResult.status}`,
    `- 页面规格：${specs.size} 份`,
    `- 错误：${errors.length}`,
    `- 警告：${warnings.length}`,
    "",
    "## 错误",
    "",
    renderItems(errors),
    "",
    "## 警告",
    "",
    renderItems(warnings),
    "",
    "## 说明",
    "",
    "本报告验证结构完整性、引用关系和交付入口，不替代产品确认、视觉评审、可用性测试或生产安全审查。",
    ""
  ].join("\n");
  fs.mkdirSync(intermediateDir, { recursive: true });
  fs.writeFileSync(reportPath, report, "utf8");

  console.log(`${errors.length === 0 ? "PASS" : "FAIL"}: ${errors.length} 个错误，${warnings.length} 个警告`);
  console.log(`报告: ${reportPath}`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
