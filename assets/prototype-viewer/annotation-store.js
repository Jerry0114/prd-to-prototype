(function initPrototypeAnnotationStore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PrototypeAnnotationStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPrototypeAnnotationStore() {
  "use strict";

  function emptyStore() {
    return { version: 2, updatedAt: null, pages: {} };
  }

  function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function compactContent(value) {
    const paragraphs = String(value || "").trim().split(/\n\s*\n/).filter(hasText);
    if (paragraphs.length < 2 || !paragraphs[0].startsWith("说明\n")) return paragraphs.join("\n\n");
    const summary = paragraphs[0].slice(3).trim();
    const laterContent = paragraphs.slice(1)
      .map((paragraph) => paragraph.split("\n").slice(1).join("\n"))
      .join("\n")
      .replace(/\s+/g, "");
    const summaryParts = summary.split(/[。！？；\n]+/).map((part) => part.replace(/\s+/g, "")).filter(Boolean);
    return summaryParts.length && summaryParts.every((part) => laterContent.includes(part))
      ? paragraphs.slice(1).join("\n\n")
      : paragraphs.join("\n\n");
  }

  function annotationContent(marker = {}) {
    if (hasText(marker.content)) return compactContent(marker.content);
    const details = Array.isArray(marker.details) ? marker.details : [];
    const relatedDocs = Array.isArray(marker.relatedDocs) ? marker.relatedDocs : [];
    const paragraphs = [];
    if (hasText(marker.description)) {
      const description = marker.description.trim();
      paragraphs.push(details.length || relatedDocs.length ? `说明\n${description}` : description);
    }
    details.forEach((detail) => {
      if (hasText(detail.label) && hasText(detail.content)) {
        paragraphs.push(`${detail.label.trim()}\n${detail.content.trim()}`);
      }
    });
    const docLines = relatedDocs
      .filter((doc) => hasText(doc.label) && hasText(doc.path))
      .map((doc) => `${doc.label.trim()}：${doc.path.trim()}${hasText(doc.section) ? `（${doc.section.trim()}）` : ""}`);
    if (docLines.length) paragraphs.push(`关联文档\n${docLines.join("\n")}`);
    return compactContent(paragraphs.join("\n\n")) || "详见页面规格。";
  }

  function normalizeAddedMarker(marker = {}) {
    return {
      id: marker.id,
      title: marker.title,
      content: annotationContent(marker),
      x: marker.x,
      y: marker.y,
      anchor: marker.anchor,
      createdAt: marker.createdAt || null,
      editedAt: marker.editedAt || null,
    };
  }

  function normalizeMarkerPatch(marker = {}) {
    return {
      title: marker.title,
      content: annotationContent(marker),
      x: marker.x,
      y: marker.y,
      anchor: marker.anchor,
      editedAt: marker.editedAt || null,
    };
  }

  function normalizePageEdits(value) {
    const edits = value && typeof value === "object" ? value : {};
    const updated = {};
    Object.entries(edits.updated || {}).forEach(([markerId, marker]) => {
      updated[markerId] = normalizeMarkerPatch(marker);
    });
    return {
      added: Array.isArray(edits.added) ? edits.added.map(normalizeAddedMarker) : [],
      updated,
      deleted: Array.isArray(edits.deleted) ? [...new Set(edits.deleted.map(String))] : [],
      updatedAt: typeof edits.updatedAt === "string" ? edits.updatedAt : null,
    };
  }

  function normalizeStore(value) {
    if (!value || typeof value !== "object" || ![1, 2, "1.0", "2.0"].includes(value.version ?? value.schemaVersion)) return emptyStore();
    const pages = {};
    Object.entries(value.pages || {}).forEach(([pageId, edits]) => {
      pages[pageId] = normalizePageEdits(edits);
    });
    return {
      version: 2,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
      pages,
    };
  }

  function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function mergeStores(fileValue, localValue) {
    const fileStore = normalizeStore(fileValue);
    const localStore = normalizeStore(localValue);
    const pageIds = new Set([...Object.keys(fileStore.pages), ...Object.keys(localStore.pages)]);
    const pages = {};
    pageIds.forEach((pageId) => {
      const filePage = fileStore.pages[pageId];
      const localPage = localStore.pages[pageId];
      if (!filePage) pages[pageId] = localPage;
      else if (!localPage) pages[pageId] = filePage;
      else if (timestamp(localPage.updatedAt) > timestamp(filePage.updatedAt)) pages[pageId] = localPage;
      else if (
        timestamp(localPage.updatedAt) === 0
        && timestamp(filePage.updatedAt) === 0
        && hasPageEdits(localPage)
        && !hasPageEdits(filePage)
      ) pages[pageId] = localPage;
      else pages[pageId] = filePage;
    });
    const updatedAt = timestamp(localStore.updatedAt) > timestamp(fileStore.updatedAt)
      ? localStore.updatedAt
      : fileStore.updatedAt;
    return { version: 2, updatedAt: updatedAt || null, pages };
  }

  function hasPageEdits(page) {
    return Boolean(page.added.length || Object.keys(page.updated).length || page.deleted.length);
  }

  function pageEdits(store, pageId) {
    const normalized = normalizeStore(store);
    return normalizePageEdits(normalized.pages[pageId]);
  }

  function mergeMarkers(systemMarkers, edits) {
    const normalizedEdits = normalizePageEdits(edits);
    const deleted = new Set(normalizedEdits.deleted);
    const system = (systemMarkers || [])
      .filter((marker) => !deleted.has(String(marker.id)))
      .map((marker) => {
        const patch = normalizedEdits.updated[marker.id] || {};
        return {
          ...marker,
          ...patch,
          anchor: { ...(marker.anchor || {}), ...(patch.anchor || {}) },
          origin: "system",
          modified: Object.keys(patch).length > 0,
        };
      });
    const added = normalizedEdits.added.map((marker) => ({
      ...marker,
      origin: "manual",
      modified: false,
    }));
    return [...system, ...added];
  }

  function documentPointFromClient(input) {
    const rectWidth = Number(input.rect?.width) || 1;
    const rectHeight = Number(input.rect?.height) || 1;
    const screenWidth = Number(input.screenWidth) || rectWidth;
    const screenHeight = Number(input.screenHeight) || rectHeight;
    const viewportWidth = Number(input.viewportWidth) || 1;
    const viewportHeight = Number(input.viewportHeight) || 1;
    const localScreenX = (Number(input.clientX) - Number(input.rect?.left || 0)) * (screenWidth / rectWidth);
    const localScreenY = (Number(input.clientY) - Number(input.rect?.top || 0)) * (screenHeight / rectHeight);
    const documentX = localScreenX * (viewportWidth / screenWidth) + (Number(input.scrollX) || 0);
    const documentY = localScreenY * (viewportHeight / screenHeight) + (Number(input.scrollY) || 0);
    return {
      x: Math.round(Math.max(0, Math.min(100, documentX / viewportWidth * 100)) * 1000) / 1000,
      y: Math.round(Math.max(0, documentY / viewportHeight * 100) * 1000) / 1000,
    };
  }

  function currentMarkerSnapshot(marker) {
    return {
      id: marker.id,
      origin: marker.origin === "manual" ? "manual" : "system",
      modified: Boolean(marker.modified),
      title: marker.title,
      content: annotationContent(marker),
      x: marker.x,
      y: marker.y,
      anchor: marker.anchor,
      createdAt: marker.createdAt || null,
      editedAt: marker.editedAt || null,
    };
  }

  function buildProjectFile(storeValue, project, pages) {
    const store = normalizeStore(storeValue);
    const pageRecords = {};
    (pages || []).forEach((page) => {
      const edits = normalizePageEdits(store.pages[page.id]);
      pageRecords[page.id] = {
        ...edits,
        current: (page.markers || []).filter((marker) => !marker._draft).map(currentMarkerSnapshot),
      };
    });
    Object.entries(store.pages).forEach(([pageId, edits]) => {
      if (!pageRecords[pageId]) pageRecords[pageId] = { ...normalizePageEdits(edits), current: [] };
    });
    return {
      schemaVersion: "2.0",
      version: 2,
      projectId: project.id,
      projectName: project.name,
      updatedAt: store.updatedAt,
      storage: {
        kind: "project-file",
        path: "annotations/manual-annotations.json",
      },
      pages: pageRecords,
    };
  }

  return {
    emptyStore,
    annotationContent,
    normalizePageEdits,
    normalizeStore,
    mergeStores,
    pageEdits,
    mergeMarkers,
    documentPointFromClient,
    currentMarkerSnapshot,
    buildProjectFile,
  };
});
