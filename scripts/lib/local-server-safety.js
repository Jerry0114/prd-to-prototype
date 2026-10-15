const fs = require("node:fs");
const path = require("node:path");

// Lexical checks alone do not stop a symlink pointing outside the project.
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeLocalPath(root, target) {
  if (!inside(root, target)) return false;
  if (path.relative(root, target).split(path.sep).some(part => part.startsWith("."))) return false;
  const realRoot = fs.realpathSync(root);
  let existing = target;
  while (!fs.existsSync(existing)) {
    // A dangling symlink must not be treated as a missing regular file.
    try { if (fs.lstatSync(existing).isSymbolicLink()) return false; } catch {}
    existing = path.dirname(existing);
  }
  return inside(realRoot, fs.realpathSync(existing));
}

function isLocalWrite(request) {
  const host = request.headers.host;
  if (!host) return false;
  try {
    const expected = new URL(`http://${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)) return false;
    if (request.headers.origin && request.headers.origin !== expected.origin) return false;
    if (request.headers["sec-fetch-site"] === "cross-site") return false;
    return (request.headers["content-type"] || "").split(";")[0].trim() === "application/json";
  } catch { return false; }
}

module.exports = { safeLocalPath, isLocalWrite };
