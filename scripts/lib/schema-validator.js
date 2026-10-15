const { isDeepStrictEqual } = require("node:util");

function validateSchema(schema, data) {
  const errors = [];

  function fail(path, message) {
    errors.push({ path, message });
  }

  function resolveRef(ref) {
    if (!ref.startsWith("#/")) throw new Error(`仅支持本地 JSON Schema 引用：${ref}`);
    return ref
      .slice(2)
      .split("/")
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((value, key) => value?.[key], schema);
  }

  function matchesType(type, value) {
    if (type === "null") return value === null;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
    if (type === "integer") return Number.isInteger(value);
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === type;
  }

  function visit(rule, value, path, collector = errors) {
    if (!rule || typeof rule !== "object") return;

    if (rule.$ref) {
      const target = resolveRef(rule.$ref);
      if (!target) {
        collector.push({ path, message: `无法解析引用 ${rule.$ref}` });
        return;
      }
      visit(target, value, path, collector);
    }

    if (rule.oneOf) {
      const matches = rule.oneOf.filter((candidate) => {
        const branchErrors = [];
        visit(candidate, value, path, branchErrors);
        return branchErrors.length === 0;
      });
      if (matches.length !== 1) {
        collector.push({ path, message: `必须且只能匹配 oneOf 中的一个分支，当前匹配 ${matches.length} 个` });
        return;
      }
    }

    if (Object.prototype.hasOwnProperty.call(rule, "const") && !isDeepStrictEqual(value, rule.const)) {
      collector.push({ path, message: `必须等于 ${JSON.stringify(rule.const)}` });
    }
    if (rule.enum && !rule.enum.some((item) => isDeepStrictEqual(item, value))) {
      collector.push({ path, message: `必须为 ${rule.enum.map((item) => JSON.stringify(item)).join("、")} 之一` });
    }

    if (rule.type) {
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (!types.some((type) => matchesType(type, value))) {
        collector.push({ path, message: `类型应为 ${types.join("/")}` });
        return;
      }
    }

    if (typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        collector.push({ path, message: `长度不能小于 ${rule.minLength}` });
      }
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
        collector.push({ path, message: `不符合格式 ${rule.pattern}` });
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      if (rule.minimum !== undefined && value < rule.minimum) collector.push({ path, message: `不能小于 ${rule.minimum}` });
      if (rule.maximum !== undefined && value > rule.maximum) collector.push({ path, message: `不能大于 ${rule.maximum}` });
    }

    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) {
        collector.push({ path, message: `数组项不能少于 ${rule.minItems}` });
      }
      if (rule.uniqueItems) {
        value.forEach((item, index) => {
          if (value.slice(0, index).some((previous) => isDeepStrictEqual(previous, item))) {
            collector.push({ path: `${path}[${index}]`, message: "数组项必须唯一" });
          }
        });
      }
      if (rule.items) value.forEach((item, index) => visit(rule.items, item, `${path}[${index}]`, collector));
      if (rule.contains) {
        const found = value.some((item) => {
          const branchErrors = [];
          visit(rule.contains, item, path, branchErrors);
          return branchErrors.length === 0;
        });
        if (!found) collector.push({ path, message: "数组中缺少符合 contains 约束的项目" });
      }
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const key of rule.required || []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) collector.push({ path, message: `缺少必填字段 ${key}` });
      }
      for (const [key, childRule] of Object.entries(rule.properties || {})) {
        if (Object.prototype.hasOwnProperty.call(value, key)) visit(childRule, value[key], `${path}.${key}`, collector);
      }
      if (rule.additionalProperties === false && rule.properties) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(rule.properties, key)) {
            collector.push({ path: `${path}.${key}`, message: "不允许的字段" });
          }
        }
      } else if (rule.additionalProperties && typeof rule.additionalProperties === "object") {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(rule.properties || {}, key)) {
            visit(rule.additionalProperties, value[key], `${path}.${key}`, collector);
          }
        }
      }
    }
  }

  visit(schema, data, "$");
  return errors;
}

function formatSchemaErrors(label, errors) {
  return errors.map((error) => `${label}${error.path}：${error.message}`);
}

module.exports = { validateSchema, formatSchemaErrors };
