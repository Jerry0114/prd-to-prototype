#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { validateSchema } = require("./lib/schema-validator.js");
const { safeLocalPath, isLocalWrite } = require("./lib/local-server-safety.js");

const annotationRelativePath = path.join("annotations", "manual-annotations.json");
const schemaPath = path.resolve(__dirname, "../schemas/manual-annotations.schema.json");
const annotationSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function readArg(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function projectIdentity(projectDir) {
  const manifestPath = path.join(projectDir, "prototype.json");
  if (!fs.existsSync(manifestPath)) throw new Error("项目缺少 prototype.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const project = manifest.project || {};
  const id = project.id || manifest.projectId;
  const name = project.name || manifest.title;
  if (!id || !name) throw new Error("prototype.json 缺少项目 ID 或名称");
  return { id: String(id), name: String(name) };
}

function emptyAnnotationFile(project) {
  return {
    schemaVersion: "2.0",
    version: 2,
    projectId: project.id,
    projectName: project.name,
    updatedAt: null,
    storage: { kind: "project-file", path: "annotations/manual-annotations.json" },
    pages: {},
  };
}

function validateAnnotationPayload(payload, project) {
  const errors = validateSchema(annotationSchema, payload);
  if (payload?.projectId !== project.id) {
    errors.push({ path: "$.projectId", message: "必须与当前原型项目一致" });
  }
  return errors;
}

async function readRequestJson(request, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

function createPrototypeProjectServer(projectDir) {
  const root = path.resolve(projectDir);
  const project = projectIdentity(root);
  const annotationPath = path.join(root, annotationRelativePath);

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");

      if (requestUrl.pathname === "/__health") {
        return sendJson(response, 200, {
          status: "ok",
          projectId: project.id,
          annotationFile: "annotations/manual-annotations.json",
        });
      }

      if (requestUrl.pathname === "/api/manual-annotations") {
        if (!safeLocalPath(root, annotationPath)) return sendText(response, 403, "禁止访问");
        if (request.method === "GET" || request.method === "HEAD") {
          const value = fs.existsSync(annotationPath)
            ? JSON.parse(await fs.promises.readFile(annotationPath, "utf8"))
            : emptyAnnotationFile(project);
          if (request.method === "HEAD") {
            response.writeHead(200, { "Cache-Control": "no-store" });
            return response.end();
          }
          return sendJson(response, 200, value);
        }
        if (request.method !== "PUT") return sendText(response, 405, "仅支持 GET、HEAD 或 PUT");
        if (!isLocalWrite(request)) return sendText(response, 403, "仅允许本机同源 JSON 写入");
        const payload = await readRequestJson(request);
        const errors = validateAnnotationPayload(payload, project);
        if (errors.length) {
          return sendJson(response, 400, {
            status: "invalid",
            errors: errors.slice(0, 20),
          });
        }
        await fs.promises.mkdir(path.dirname(annotationPath), { recursive: true });
        await fs.promises.writeFile(annotationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        return sendJson(response, 200, {
          status: "saved",
          path: "annotations/manual-annotations.json",
          updatedAt: payload.updatedAt,
        });
      }

      if (!["GET", "HEAD"].includes(request.method || "GET")) return sendText(response, 405, "不支持的请求方法");
      const decodedPath = decodeURIComponent(requestUrl.pathname);
      const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
      let filePath = path.resolve(root, relativePath);
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return sendText(response, 403, "禁止访问");
      if (!safeLocalPath(root, filePath)) return sendText(response, 403, "禁止访问");

      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        return sendText(response, 404, "文件不存在");
      }
      if (stat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        try {
          stat = await fs.promises.stat(filePath);
        } catch {
          return sendText(response, 404, "该目录没有 index.html");
        }
      }
      if (!stat.isFile()) return sendText(response, 404, "文件不存在");
      if (!safeLocalPath(root, filePath)) return sendText(response, 403, "禁止访问");

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": stat.size,
        "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      });
      if (request.method === "HEAD") return response.end();
      fs.createReadStream(filePath)
        .on("error", () => response.destroy())
        .pipe(response);
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 500;
      sendJson(response, status, { status: "error", message: status === 400 ? "JSON 格式无效" : "请求处理失败" });
    }
  });
}

function main() {
  const projectDir = path.resolve(readArg(process.argv, "--project", process.cwd()));
  const host = readArg(process.argv, "--host", "127.0.0.1");
  const port = Number(readArg(process.argv, "--port", process.env.PORT || process.env.CODEX_PREVIEW_PORT || "8766"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口无效");
  const server = createPrototypeProjectServer(projectDir);
  server.on("error", (error) => {
    console.error(`原型项目服务启动失败：${error.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`原型项目服务已启动：http://${host}:${port}/`);
    console.log("人工标注文件：annotations/manual-annotations.json");
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`启动失败：${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  annotationRelativePath,
  createPrototypeProjectServer,
  emptyAnnotationFile,
  projectIdentity,
  validateAnnotationPayload,
};
