#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validateSchema, formatSchemaErrors } = require("./lib/schema-validator");

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function fileHash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseArgs(argv) {
  const args = { project: null };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--project") {
      args.project = argv[index + 1];
      index += 1;
    } else if (["--help", "-h"].includes(argv[index])) {
      console.log("用法: node check_page_brief_gate.js --project <原型目录>");
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${argv[index]}`);
    }
  }
  if (!args.project) throw new Error("缺少 --project 参数（请指向原型目录）");
  return args;
}

function isIsoDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function normalizeQuote(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[“”"'`]/g, "");
}

function inspectBriefDocument(filePath, document, pageId) {
  const errors = [];
  const source = fs.readFileSync(filePath, "utf8");
  const headings = [...source.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim());
  const hasHeading = (pattern) => headings.some((heading) => pattern.test(heading));
  if (!headings.some((heading) => heading.length > 0)) {
    errors.push("缺少页面标题");
  }
  if (!hasHeading(/(?:页面|模块)?(?:定位|目标|概述)/)) {
    errors.push("缺少页面定位或目标章节");
  }
  if (!hasHeading(/(?:页面|模块|功能|信息)?(?:结构|架构)/)) {
    errors.push("缺少页面功能结构或信息架构章节");
  }
  if (!hasHeading(/原型制作|制作说明|开发逻辑|交互(?:与路由)?|关键交互/)) {
    errors.push("缺少原型制作、开发逻辑或关键交互章节");
  }
  if (!hasHeading(/内容|数据|取数|字段/)) errors.push("缺少内容、数据或字段规则章节");
  if (!hasHeading(/状态|降级|异常|验收/)) errors.push("缺少页面状态、降级或验收章节");
  const plainText = source
    .replace(/^---[\s\S]*?^---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plainText.length < 400) errors.push("页面说明过短，至少需要定位、功能结构、数据、交互、状态和原型制作说明");
  if (!source.includes(pageId)) errors.push(`文档正文未声明对应页面 ID：${pageId}`);
  if (document.origin === "generated") {
    if (!new RegExp(`^page_id:\\s*["']?${pageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\s*$`, "m").test(source)) {
      errors.push("技能生成的页面 MD 缺少与 pageId 一致的 frontmatter page_id");
    }
    if (/用简洁语言说明|说明主要展示字段|列出主要状态/.test(source)) {
      errors.push("页面 MD 仍包含未填写的模板提示语");
    }
  }
  return errors;
}

