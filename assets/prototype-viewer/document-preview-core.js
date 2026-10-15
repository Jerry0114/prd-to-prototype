(function initPrototypeDocumentPreview(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PrototypeDocumentPreview = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createPrototypeDocumentPreview() {
  const documentExtensions = new Set([".md", ".markdown", ".html", ".htm"]);

  function decodedPath(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  }

  function hasUnsafePathShape(value) {
    if (!value || /[\\\u0000-\u001f\u007f]/.test(value)) return true;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("/") || value.startsWith("//")) return true;
    if (value.includes("?") || value.includes("#")) return true;
    const segments = value.split("/");
    return segments.some((segment) => !segment || segment === "." || segment === "..");
  }

  function extensionOf(value) {
    const fileName = value.split("/").pop() || "";
    const dotIndex = fileName.lastIndexOf(".");
    return dotIndex === -1 ? "" : fileName.slice(dotIndex).toLowerCase();
  }

  function isSafeDocumentPath(value) {
    if (typeof value !== "string") return false;
    const raw = value.trim();
    const decoded = decodedPath(raw);
    if (hasUnsafePathShape(raw) || hasUnsafePathShape(decoded)) return false;
    return documentExtensions.has(extensionOf(decoded));
  }

  function relatedDocHref(doc) {
    const path = typeof doc?.path === "string" ? doc.path.trim() : "";
    if (!isSafeDocumentPath(path)) return "#";
    const extension = extensionOf(decodedPath(path));
    if (extension === ".html" || extension === ".htm") return path;
    const query = new URLSearchParams();
    query.set("src", path);
    if (typeof doc?.label === "string" && doc.label.trim()) query.set("title", doc.label.trim());
    if (typeof doc?.section === "string" && doc.section.trim()) query.set("section", doc.section.trim());
    return `document-viewer.html?${query.toString()}`;
  }

  function escapeRawHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function slugifyHeading(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s/]+/g, "-")
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, "")
      .replace(/^-+|-+$/g, "") || "section";
  }

  return {
    escapeRawHtml,
    isSafeDocumentPath,
    relatedDocHref,
    slugifyHeading,
  };
}));
