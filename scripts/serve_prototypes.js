#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const { safeLocalPath } = require("./lib/local-server-safety.js");

const workspaceRoot = path.resolve(readArg("--root", process.cwd()));
const host = readArg("--host", "127.0.0.1");
const port = Number(readArg("--port", "8765"));

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
  ".woff2": "font/woff2"
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`无效端口：${port}`);
  process.exit(1);
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);

    if (requestUrl.pathname === "/__health") {
      return sendJson(response, 200, {
        status: "ok",
        root: workspaceRoot,
        projects: listPrototypeProjects()
      });
    }

    if (requestUrl.pathname === "/") {
      return sendHtml(response, 200, renderProjectIndex());
    }

    const decodedPath = decodeURIComponent(requestUrl.pathname);
    const relativePath = decodedPath.replace(/^\/+/, "");
    let filePath = path.resolve(workspaceRoot, relativePath);
    if (!safeLocalPath(workspaceRoot, filePath)) return sendText(response, 403, "禁止访问");

    if (filePath !== workspaceRoot && !filePath.startsWith(`${workspaceRoot}${path.sep}`)) {
      return sendText(response, 403, "禁止访问");
    }

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

    if (!stat.isFile()) {
      return sendText(response, 404, "文件不存在");
    }

    if (!safeLocalPath(workspaceRoot, filePath)) return sendText(response, 403, "禁止访问");

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Length": stat.size,
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });

    if (request.method === "HEAD") {
      return response.end();
    }

    fs.createReadStream(filePath)
      .on("error", () => {
        if (!response.headersSent) sendText(response, 500, "读取文件失败");
        else response.destroy();
      })
      .pipe(response);
  } catch (error) {
    sendText(response, 400, `请求无效：${error.message}`);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用。请先访问 http://${host}:${port}/ 检查是否已有原型服务。`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`原型查看服务已启动：http://${host}:${port}/`);
  for (const project of listPrototypeProjects()) {
    console.log(`- ${project.name}: http://${host}:${port}/${encodeURI(project.path)}/`);
  }
});

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function listPrototypeProjects() {
  const casesDir = path.join(workspaceRoot, "examples");
  if (!fs.existsSync(casesDir)) return [];

  return fs.readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const legacyRoot = path.join(casesDir, entry.name);
      const nestedRoot = path.join(legacyRoot, "prototype");
      const root = fs.existsSync(path.join(nestedRoot, "prototype.json")) ? nestedRoot : legacyRoot;
      return {
        name: entry.name,
        path: path.relative(workspaceRoot, root).split(path.sep).join("/"),
        manifest: path.join(root, "prototype.json")
      };
    })
    .filter((entry) => fs.existsSync(entry.manifest))
    .map(({ name, path: projectPath }) => ({ name, path: projectPath }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function renderProjectIndex() {
  const projectLinks = listPrototypeProjects()
    .map((project) => `<li><a href="/${escapeHtml(encodeURI(project.path))}/">${escapeHtml(project.name)}</a></li>`)
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>原型案例入口</title>
  <style>
    body { max-width: 760px; margin: 48px auto; padding: 0 24px; color: #172033; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f9fc; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    p { margin: 0 0 24px; color: #64748b; }
    ul { margin: 0; padding: 0; list-style: none; border: 1px solid #dce3ee; background: #fff; }
    li + li { border-top: 1px solid #edf1f6; }
    a { display: block; padding: 14px 16px; color: #145bd7; text-decoration: none; }
    a:hover { background: #f3f7ff; }
  </style>
</head>
<body>
  <h1>原型案例入口</h1>
  <p>以下项目均通过同一个本地 HTTP 服务访问。</p>
  <ul>${projectLinks}</ul>
</body>
</html>`;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value, null, 2);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(body);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