function inspectPageBriefGate(projectDir, options = {}) {
  const absoluteProjectDir = path.resolve(projectDir);
  const intermediateDir = path.join(absoluteProjectDir, "intermediate");
  const gatePath = path.join(intermediateDir, "page-brief-gate.json");
  const pageMapPath = path.join(intermediateDir, "page-map.json");
  const schemasDir = options.schemasDir || path.resolve(__dirname, "../schemas");
  const errors = [];
  const warnings = [];
  const addError = (code, message) => errors.push({ code, message });
  const addWarning = (code, message) => warnings.push({ code, message });

  if (!fs.existsSync(gatePath)) {
    const message = "缺少 intermediate/page-brief-gate.json；页面定义确认默认开启，不能直接进入原型制作";
    if (options.allowLegacyMissing) addWarning("PAGE_BRIEF_GATE_LEGACY_MISSING", message);
    else addError("PAGE_BRIEF_GATE_MISSING", message);
    return { errors, warnings, status: "missing", gatePath };
  }
  if (!fs.existsSync(pageMapPath)) {
    addError("PAGE_BRIEF_PAGE_MAP_MISSING", "页面定义确认依赖 intermediate/page-map.json");
    return { errors, warnings, status: "invalid", gatePath };
  }

  let gate;
  let pageMap;
  try {
    gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
  } catch (error) {
    addError("PAGE_BRIEF_GATE_INVALID", `page-brief-gate.json 无法解析：${error.message}`);
    return { errors, warnings, status: "invalid", gatePath };
  }
  try {
    pageMap = JSON.parse(fs.readFileSync(pageMapPath, "utf8"));
  } catch (error) {
    addError("PAGE_BRIEF_PAGE_MAP_INVALID", `page-map.json 无法解析：${error.message}`);
    return { errors, warnings, status: "invalid", gatePath };
  }

  const schemaChecks = [
    ["page-brief-gate.schema.json", gate, "page-brief-gate.json"],
    ["page-map.schema.json", pageMap, "page-map.json"]
  ];
  for (const [schemaName, data, label] of schemaChecks) {
    const schemaPath = path.join(schemasDir, schemaName);
    if (!fs.existsSync(schemaPath)) {
      addError("PAGE_BRIEF_SCHEMA_MISSING", `缺少校验模型：${schemaPath}`);
      continue;
    }
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    for (const message of formatSchemaErrors(`${label}`, validateSchema(schema, data))) {
      addError("PAGE_BRIEF_SCHEMA_INVALID", message);
    }
  }

  const requirementsPath = path.resolve(intermediateDir, pageMap.requirementsPath || "requirements.json");
  let requirements;
  if (!fs.existsSync(requirementsPath)) {
    addError("PAGE_BRIEF_REQUIREMENTS_MISSING", `页面地图引用的需求模型不存在：${pageMap.requirementsPath || "requirements.json"}`);
  } else {
    try {
      requirements = JSON.parse(fs.readFileSync(requirementsPath, "utf8"));
      const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, "requirements.schema.json"), "utf8"));
      for (const message of formatSchemaErrors("requirements.json", validateSchema(schema, requirements))) {
        addError("PAGE_BRIEF_SCHEMA_INVALID", message);
      }
    } catch (error) {
      addError("PAGE_BRIEF_REQUIREMENTS_INVALID", `requirements.json 无法解析或校验：${error.message}`);
    }
  }

  if (requirements) {
    if (pageMap.requirementsSha256 !== fileHash(requirementsPath)) {
      addError("PAGE_MAP_REQUIREMENTS_CHANGED", "requirements.json 已在页面地图确认后变更，必须重新确认页面范围");
    }
    const sourceById = new Map();
    for (const sourceDocument of requirements.sourceDocuments || []) {
      if (sourceById.has(sourceDocument.id)) {
        addError("REQUIREMENTS_SOURCE_DUPLICATE", `来源文档 ID 重复：${sourceDocument.id}`);
        continue;
      }
      sourceById.set(sourceDocument.id, sourceDocument);
      const sourcePath = path.resolve(intermediateDir, sourceDocument.path || "");
      if (!fs.existsSync(sourcePath)) {
        addError("REQUIREMENTS_SOURCE_MISSING", `来源文档不存在：${sourceDocument.path}`);
      } else if (!/^[a-f0-9]{64}$/.test(sourceDocument.sha256 || "") || sourceDocument.sha256 !== fileHash(sourcePath)) {
        addError("REQUIREMENTS_SOURCE_CHANGED", `${sourceDocument.id} 的来源文档哈希缺失或已变化，必须重新抽取需求`);
      }
    }
    for (const requirement of requirements.requirements || []) {
      for (const sourceRef of requirement.sourceRefs || []) {
        const sourceDocument = sourceById.get(sourceRef.documentId);
        if (!sourceDocument) {
          addError("REQUIREMENTS_SOURCE_REF_UNKNOWN", `${requirement.id} 引用了不存在的来源 ${sourceRef.documentId}`);
          continue;
        }
        const sourcePath = path.resolve(intermediateDir, sourceDocument.path);
        if (!fs.existsSync(sourcePath)) continue;
        const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/);
        if (sourceRef.endLine > lines.length || sourceRef.startLine > sourceRef.endLine) {
          addError("REQUIREMENTS_SOURCE_REF_RANGE", `${requirement.id} 的来源行号超出 ${sourceDocument.id} 范围`);
          continue;
        }
        const slice = normalizeQuote(lines.slice(sourceRef.startLine - 1, sourceRef.endLine).join("\n"));
        if (!slice.includes(normalizeQuote(sourceRef.quote))) {
          addError("REQUIREMENTS_SOURCE_REF_QUOTE", `${requirement.id} 的引用原文与 ${sourceDocument.id}:${sourceRef.startLine}-${sourceRef.endLine} 不一致`);
        }
      }
    }
  }

  if (pageMap.confirmation?.status !== "confirmed"
    || pageMap.confirmation?.confirmedBy !== "user"
    || !hasText(pageMap.confirmation?.evidence)
    || !isIsoDate(pageMap.confirmation?.confirmedAt)) {
    addError("PAGE_MAP_UNCONFIRMED", "页面地图必须记录用户确认、确认依据和有效日期后才能进入逐页定义关卡");
  }
  if (gate.pageMapSha256 !== fileHash(pageMapPath)) {
    addError("PAGE_BRIEF_PAGE_MAP_CHANGED", "page-map.json 已在逐页文档确认后变更，必须重新确认逐页定义");
  }
  if (gate.schemaVersion !== "1.0" || typeof gate.enabled !== "boolean") {
    addError("PAGE_BRIEF_GATE_REQUIRED_FIELD", "页面定义关卡缺少 schemaVersion=1.0 或 enabled 开关");
  }

  if (gate.enabled === false) {
    if (gate.status !== "bypassed") {
      addError("PAGE_BRIEF_GATE_BYPASS_STATUS", "关闭页面定义确认时 status 必须为 bypassed");
    }
    if (gate.bypass?.confirmedBy !== "user"
      || !hasText(gate.bypass?.reason)
      || !hasText(gate.bypass?.evidence)
      || !isIsoDate(gate.bypass?.confirmedAt)) {
      addError("PAGE_BRIEF_GATE_BYPASS_EVIDENCE", "关闭开关必须记录用户明确授权、原因、证据和确认时间");
    }
    return { errors, warnings, status: errors.length ? "invalid" : "bypassed", gatePath };
  }

  if (gate.status !== "confirmed") {
    addError("PAGE_BRIEF_GATE_UNCONFIRMED", `页面定义关卡当前为 ${gate.status || "未声明"}，必须逐页确认后才能制作原型`);
  }

  const expectedPageIds = (pageMap.pages || [])
    .filter((page) => ["built", "planned"].includes(page.implementationStatus))
    .map((page) => page.id)
    .sort();
  const targetPageIds = Array.isArray(gate.targetPageIds) ? [...gate.targetPageIds].sort() : [];
  const duplicates = targetPageIds.filter((pageId, index) => targetPageIds.indexOf(pageId) !== index);
  if (duplicates.length > 0) {
    addError("PAGE_BRIEF_TARGET_DUPLICATE", `页面定义关卡存在重复页面：${[...new Set(duplicates)].join("、")}`);
  }
  const missingTargets = expectedPageIds.filter((pageId) => !targetPageIds.includes(pageId));
  const extraTargets = targetPageIds.filter((pageId) => !expectedPageIds.includes(pageId));
  if (missingTargets.length || extraTargets.length) {
    addError("PAGE_BRIEF_TARGET_MISMATCH", `关卡页面与本轮 built/planned 页面不一致；缺少：${missingTargets.join("、") || "无"}；多出：${extraTargets.join("、") || "无"}`);
  }

  const documents = Array.isArray(gate.documents) ? gate.documents : [];
  const resolvedDocumentPaths = new Map();
  for (const pageId of targetPageIds) {
    const matches = documents.filter((document) => document.pageId === pageId);
    if (matches.length !== 1) {
      addError("PAGE_BRIEF_DOCUMENT_COUNT", `${pageId} 必须且只能登记一份独立页面 MD，当前为 ${matches.length} 份`);
      continue;
    }
    const document = matches[0];
    if (!hasText(document.path) || !["generated", "provided"].includes(document.origin)) {
      addError("PAGE_BRIEF_DOCUMENT_REQUIRED_FIELD", `${pageId} 的页面 MD 缺少路径或 origin`);
      continue;
    }
    const documentPath = path.resolve(intermediateDir, document.path);
    if (resolvedDocumentPaths.has(documentPath)) {
      addError("PAGE_BRIEF_DOCUMENT_PATH_DUPLICATE", `${pageId} 与 ${resolvedDocumentPaths.get(documentPath)} 复用了同一份页面 MD；每个页面必须独立定义`);
    } else {
      resolvedDocumentPaths.set(documentPath, pageId);
    }
    if (!fs.existsSync(documentPath)) {
      addError("PAGE_BRIEF_DOCUMENT_MISSING", `${pageId} 的页面 MD 不存在：${document.path}`);
      continue;
    }
    if (path.extname(documentPath).toLowerCase() !== ".md") {
      addError("PAGE_BRIEF_DOCUMENT_NOT_MARKDOWN", `${pageId} 的页面定义必须是独立 MD 文档`);
    }
    for (const issue of inspectBriefDocument(documentPath, document, pageId)) {
      addError("PAGE_BRIEF_DOCUMENT_INCOMPLETE", `${pageId}/${document.path}：${issue}`);
    }
    if (document.status !== "confirmed"
      || document.confirmedBy !== "user"
      || !isIsoDate(document.confirmedAt)
      || !hasText(document.confirmationEvidence)) {
      addError("PAGE_BRIEF_DOCUMENT_UNCONFIRMED", `${pageId} 的页面 MD 尚未记录用户确认`);
    }
    if (document.openQuestionsResolved !== true) {
      addError("PAGE_BRIEF_OPEN_QUESTIONS", `${pageId} 仍有未关闭的页面结构问题，不能进入原型制作`);
    }
    const actualHash = fileHash(documentPath);
    if (!/^[a-f0-9]{64}$/.test(document.sha256 || "") || document.sha256 !== actualHash) {
      addError("PAGE_BRIEF_DOCUMENT_CHANGED", `${pageId} 的页面 MD 哈希与确认记录不一致，文档变更后必须重新确认`);
    }
  }

  for (const document of documents) {
    if (!targetPageIds.includes(document.pageId)) {
      addError("PAGE_BRIEF_DOCUMENT_EXTRA", `页面定义关卡登记了非本轮页面：${document.pageId}`);
    }
  }

  return { errors, warnings, status: errors.length ? "invalid" : "confirmed", gatePath };
}

function runCli() {
  const args = parseArgs(process.argv);
  const result = inspectPageBriefGate(path.resolve(process.cwd(), args.project));
  for (const error of result.errors) console.error(`- [${error.code}] ${error.message}`);
  for (const warning of result.warnings) console.warn(`- [${warning.code}] ${warning.message}`);
  if (result.errors.length > 0) {
    console.error(`BLOCKED: 页面定义确认关卡未通过（${result.errors.length} 项）`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: 页面定义确认关卡已${result.status === "bypassed" ? "由用户关闭" : "逐页确认"}`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { inspectPageBriefGate };
