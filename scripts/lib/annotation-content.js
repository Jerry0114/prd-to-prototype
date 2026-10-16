const dimensions = {
  definition: ["模块定义", "页面定义", "对象定义", "定义"],
  content: ["展示内容", "内容说明", "操作构成", "菜单结构", "列结构", "单项结构", "正文结构", "卡片内容", "卡片结构", "单元内容", "提示内容", "素材规格", "内容", "展示"],
  data: ["数据规则", "取数规则", "取数与排序", "筛选参数", "内容映射", "内容来源", "栏目映射", "投放规则", "顺序规则", "数据"],
  interaction: ["交互逻辑", "交互规则", "全局操作", "搜索与折叠", "查询结果", "返回逻辑", "字号与分享", "栏目跳转", "行内操作", "文章跳转", "点击与关闭", "模块跳转", "轮播与跳转", "跳转逻辑", "交互"],
  state: ["异常与状态", "状态与异常", "异常处理", "状态说明", "状态处理", "失效处理", "降级处理", "局部异常", "加载与异常", "不足处理", "状态"],
  layout: ["布局规则", "布局说明", "响应式规则", "触控规则", "字号关系", "阅读字阶", "视觉规则", "位置规则", "横滑规则", "布局"],
  compliance: ["合规规则", "合规说明", "合规"],
  docs: ["关联文档"],
};
const headingDimensions = new Map(Object.entries(dimensions).flatMap(([key, labels]) => labels.map(label => [label, key])));
const placeholders = /^(?:待补充|待完善|TODO|TBD|暂无说明|同上|略|[.。…-]+)$/i;
function useful(value) { return typeof value === "string" && value.trim().length > 0 && !placeholders.test(value.trim()); }

// Unknown/free-text blocks remain intact for non-destructive merges.
function parseContent(value) {
  const result = [];
  for (const block of String(value || "").replace(/\r\n/g, "\n").trim().split(/\n\s*\n/).filter(Boolean)) {
    let current = null;
    for (const line of block.split("\n")) {
      const dimension = headingDimensions.get(line.trim());
      if (dimension) {
        if (current) result.push(current);
        current = { dimension, heading: line.trim(), body: "" };
      } else {
        current ||= { dimension: null, heading: null, body: "" };
        current.body += (current.body ? "\n" : "") + line;
      }
    }
    if (current) result.push(current);
  }
  return result.map(item => ({ ...item, body: item.body.trim() }));
}
function renderContent(parts) {
  return parts.map(part => part.heading ? part.heading + "\n" + part.body : part.body).join("\n\n");
}
function contentIssues(value) {
  const parts = parseContent(value);
  const empty = parts.filter(part => !useful(part.body));
  const populated = new Set(parts.filter(part => part.dimension && useful(part.body)).map(part => part.dimension));
  const duplicate = [...new Set(parts.filter(part => part.dimension).map(part => part.dimension))]
    .filter(key => parts.filter(part => part.dimension === key).length > 1);
  return { empty, populated, duplicate, hasBody: parts.some(part => useful(part.body)) };
}
const moduleFields = { contentRule: "definition", content: "content", data: "data", interaction: "interaction", state: "state", layout: "layout", compliance: "compliance", docs: "docs" };
function mergeContent(previous, module) {
  const replacements = new Map();
  for (const [field, dimension] of Object.entries(moduleFields)) {
    if (!Object.hasOwn(module, field)) continue;
    if (!useful(module[field])) throw new Error(field + " 为空或占位；省略该字段以保留原文，删除请显式使用 removeDimensions");
    replacements.set(dimension, { dimension, heading: dimensions[dimension][0], body: module[field].trim() });
  }
  const removals = module.removeDimensions || [];
  if (!Array.isArray(removals) || removals.some(key => !Object.hasOwn(dimensions, key) || replacements.has(key))) {
    throw new Error("removeDimensions 无效或与更新字段冲突");
  }
  const output = [];
  for (const part of parseContent(previous)) {
    if (removals.includes(part.dimension)) continue;
    if (replacements.has(part.dimension)) {
      output.push(replacements.get(part.dimension));
      replacements.delete(part.dimension);
    } else output.push(part);
  }
  output.push(...replacements.values());
  const content = renderContent(output);
  const issues = contentIssues(content);
  if (!issues.hasBody || issues.empty.length || issues.duplicate.length) throw new Error("合并后存在空正文、占位或重复维度");
  return content;
}
module.exports = { dimensions, useful, parseContent, contentIssues, mergeContent };
