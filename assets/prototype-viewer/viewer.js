const state = {
  manifest: null,
  mode: "page",
  zoom: 1.25,
  showMarkers: true,
  activePage: null,
  previewPath: null,
  routeParams: {},
  routeStack: [],
  activeScrollY: 0,
  pendingRestoreY: 0,
  assetRevision: String(Date.now()),
  navFilter: "",
  collapsedNavNodes: new Set(),
  annotationStore: null,
  annotationStorageKey: "",
  annotationPersistence: {
    writable: false,
    status: "loading",
    error: "",
    saveRevision: 0,
    writeQueue: Promise.resolve(),
  },
  placement: null,
  editingMarker: null,
};

const els = {
  canvas: document.querySelector("#canvas"),
  canvasSizer: document.querySelector("#canvasSizer"),
  workspace: document.querySelector("#workspace"),
  flow: document.querySelector("#flow"),
  connections: document.querySelector("#connections"),
  pageNav: document.querySelector("#pageNav"),
  pageSearch: document.querySelector("#pageSearch"),
  overviewNav: document.querySelector("#overviewNav"),
  zoomValue: document.querySelector("#zoomValue"),
  zoomMenuButton: document.querySelector("#zoomMenuButton"),
  zoomMenu: document.querySelector("#zoomMenu"),
  pageCount: document.querySelector("#pageCount"),
  template: document.querySelector("#pageNodeTemplate"),
  previewDialog: document.querySelector("#previewDialog"),
  previewViewport: document.querySelector("#previewViewport"),
  previewDevice: document.querySelector("#previewDevice"),
  previewFrame: document.querySelector("#previewFrame"),
  previewTitle: document.querySelector("#previewTitle"),
};

const zoomLevels = [0.5, 0.8, 1, 1.25, 1.5];
const annotationStoreApi = window.PrototypeAnnotationStore;

function annotationStorageKey(projectId) {
  return `prototype-viewer:annotations:v1:${encodeURIComponent(projectId)}`;
}

function readLocalAnnotationStore(projectId) {
  state.annotationStorageKey = annotationStorageKey(projectId);
  try {
    const stored = window.localStorage.getItem(state.annotationStorageKey);
    return annotationStoreApi.normalizeStore(stored ? JSON.parse(stored) : null);
  } catch (error) {
    console.warn("读取人工标注失败，将使用空白本地记录。", error);
    return annotationStoreApi.emptyStore();
  }
}

function cacheAnnotationStore() {
  try {
    window.localStorage.setItem(state.annotationStorageKey, JSON.stringify(state.annotationStore));
    return true;
  } catch (error) {
    console.warn("保存人工标注失败。", error);
    return false;
  }
}

async function readAnnotationStore(project) {
  const localStore = readLocalAnnotationStore(project.id);
  let fileStore = null;
  try {
    const response = await fetch("/api/manual-annotations", { cache: "no-store" });
    if (response.ok) {
      fileStore = await response.json();
      state.annotationPersistence.writable = true;
    }
  } catch {
    // 纯静态部署没有项目写入接口，继续尝试读取已保存的项目文件。
  }
  if (!fileStore) {
    try {
      const response = await fetch("annotations/manual-annotations.json", { cache: "no-store" });
      if (response.ok) fileStore = await response.json();
    } catch {
      // 项目尚未生成标注文件时使用浏览器缓存或空记录。
    }
  }
  const merged = annotationStoreApi.mergeStores(fileStore, localStore);
  state.annotationPersistence.status = state.annotationPersistence.writable ? "saving" : "local";
  state.annotationStore = merged;
  cacheAnnotationStore();
  return merged;
}

function updateAnnotationStorageStatusElement(element) {
  const labels = {
    loading: "读取保存状态",
    saving: "正在保存到项目文件",
    saved: "已保存到项目文件",
    local: "仅浏览器保存",
    error: "项目文件保存失败",
  };
  element.dataset.state = state.annotationPersistence.status;
  element.querySelector("span").textContent = labels[state.annotationPersistence.status] || labels.loading;
  element.title = state.annotationPersistence.status === "saved"
    ? "annotations/manual-annotations.json"
    : state.annotationPersistence.error || "人工标注保存状态";
}

function updateAnnotationStorageStatuses() {
  document.querySelectorAll(".annotation-storage-status").forEach(updateAnnotationStorageStatusElement);
}

function writeAnnotationStore() {
  const now = new Date().toISOString();
  state.annotationStore.updatedAt = now;
  cacheAnnotationStore();
  if (!state.annotationPersistence.writable || !state.manifest) {
    state.annotationPersistence.status = "local";
    updateAnnotationStorageStatuses();
    return Promise.resolve(false);
  }

  state.annotationPersistence.status = "saving";
  state.annotationPersistence.error = "";
  const revision = ++state.annotationPersistence.saveRevision;
  updateAnnotationStorageStatuses();
  state.annotationPersistence.writeQueue = state.annotationPersistence.writeQueue
    .catch(() => false)
    .then(async () => {
      const payload = annotationStoreApi.buildProjectFile(
        state.annotationStore,
        state.manifest.project,
        state.manifest.pages,
      );
      const response = await fetch("/api/manual-annotations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`保存接口返回 ${response.status}`);
      if (revision === state.annotationPersistence.saveRevision) {
        state.annotationPersistence.status = "saved";
        updateAnnotationStorageStatuses();
      }
      return true;
    })
    .catch((error) => {
      state.annotationPersistence.status = "error";
      state.annotationPersistence.error = error.message;
      updateAnnotationStorageStatuses();
      console.warn("保存人工标注项目文件失败，浏览器缓存仍保留本次修改。", error);
      return false;
    });
  return state.annotationPersistence.writeQueue;
}

function editableMarkerSnapshot(marker) {
  return {
    id: marker.id,
    title: marker.title,
    content: marker.content,
    x: marker.x,
    y: marker.y,
    anchor: marker.anchor,
    createdAt: marker.createdAt,
    editedAt: marker.editedAt,
  };
}

function ensurePageEdits(pageId) {
  state.annotationStore.pages[pageId] = annotationStoreApi.normalizePageEdits(state.annotationStore.pages[pageId]);
  return state.annotationStore.pages[pageId];
}

function refreshPageMarkers(page) {
  page.markers = annotationStoreApi.mergeMarkers(page.systemMarkers, ensurePageEdits(page.id)).map(normalizeMarker);
}

function persistMarker(page, marker) {
  const edits = ensurePageEdits(page.id);
  edits.updatedAt = new Date().toISOString();
  const snapshot = editableMarkerSnapshot(marker);
  if (marker.origin === "manual") {
    const index = edits.added.findIndex((item) => item.id === marker.id);
    if (index >= 0) edits.added[index] = snapshot;
    else edits.added.push(snapshot);
  } else {
    edits.updated[marker.id] = {
      title: snapshot.title,
      content: snapshot.content,
      x: snapshot.x,
      y: snapshot.y,
      anchor: snapshot.anchor,
      editedAt: snapshot.editedAt,
    };
  }
  refreshPageMarkers(page);
  writeAnnotationStore();
}

function persistMarkerDeletion(page, marker) {
  const edits = ensurePageEdits(page.id);
  edits.updatedAt = new Date().toISOString();
  if (marker.origin === "manual") {
    edits.added = edits.added.filter((item) => item.id !== marker.id);
  } else {
    edits.deleted = [...new Set([...edits.deleted, marker.id])];
    delete edits.updated[marker.id];
  }
  refreshPageMarkers(page);
  writeAnnotationStore();
}

function versionedPagePath(pagePath, params = {}) {
  const url = new URL(pagePath, window.location.href);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  url.searchParams.set("__prototype_rev", state.assetRevision);
  return url.href;
}

async function boot() {
  const [manifestResponse, pageMapResponse] = await Promise.all([
    fetch("prototype.json", { cache: "no-store" }),
    fetch("intermediate/page-map.json", { cache: "no-store" }).catch(() => null),
  ]);
  if (!manifestResponse.ok) throw new Error(`无法读取原型协议：${manifestResponse.status}`);
  const rawManifest = await manifestResponse.json();
  const pageMap = pageMapResponse?.ok ? await pageMapResponse.json() : null;
  state.manifest = await normalizeManifest(rawManifest, pageMap);
  void writeAnnotationStore();
  renderNavigation();
  els.pageCount.textContent = `${state.manifest.pages.length} 个页面`;
  document.querySelector("#projectName").textContent = state.manifest.project.name;
  document.title = `${state.manifest.project.name} · 原型工作台`;
  const rawInitialView = window.location.hash.slice(1);
  let initialView = rawInitialView;
  try {
    initialView = decodeURIComponent(rawInitialView);
  } catch {
    // 编码异常时保留原值，并按默认页面兜底。
  }
  if (initialView === "overview") renderOverview();
  else renderPageCanvas(state.manifest.pages.some((page) => page.id === initialView) ? initialView : state.manifest.startPageId, false);
}

function normalizeNavigation(nodes, pageIds, path = "nav") {
  return (nodes || []).flatMap((node, index) => {
    const normalized = typeof node === "string"
      ? { id: `${path}-page-${index}`, type: "page", pageId: node }
      : { ...node };
    const nodeId = normalized.id || `${path}-${index}`;
    const children = normalizeNavigation(normalized.children || [], pageIds, nodeId);
    if (normalized.pageId) {
      if (!pageIds.has(normalized.pageId)) return [];
      return [{ ...normalized, id: nodeId, type: "page", children }];
    }
    if (!children.length) return [];
    return [{ ...normalized, id: nodeId, type: "folder", title: normalized.title || "页面分组", children }];
  });
}

function calculateRanks(pages, connections) {
  if (pages.some((page) => Number.isFinite(page.rank))) {
    return new Map(pages.map((page, index) => [page.id, Number.isFinite(page.rank) ? page.rank : index + 1]));
  }
  const ranks = new Map(pages.map((page) => [page.id, 0]));
  const incoming = new Map(pages.map((page) => [page.id, 0]));
  const outgoing = new Map(pages.map((page) => [page.id, []]));
  connections.forEach((connection) => {
    if (!outgoing.has(connection.from) || !incoming.has(connection.to)) return;
    outgoing.get(connection.from).push(connection.to);
    incoming.set(connection.to, incoming.get(connection.to) + 1);
  });
  const queue = pages.filter((page) => incoming.get(page.id) === 0).map((page) => page.id);
  const visited = new Set();
  while (queue.length) {
    const pageId = queue.shift();
    if (visited.has(pageId)) continue;
    visited.add(pageId);
    outgoing.get(pageId).forEach((targetId) => {
      ranks.set(targetId, Math.max(ranks.get(targetId), ranks.get(pageId) + 1));
      incoming.set(targetId, incoming.get(targetId) - 1);
      if (incoming.get(targetId) === 0) queue.push(targetId);
    });
  }
  pages.filter((page) => !visited.has(page.id)).forEach((page, index) => ranks.set(page.id, index + 1));
  return ranks;
}

function normalizeMarker(marker) {
  const fallback = marker.anchor?.fallback;
  return {
    ...marker,
    origin: marker.origin === "manual" ? "manual" : "system",
    title: marker.title || marker.id,
    content: annotationStoreApi.annotationContent(marker),
    x: Number.isFinite(marker.x) ? marker.x : fallback?.x ?? 50,
    y: Number.isFinite(marker.y) ? marker.y : fallback?.y ?? 50,
  };
}

function resolveViewportKind(viewport = {}) {
  const declaredKind = String(viewport.kind || "").toLowerCase();
  if (["mobile", "app", "phone"].includes(declaredKind)) return "mobile";
  if (["web", "desktop", "pc"].includes(declaredKind)) return "web";
  const width = Number(viewport.width) || 1440;
  const height = Number(viewport.height) || 900;
  return width <= 600 && height > width ? "mobile" : "web";
}

function previewMetrics(viewport = {}) {
  const width = Number(viewport.width) || 1440;
  const height = Number(viewport.height) || 900;
  const kind = resolveViewportKind(viewport);
  const pageScale = kind === "mobile"
    ? Math.min(1, 390 / width, 844 / height)
    : Math.min(880 / width, 550 / height);
  const overviewScale = kind === "mobile"
    ? Math.min(220 / width, 478 / height)
    : Math.min(500 / width, 313 / height);
  return {
    kind,
    width,
    height,
    pageScale,
    pageWidth: width * pageScale,
    pageHeight: height * pageScale,
    overviewScale,
    overviewWidth: width * overviewScale,
    overviewHeight: height * overviewScale,
  };
}

function applyViewportPresentation(node, viewport) {
  const metrics = previewMetrics(viewport);
  node.classList.add(`is-${metrics.kind}-device`);
  node.dataset.viewportKind = metrics.kind;
  node.style.setProperty("--viewport-width", `${metrics.width}px`);
  node.style.setProperty("--viewport-height", `${metrics.height}px`);
  node.style.setProperty("--page-preview-scale", metrics.pageScale);
  node.style.setProperty("--page-preview-width", `${metrics.pageWidth}px`);
  node.style.setProperty("--page-preview-height", `${metrics.pageHeight}px`);
  node.style.setProperty("--overview-preview-scale", metrics.overviewScale);
  node.style.setProperty("--overview-preview-width", `${metrics.overviewWidth}px`);
  node.style.setProperty("--overview-preview-height", `${metrics.overviewHeight}px`);
  return metrics;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderOverviewGroup(title, items, emptyText) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const content = normalizedItems.length
    ? normalizedItems.map((item) => `<div class="handoff-row"><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.description)}</p></div>`).join("")
    : `<p class="handoff-empty">${escapeHtml(emptyText)}</p>`;
  return `<section class="handoff-section"><h3>${escapeHtml(title)}</h3><div class="handoff-rows">${content}</div></section>`;
}

function renderOverviewPanel(node, page) {
  const panel = node.querySelector('[data-handoff-panel="overview"]');
  const spec = page.spec;
  if (!spec) {
    panel.innerHTML = '<div class="annotation-empty">页面规格加载失败，暂时无法展示页面概要</div>';
    return;
  }
  const overview = spec.handoff?.pageOverview || {};
  panel.innerHTML = `
    <section class="handoff-section handoff-purpose">
      <h3>页面目的</h3>
      <p>${escapeHtml(spec.purpose)}</p>
    </section>
    ${renderOverviewGroup("使用角色", overview.roles, "旧版页面尚未单独声明使用角色")}
    ${renderOverviewGroup("入口", overview.entries, "旧版页面尚未单独声明入口")}
    ${renderOverviewGroup("出口", overview.exits, "旧版页面尚未单独声明出口")}
    ${renderOverviewGroup("前置条件", overview.preconditions, "旧版页面尚未单独声明前置条件")}
  `;
}

function renderStatesPanel(node, page) {
  const panel = node.querySelector('[data-handoff-panel="states"]');
  const spec = page.spec;
  if (!spec) {
    panel.innerHTML = '<div class="annotation-empty">页面规格加载失败，暂时无法展示页面状态</div>';
    return;
  }
  const stateLabels = {
    normal: "正常",
    loading: "加载",
    empty: "空数据",
    error: "失败",
    forbidden: "无权限",
    expired: "失效",
  };
  const stateRows = (spec.states || []).map((item) => `
    <div class="state-summary${item.applicable ? "" : " is-inapplicable"}">
      <div><strong>${escapeHtml(stateLabels[item.id] || item.id)}</strong><em>${item.applicable ? "适用" : "不适用"}</em></div>
      <p>${escapeHtml(item.description)}</p>
    </div>
  `).join("");
  const transitions = spec.handoff?.statusTransitions || [];
  const transitionRows = transitions.length
    ? transitions.map((item) => `
      <div class="transition-row">
        <div class="transition-path"><span>${escapeHtml(item.from)}</span><i>→</i><span>${escapeHtml(item.to)}</span></div>
        <strong>${escapeHtml(item.trigger)}</strong>
        <p>${escapeHtml(item.rule)}</p>
      </div>
    `).join("")
    : '<p class="handoff-empty">本页不直接改变业务状态，或旧版规格尚未单独声明状态流转。</p>';
  panel.innerHTML = `
    <section class="handoff-section">
      <h3>页面状态</h3>
      <div class="state-list">${stateRows || '<p class="handoff-empty">暂无页面状态声明</p>'}</div>
    </section>
    <section class="handoff-section">
      <h3>状态变化</h3>
      <div class="transition-list">${transitionRows}</div>
    </section>
  `;
}

function renderQuestion(question, index) {
  if (typeof question === "string") {
    return `<div class="delivery-row"><div><strong>待确认 ${index + 1}</strong><em class="status-open">未确认</em></div><p>${escapeHtml(question)}</p></div>`;
  }
  const statusLabels = { open: "未确认", confirmed: "已确认", rejected: "已否决" };
  const assumption = question.currentAssumption
    ? `<small><b>当前假设：</b>${escapeHtml(question.currentAssumption)}</small>`
    : "";
  return `
    <div class="delivery-row">
      <div><strong>${escapeHtml(question.question)}</strong><em class="status-${escapeHtml(question.status)}">${escapeHtml(statusLabels[question.status] || question.status)}</em></div>
      <p><b>影响：</b>${escapeHtml(question.impact)}</p>
      ${assumption}
    </div>
  `;
}

function renderDeliveryPanel(node, page) {
  const panel = node.querySelector('[data-handoff-panel="delivery"]');
  const spec = page.spec;
  if (!spec) {
    panel.innerHTML = '<div class="annotation-empty">页面规格加载失败，暂时无法展示交付检查</div>';
    return;
  }
  const questions = spec.openQuestions || [];
  const criteria = spec.handoff?.acceptanceCriteria || [];
  const docs = spec.handoff?.relatedDocs || [];
  const questionRows = questions.length
    ? questions.map(renderQuestion).join("")
    : '<p class="handoff-empty">当前没有待确认事项</p>';
  const criterionRows = criteria.length
    ? criteria.map((item) => `
      <div class="acceptance-row">
        <strong>${escapeHtml(item.title)}</strong>
        <dl>
          <div><dt>前置</dt><dd>${escapeHtml(item.given)}</dd></div>
          <div><dt>操作</dt><dd>${escapeHtml(item.when)}</dd></div>
          <div><dt>结果</dt><dd>${escapeHtml(item.then)}</dd></div>
        </dl>
      </div>
    `).join("")
    : '<p class="handoff-empty">旧版页面尚未提供结构化验收标准</p>';
  const docRows = docs.length
    ? docs.map((doc) => {
      const href = window.PrototypeDocumentPreview.relatedDocHref(doc);
      if (href === "#") return `<span class="handoff-doc-unavailable">${escapeHtml(doc.label)} · 文档路径不可用</span>`;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doc.label)}${doc.section ? ` · ${escapeHtml(doc.section)}` : ""}</a>`;
    }).join("")
    : '<p class="handoff-empty">暂无关联文档</p>';
  panel.innerHTML = `
    <section class="handoff-section">
      <h3>待确认事项</h3>
      <div class="delivery-list">${questionRows}</div>
    </section>
    <section class="handoff-section">
      <h3>验收标准</h3>
      <div class="acceptance-list">${criterionRows}</div>
    </section>
    <section class="handoff-section">
      <h3>关联文档</h3>
      <div class="handoff-docs">${docRows}</div>
    </section>
  `;
}

function setHandoffTab(node, tabName) {
  node.querySelectorAll("[data-handoff-tab]").forEach((button) => {
    const active = button.dataset.handoffTab === tabName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  node.querySelectorAll("[data-handoff-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.handoffPanel === tabName);
  });
}

function bindHandoffTabs(node) {
  node.querySelectorAll("[data-handoff-tab]").forEach((button) => {
    button.addEventListener("click", () => setHandoffTab(node, button.dataset.handoffTab));
  });
}

function renderHandoff(node, page) {
  renderOverviewPanel(node, page);
  renderStatesPanel(node, page);
  renderDeliveryPanel(node, page);
  renderMarkers(node, page);
  bindHandoffTabs(node);
  setHandoffTab(node, "overview");
}

async function hydratePage(page) {
  let markers = page.markers || [];
  const specPath = page.specPath || `intermediate/page-specs/${page.id}.json`;
  let spec = null;
  try {
    const response = await fetch(specPath, { cache: "no-store" });
    if (response.ok) {
      spec = await response.json();
      if (Array.isArray(spec.annotations)) {
        const specMarkers = new Map(spec.annotations.map((marker) => [marker.id, marker]));
        markers = markers.length
          ? markers.map((marker) => ({
              ...specMarkers.get(marker.id),
              ...marker,
              anchor: {
                ...specMarkers.get(marker.id)?.anchor,
                ...marker.anchor,
              },
            }))
          : spec.annotations;
      }
    }
  } catch {
    // page spec 加载失败时，仍允许使用 prototype.json 中的页面和标注。
  }
  return { ...page, markers: markers.map(normalizeMarker), spec };
}

async function normalizeManifest(rawManifest, pageMap) {
  const rawPages = Array.isArray(rawManifest.pages) ? rawManifest.pages : [];
  const hydratedPages = await Promise.all(rawPages.map(hydratePage));
  const rawConnections = rawManifest.connections || pageMap?.connections || [];
  const connections = rawConnections.map((connection, index) => ({
    ...connection,
    id: connection.id || `connection-${index + 1}`,
    label: connection.label || connection.trigger || "页面跳转",
  }));
  const ranks = calculateRanks(hydratedPages, connections);
  const pages = hydratedPages.map((page) => ({
    ...page,
    module: page.module || "页面",
    rank: ranks.get(page.id) ?? 0,
    viewport: page.viewport || rawManifest.project?.viewport || { width: 1440, height: 900 },
  }));
  const pageIds = new Set(pages.map((page) => page.id));
  const navigation = normalizeNavigation(pageMap?.navigation || rawManifest.navigation, pageIds);
  const rawProject = rawManifest.project || {};
  const project = {
    id: rawProject.id || rawManifest.projectId || "prototype-project",
    name: rawProject.name || rawManifest.title || "HTML 原型项目",
    prototypeVersion: rawProject.prototypeVersion || rawProject.version || rawManifest.schemaVersion || "1.0",
    viewport: rawProject.viewport || pages[0]?.viewport || { width: 1440, height: 900 },
  };
  state.annotationStore = await readAnnotationStore(project);
  pages.forEach((page) => {
    page.systemMarkers = page.markers.map((marker) => ({ ...marker, origin: "system", modified: false }));
    refreshPageMarkers(page);
  });
  return {
    ...rawManifest,
    schemaVersion: rawManifest.schemaVersion || "1.0",
    project,
    pages,
    navigation,
    connections,
    startPageId: rawManifest.startPageId || pages[0]?.id,
    annotation: rawManifest.annotation || { generation: { label: "系统生成" } },
  };
}

function navigationTree() {
  if (state.manifest.navigation?.length) return state.manifest.navigation;
  return [{
    id: "all-pages",
    type: "folder",
    title: "全部页面",
    children: state.manifest.pages.map((page) => ({ pageId: page.id })),
  }];
}

function navigationNodeId(node) {
  return node.id || `page:${node.pageId}`;
}

function filterNavigation(nodes, keyword) {
  if (!keyword) return nodes;
  return nodes.flatMap((node) => {
    const page = node.pageId ? state.manifest.pages.find((item) => item.id === node.pageId) : null;
    const ownText = `${node.title || page?.title || ""} ${page?.module || ""}`.toLowerCase();
    const children = filterNavigation(node.children || [], keyword);
    if (!ownText.includes(keyword) && !children.length) return [];
    return [{ ...node, children: ownText.includes(keyword) ? (node.children || []) : children }];
  });
}

function toggleNavigationNode(nodeId) {
  if (state.collapsedNavNodes.has(nodeId)) state.collapsedNavNodes.delete(nodeId);
  else state.collapsedNavNodes.add(nodeId);
  renderNavigation(state.navFilter);
}

function renderNavigationNode(node, depth, forceExpanded) {
  const nodeId = navigationNodeId(node);
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const expanded = forceExpanded || !state.collapsedNavNodes.has(nodeId);
  const branch = document.createElement("div");
  branch.className = `nav-branch nav-level-${Math.min(depth, 3)}`;
  branch.dataset.navNode = nodeId;

  if (node.type === "folder") {
    const folder = document.createElement("button");
    folder.type = "button";
    folder.className = "nav-folder";
    folder.setAttribute("aria-expanded", String(expanded));
    folder.innerHTML = `<span class="nav-chevron" aria-hidden="true"></span><span class="nav-folder-icon" aria-hidden="true"></span><span class="nav-folder-title">${node.title}</span>`;
    folder.addEventListener("click", () => toggleNavigationNode(nodeId));
    branch.appendChild(folder);
  } else {
    const page = state.manifest.pages.find((item) => item.id === node.pageId);
    if (!page) return null;
    const row = document.createElement("div");
    row.className = `nav-page-row${hasChildren ? " has-children" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.page = page.id;
    button.innerHTML = `<span class="nav-dot" aria-hidden="true"></span><span class="nav-title">${page.title}</span>`;
    button.addEventListener("click", () => renderPageCanvas(page.id));
    row.appendChild(button);
    if (hasChildren) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "nav-page-toggle";
      toggle.setAttribute("aria-label", `${expanded ? "收起" : "展开"}${page.title}子页面`);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.innerHTML = '<span class="nav-chevron" aria-hidden="true"></span>';
      toggle.addEventListener("click", () => toggleNavigationNode(nodeId));
      row.appendChild(toggle);
    }
    branch.appendChild(row);
  }

  if (hasChildren && expanded) {
    const childContainer = document.createElement("div");
    childContainer.className = "nav-children";
    children.forEach((child) => {
      const childBranch = renderNavigationNode(child, depth + 1, forceExpanded);
      if (childBranch) childContainer.appendChild(childBranch);
    });
    branch.appendChild(childContainer);
  }
  return branch;
}

function renderNavigation(filter = state.navFilter) {
  state.navFilter = filter;
  const keyword = filter.trim().toLowerCase();
  els.pageNav.innerHTML = "";
  const nodes = filterNavigation(navigationTree(), keyword);
  nodes.forEach((node) => {
    const branch = renderNavigationNode(node, 0, Boolean(keyword));
    if (branch) els.pageNav.appendChild(branch);
  });
  if (!nodes.length) els.pageNav.innerHTML = '<div class="nav-empty">未找到匹配页面</div>';
  syncNavigation();
}

function findNavigationPath(pageId, nodes = navigationTree(), path = []) {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.pageId === pageId) return nextPath;
    const childPath = findNavigationPath(pageId, node.children || [], nextPath);
    if (childPath) return childPath;
  }
  return null;
}

function revealNavigationPath(pageId) {
  const path = findNavigationPath(pageId);
  if (!path) return;
  path.slice(0, -1).forEach((node) => state.collapsedNavNodes.delete(navigationNodeId(node)));
  renderNavigation(state.navFilter);
}

function createPageNode(page, pageNumber = 1, params = {}, restoreY = 0) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const viewport = page.viewport || state.manifest.project.viewport;
  const metrics = applyViewportPresentation(node, viewport);
  node.id = `node-${page.id}`;
  node.dataset.page = page.id;
  node.dataset.viewportWidth = viewport.width;
  node.dataset.viewportHeight = viewport.height;
  node.querySelector(".node-index").textContent = `P${String(pageNumber).padStart(2, "0")}`;
  node.querySelector(".node-title").textContent = page.title;
  node.querySelector(".node-module").textContent = page.module;
  const frame = node.querySelector("iframe");
  frame.src = versionedPagePath(page.path, params);
  frame.title = `${page.title}缩略预览`;
  node.querySelector(".viewport-label").textContent = `${viewport.width} × ${viewport.height} · ${metrics.kind === "mobile" ? "APP" : "WEB"}`;
  renderHandoff(node, page);
  bindMarkerViewport(node, frame);
  frame.addEventListener("load", () => {
    if (!restoreY) return;
    frame.contentWindow?.postMessage({ type: "prototype:restoreScroll", scrollY: restoreY }, "*");
  });
  const declaredStates = page.spec?.states;
  if (Array.isArray(declaredStates) && declaredStates.length) {
    const stateHost = node.querySelector(".state-button")?.parentElement;
    const labels = { normal: "正常", loading: "加载中", empty: "空态", error: "失败", forbidden: "无权限", expired: "已失效" };
    if (stateHost) {
      const previousButtons = [...stateHost.querySelectorAll(".state-button")];
      const firstButton = previousButtons[0];
      declaredStates.filter(item => item.applicable && labels[item.id]).forEach(item => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `state-button${item.id === "normal" ? " is-active" : ""}`;
        button.dataset.state = item.id;
        button.textContent = labels[item.id];
        stateHost.insertBefore(button, firstButton);
      });
      previousButtons.forEach(button => button.remove());
    }
  }
  node.querySelectorAll(".state-button").forEach((button) => {
    button.addEventListener("click", () => setPageState(node, button.dataset.state));
  });
  node.querySelector(".run-button").addEventListener("click", () => openPreview(page));
  node.querySelector(".screen-frame").addEventListener("dblclick", () => openPreview(page));
  return node;
}

function resetAnnotationInteraction() {
  const editing = state.editingMarker;
  if (editing) {
    const page = state.manifest?.pages.find((item) => item.id === editing.pageId);
    const marker = page?.markers.find((item) => item.id === editing.markerId);
    if (marker?._draft) page.markers = page.markers.filter((item) => item.id !== marker.id);
  }
  state.placement = null;
  state.editingMarker = null;
}

function renderPageCanvas(pageId, animate = true, params = {}, restoreY = 0) {
  const page = state.manifest.pages.find((item) => item.id === pageId);
  if (!page) return;
  if (state.activePage !== pageId) resetAnnotationInteraction();
  state.mode = "page";
  state.activePage = pageId;
  state.routeParams = { ...params };
  state.activeScrollY = restoreY;
  revealNavigationPath(pageId);
  history.replaceState(null, "", `#${pageId}`);
  const viewportKind = resolveViewportKind(page.viewport || state.manifest.project.viewport);
  els.canvas.className = `canvas is-page-canvas is-${viewportKind}-canvas`;
  els.flow.className = `flow is-page-mode is-${viewportKind}-mode`;
  els.flow.innerHTML = "";
  els.connections.innerHTML = "";
  const row = document.createElement("div");
  row.className = "rank-row";
  row.appendChild(createPageNode(page, state.manifest.pages.indexOf(page) + 1, params, restoreY));
  els.flow.appendChild(row);
  syncNavigation();
  requestAnimationFrame(() => {
    setZoom(1.25);
    els.workspace.scrollTo({ left: 0, top: 0, behavior: animate ? "smooth" : "auto" });
    setActive(pageId);
  });
}

function renderOverview() {
  resetAnnotationInteraction();
  state.mode = "overview";
  history.replaceState(null, "", "#overview");
  els.canvas.className = "canvas is-overview-canvas";
  els.flow.className = "flow is-overview-mode";
  els.flow.innerHTML = "";
  const ranks = [...new Set(state.manifest.pages.map((page) => page.rank))].sort((a, b) => a - b);
  let pageNumber = 0;
  ranks.forEach((rank) => {
    const row = document.createElement("div");
    row.className = "rank-row";
    row.dataset.rank = rank;
    state.manifest.pages.filter((page) => page.rank === rank).forEach((page) => {
      pageNumber += 1;
      const node = createPageNode(page, pageNumber);
      node.addEventListener("click", (event) => {
        if (!event.target.closest("button") && !event.target.closest("iframe")) renderPageCanvas(page.id);
      });
      row.appendChild(node);
    });
    els.flow.appendChild(row);
  });
  syncNavigation();
  requestAnimationFrame(() => {
    drawConnections();
    fitCanvas();
  });
}

function rerenderMarkers(node, page) {
  renderMarkers(node, page);
  const frame = node.querySelector("iframe");
  if (frame) requestAnimationFrame(() => syncMarkerBinding(node, frame));
}

function markerSource(marker) {
  if (marker.origin === "manual") return { label: "人工", className: "is-manual" };
  if (marker.modified) return { label: "已调整", className: "is-modified" };
  return { label: "系统", className: "is-system" };
}

function beginMarkerEdit(node, page, markerId, isNew = false) {
  state.placement = null;
  state.editingMarker = { pageId: page.id, markerId, isNew };
  setHandoffTab(node, "annotations");
  rerenderMarkers(node, page);
  node.querySelector(`.annotation-editor[data-marker="${CSS.escape(markerId)}"] input[name="title"]`)?.focus();
}

function cancelMarkerEdit(node, page, marker) {
  if (marker._draft) page.markers = page.markers.filter((item) => item.id !== marker.id);
  state.editingMarker = null;
  rerenderMarkers(node, page);
}

function saveMarkerEdit(node, page, marker, form) {
  if (!form.reportValidity()) return;
  const values = markerEditorValues(form);
  marker.title = values.title;
  marker.content = values.content;
  marker.editedAt = new Date().toISOString();
  delete marker._draft;
  state.editingMarker = null;
  persistMarker(page, marker);
  rerenderMarkers(node, page);
  activateMarker(node, marker.id, true);
}

function deleteMarker(node, page, marker) {
  const confirmed = window.confirm(`删除标注“${marker.title}”？`);
  if (!confirmed) return;
  state.editingMarker = null;
  state.placement = null;
  persistMarkerDeletion(page, marker);
  rerenderMarkers(node, page);
}

function restoreSystemMarker(node, page, marker) {
  const edits = ensurePageEdits(page.id);
  edits.updatedAt = new Date().toISOString();
  delete edits.updated[marker.id];
  refreshPageMarkers(page);
  writeAnnotationStore();
  rerenderMarkers(node, page);
  activateMarker(node, marker.id, true);
}

function markerEditorValues(form) {
  return {
    title: form.elements.title.value.trim(),
    content: form.elements.content.value.trim(),
  };
}

function renderMarkerEditor(node, page, marker, number) {
  const editorState = state.editingMarker?.pageId === page.id && state.editingMarker.markerId === marker.id
    ? state.editingMarker
    : {};
  const values = editorState.values || marker;
  const item = document.createElement("div");
  item.className = "annotation-item annotation-editor is-active";
  item.dataset.marker = marker.id;
  item.innerHTML = `
    <span class="annotation-number">${number}</span>
    <form class="annotation-edit-form">
      <label><span>标题</span><input name="title" maxlength="60" value="${escapeHtml(values.title)}" placeholder="标记对象名称" required /></label>
      <label><span>内容</span><textarea name="content" maxlength="8000" rows="12" placeholder="填写备注；需要分层时可在同一内容中分段" required>${escapeHtml(values.content)}</textarea></label>
      <div class="annotation-edit-actions">
        <button type="button" data-marker-action="relocate">重新定位</button>
        <span></span>
        <button type="button" data-marker-action="cancel">取消</button>
        <button type="submit" class="is-primary">保存</button>
      </div>
    </form>`;
  const form = item.querySelector("form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveMarkerEdit(node, page, marker, form);
  });
  item.querySelector('[data-marker-action="cancel"]').addEventListener("click", () => cancelMarkerEdit(node, page, marker));
  item.querySelector('[data-marker-action="relocate"]').addEventListener("click", () => {
    state.editingMarker = null;
    state.placement = {
      pageId: page.id,
      markerId: marker.id,
      returnToEditor: true,
      editorValues: markerEditorValues(form),
    };
    rerenderMarkers(node, page);
  });
  return item;
}

function renderMarkerItem(node, page, marker, number) {
  const source = markerSource(marker);
  const item = document.createElement("div");
  item.className = "annotation-item";
  item.dataset.marker = marker.id;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `查看标注 ${number}：${marker.title}`);
  const restoreButton = marker.origin === "system" && marker.modified
    ? `<button type="button" data-marker-action="restore" title="恢复系统备注" aria-label="恢复系统备注">↺</button>`
    : "";
  item.innerHTML = `
    <span class="annotation-number">${number}</span>
    <span class="annotation-content">
      <span class="annotation-title-row">
        <strong>${escapeHtml(marker.title)}</strong>
        <span class="annotation-item-actions">
          <em class="annotation-source ${source.className}">${source.label}</em>
          ${restoreButton}
          <button type="button" data-marker-action="edit" title="编辑标注" aria-label="编辑标注">✎</button>
          <button type="button" data-marker-action="delete" title="删除标注" aria-label="删除标注">×</button>
        </span>
      </span>
      <span class="annotation-description">${escapeHtml(marker.content)}</span>
    </span>`;
  item.addEventListener("click", (event) => {
    const action = event.target.closest("[data-marker-action]")?.dataset.markerAction;
    if (action === "edit") beginMarkerEdit(node, page, marker.id);
    else if (action === "delete") deleteMarker(node, page, marker);
    else if (action === "restore") restoreSystemMarker(node, page, marker);
    else if (!event.target.closest("a")) activateMarker(node, marker.id, false);
  });
  item.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !event.target.closest("button, a, input, textarea")) {
      event.preventDefault();
      activateMarker(node, marker.id, false);
    }
  });
  return item;
}

function markerDocumentPoint(node, screen, event) {
  const frame = node.querySelector("iframe");
  let scrollX = 0;
  let scrollY = 0;
  try {
    scrollX = frame.contentWindow.scrollX;
    scrollY = frame.contentWindow.scrollY;
  } catch {
    // 跨源页面以最近一次上报的视口位置为准，横向位置回退到 0。
    scrollY = state.activeScrollY;
  }
  return annotationStoreApi.documentPointFromClient({
    clientX: event.clientX,
    clientY: event.clientY,
    rect: screen.getBoundingClientRect(),
    screenWidth: screen.clientWidth,
    screenHeight: screen.clientHeight,
    viewportWidth: node.dataset.viewportWidth,
    viewportHeight: node.dataset.viewportHeight,
    scrollX,
    scrollY,
  });
}

function placeMarker(node, page, screen, event) {
  const point = markerDocumentPoint(node, screen, event);
  const placement = state.placement;
  if (placement?.markerId) {
    const marker = page.markers.find((item) => item.id === placement.markerId);
    if (!marker) return;
    marker.x = point.x;
    marker.y = point.y;
    marker.anchor = {
      anchorId: null,
      offset: { x: 0, y: 0 },
      fallback: { ...point, coordinateSpace: "reference-viewport-percent" },
      bindingStatus: "fallback-only",
    };
    marker.editedAt = new Date().toISOString();
    if (!marker._draft) persistMarker(page, marker);
    state.placement = null;
    state.editingMarker = placement.returnToEditor
      ? { pageId: page.id, markerId: marker.id, isNew: Boolean(marker._draft), values: placement.editorValues }
      : null;
    rerenderMarkers(node, page);
    activateMarker(node, marker.id, true);
    return;
  }

  const marker = {
    id: `USR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: "新标记",
    content: "",
    x: point.x,
    y: point.y,
    origin: "manual",
    _draft: true,
    createdAt: new Date().toISOString(),
    anchor: {
      anchorId: null,
      offset: { x: 0, y: 0 },
      fallback: { ...point, coordinateSpace: "reference-viewport-percent" },
      bindingStatus: "fallback-only",
    },
  };
  page.markers.push(marker);
  state.placement = null;
  state.editingMarker = { pageId: page.id, markerId: marker.id, isNew: true };
  setHandoffTab(node, "annotations");
  rerenderMarkers(node, page);
  node.querySelector(`.annotation-editor[data-marker="${CSS.escape(marker.id)}"] input[name="title"]`)?.focus();
}

function renderMarkers(node, page) {
  const markers = page.markers || [];
  const screen = node.querySelector(".screen-frame");
  screen.querySelector(".marker-layer")?.remove();
  screen.querySelector(".marker-placement-layer")?.remove();
  const layer = document.createElement("div");
  layer.className = "marker-layer";
  const list = node.querySelector(".annotation-list");
  updateAnnotationStorageStatusElement(node.querySelector(".annotation-storage-status"));
  list.innerHTML = "";
  const markerToggle = node.querySelector(".marker-toggle input");
  const addButton = node.querySelector(".annotation-add-button");
  const placementActive = state.placement?.pageId === page.id;
  const editingActive = state.editingMarker?.pageId === page.id;
  node.querySelector(".annotation-count").textContent = `${markers.length} 项`;
  markerToggle.checked = state.showMarkers;
  markerToggle.onchange = () => setMarkerVisibility(markerToggle.checked);
  addButton.classList.toggle("is-active", placementActive && !state.placement.markerId);
  addButton.setAttribute("aria-pressed", String(placementActive && !state.placement.markerId));
  addButton.querySelector("b").textContent = placementActive && !state.placement.markerId ? "取消" : "标记";
  addButton.disabled = editingActive;
  addButton.onclick = () => {
    state.placement = placementActive ? null : { pageId: page.id, markerId: null };
    state.editingMarker = null;
    setMarkerVisibility(true);
    rerenderMarkers(node, page);
  };
  node.classList.toggle("markers-hidden", !state.showMarkers);
  node.classList.toggle("is-placing-marker", placementActive);

  markers.forEach((marker, index) => {
    const number = index + 1;
    const point = document.createElement("button");
    point.type = "button";
    point.className = "annotation-marker";
    point.dataset.marker = marker.id;
    point.style.left = `${marker.x}%`;
    point.style.top = `${marker.y}%`;
    point.dataset.fallbackX = String(marker.x);
    point.dataset.fallbackY = String(marker.y);
    point.dataset.bindingStatus = marker.anchor?.bindingStatus || "fallback-only";
    point.dataset.anchorId = marker.anchor?.anchorId || "";
    point.dataset.anchorOffsetX = String(Number(marker.anchor?.offset?.x) || 0);
    point.dataset.anchorOffsetY = String(Number(marker.anchor?.offset?.y) || 0);
    point.dataset.previewTriggerId = marker.anchor?.previewTriggerId || "";
    point.dataset.previewOffsetX = String(Number(marker.anchor?.previewOffset?.x) || 0);
    point.dataset.previewOffsetY = String(Number(marker.anchor?.previewOffset?.y ?? -24) || 0);
    point.textContent = number;
    point.setAttribute("aria-label", `标注 ${number}：${marker.title}`);
    point.addEventListener("click", () => {
      setHandoffTab(node, "annotations");
      activateMarker(node, marker.id, true);
    });
    layer.appendChild(point);

    const editing = state.editingMarker?.pageId === page.id && state.editingMarker.markerId === marker.id;
    list.appendChild(editing
      ? renderMarkerEditor(node, page, marker, number)
      : renderMarkerItem(node, page, marker, number));
  });

  screen.appendChild(layer);
  if (placementActive) {
    const placementLayer = document.createElement("button");
    placementLayer.type = "button";
    placementLayer.className = "marker-placement-layer";
    placementLayer.setAttribute("aria-label", state.placement.markerId ? "重新放置标记" : "放置新标记");
    placementLayer.addEventListener("click", (event) => placeMarker(node, page, screen, event));
    screen.appendChild(placementLayer);
  }
  if (!markers.length) {
    list.innerHTML = '<div class="annotation-empty">当前页面暂无点位说明</div>';
  } else if (editingActive) {
    activateMarker(node, state.editingMarker.markerId, false);
  } else {
    activateMarker(node, markers[0].id, false);
  }
}

function syncMarkerViewport(node, scrollX = 0, scrollY = 0) {
  const screen = node.querySelector(".screen-frame");
  const layer = node.querySelector(".marker-layer");
  if (!screen || !layer) return;
  const viewportWidth = Number(node.dataset.viewportWidth) || 1;
  const viewportHeight = Number(node.dataset.viewportHeight) || 1;
  const safeScrollX = Number.isFinite(Number(scrollX)) ? Number(scrollX) : 0;
  const safeScrollY = Number.isFinite(Number(scrollY)) ? Number(scrollY) : 0;
  const offsetX = safeScrollX * (screen.clientWidth / viewportWidth);
  const offsetY = safeScrollY * (screen.clientHeight / viewportHeight);
  layer.style.transform = `translate3d(${-offsetX}px, ${-offsetY}px, 0)`;
}

function useMarkerFallback(point) {
  point.hidden = false;
  point.dataset.anchorResolved = "false";
  point.style.left = `${Number(point.dataset.fallbackX) || 50}%`;
  point.style.top = `${Number(point.dataset.fallbackY) || 50}%`;
}

function markerTriggerFor(frameDocument, triggerId) {
  if (!triggerId) return null;
  return [...frameDocument.querySelectorAll("[data-prototype-trigger-for]")]
    .filter((element) => (
      element.getClientRects().length
      && String(element.dataset.prototypeTriggerFor || "").split(/\s+/).includes(triggerId)
    ))
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.left - rightRect.left || leftRect.top - rightRect.top;
    })[0] || null;
}

function positionMarkerAtElement(point, element, frameWindow, scaleX, scaleY, options = {}) {
  const rect = element.getBoundingClientRect();
  const centered = Boolean(options.centered);
  const offsetX = Number(options.offsetX) || 0;
  const offsetY = Number(options.offsetY) || 0;
  const documentX = rect.left + frameWindow.scrollX + (centered ? rect.width / 2 : 0) + offsetX;
  const documentY = rect.top + frameWindow.scrollY + (centered ? rect.height / 2 : 0) + offsetY;
  point.style.left = `${documentX * scaleX}px`;
  point.style.top = `${documentY * scaleY}px`;
  point.hidden = false;
}

function positionMarkersFromAnchors(node, frame) {
  const screen = node.querySelector(".screen-frame");
  const points = [...node.querySelectorAll(".annotation-marker")];
  if (!screen || !points.length) return 0;

  let frameDocument;
  let frameWindow;
  try {
    frameDocument = frame.contentDocument;
    frameWindow = frame.contentWindow;
  } catch {
    return 0;
  }
  if (!frameDocument || !frameWindow) return 0;

  const viewportWidth = Number(node.dataset.viewportWidth) || 1;
  const viewportHeight = Number(node.dataset.viewportHeight) || 1;
  const scaleX = screen.clientWidth / viewportWidth;
  const scaleY = screen.clientHeight / viewportHeight;
  let resolved = 0;

  points.forEach((point) => {
    const anchorId = point.dataset.anchorId;
    if (point.dataset.bindingStatus !== "bound" || !anchorId) {
      useMarkerFallback(point);
      return;
    }

    const anchor = frameDocument.getElementById(anchorId);
    if (!anchor) {
      useMarkerFallback(point);
      return;
    }
    if (anchor.getClientRects().length) {
      positionMarkerAtElement(point, anchor, frameWindow, scaleX, scaleY, {
        offsetX: point.dataset.anchorOffsetX,
        offsetY: point.dataset.anchorOffsetY,
      });
      point.dataset.anchorResolved = "true";
      resolved += 1;
      return;
    }

    const previewTriggerId = point.dataset.previewTriggerId || anchorId;
    const previewTrigger = markerTriggerFor(frameDocument, previewTriggerId);
    if (previewTrigger?.getClientRects().length) {
      positionMarkerAtElement(point, previewTrigger, frameWindow, scaleX, scaleY, {
        offsetX: point.dataset.previewOffsetX,
        offsetY: point.dataset.previewOffsetY,
      });
      point.dataset.anchorResolved = "preview";
      resolved += 1;
      return;
    }

    point.hidden = true;
    point.dataset.anchorResolved = "pending";
  });

  return resolved;
}

function syncMarkerBinding(node, frame) {
  positionMarkersFromAnchors(node, frame);
  try {
    syncMarkerViewport(node, frame.contentWindow.scrollX, frame.contentWindow.scrollY);
  } catch {
    syncMarkerViewport(node, 0, 0);
  }
}

function bindMarkerViewport(node, frame) {
  let cleanup = null;
  frame.addEventListener("load", () => {
    cleanup?.();
    try {
      let pendingFrame = null;
      const queueSync = () => {
        if (pendingFrame) return;
        pendingFrame = frame.contentWindow.requestAnimationFrame(() => {
          pendingFrame = null;
          syncMarkerBinding(node, frame);
        });
      };
      const frameWindow = frame.contentWindow;
      const frameDocument = frame.contentDocument;
      frameWindow.addEventListener("scroll", queueSync, { passive: true });
      frameWindow.addEventListener("resize", queueSync, { passive: true });

      const resizeObserver = typeof frameWindow.ResizeObserver === "function"
        ? new frameWindow.ResizeObserver(queueSync)
        : null;
      resizeObserver?.observe(frameDocument.documentElement);
      node.querySelectorAll(".annotation-marker[data-anchor-id]").forEach((point) => {
        const anchor = frameDocument.getElementById(point.dataset.anchorId);
        if (anchor) resizeObserver?.observe(anchor);
      });

      const mutationObserver = typeof frameWindow.MutationObserver === "function"
        ? new frameWindow.MutationObserver(queueSync)
        : null;
      if (frameDocument.body) {
        mutationObserver?.observe(frameDocument.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden"],
        });
      }

      cleanup = () => {
        frameWindow.removeEventListener("scroll", queueSync);
        frameWindow.removeEventListener("resize", queueSync);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        if (pendingFrame) frameWindow.cancelAnimationFrame(pendingFrame);
      };

      syncMarkerBinding(node, frame);
      frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(queueSync));
    } catch {
      // Cross-origin pages synchronize through the prototype:viewport message.
      syncMarkerViewport(node, 0, 0);
    }
  });
}

function activateMarker(node, markerId, scrollList) {
  node.querySelectorAll(".annotation-marker").forEach((element) => element.classList.toggle("is-active", element.dataset.marker === markerId));
  node.querySelectorAll(".annotation-item").forEach((element) => {
    const active = element.dataset.marker === markerId;
    element.classList.toggle("is-active", active);
    if (active && scrollList) element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function setMarkerVisibility(visible) {
  state.showMarkers = visible;
  document.querySelectorAll(".page-node").forEach((node) => node.classList.toggle("markers-hidden", !visible));
  document.querySelectorAll(".marker-toggle input").forEach((input) => { input.checked = visible; });
}

function setPageState(node, nextState) {
  node.querySelectorAll(".state-button").forEach((button) => button.classList.toggle("is-active", button.dataset.state === nextState));
  const iframe = node.querySelector("iframe");
  iframe.contentWindow?.postMessage({ type: "prototype:setState", state: nextState }, "*");
  iframe.contentWindow?.postMessage({ type: "prototype:set-state", state: nextState }, "*");
}

function setActive(pageId) {
  state.activePage = pageId;
  document.querySelectorAll(".page-node").forEach((node) => node.classList.toggle("is-focused", node.dataset.page === pageId));
  syncNavigation();
}

function syncNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = state.mode === "page" && item.dataset.page === state.activePage;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  els.overviewNav.classList.toggle("is-active", state.mode === "overview");
}

function configurePreview(page, params = {}, restoreY = 0) {
  const viewport = page.viewport || state.manifest.project.viewport;
  const metrics = previewMetrics(viewport);
  state.activePage = page.id;
  state.routeParams = { ...params };
  state.activeScrollY = restoreY;
  state.previewPath = versionedPagePath(page.path, params);
  els.previewTitle.textContent = page.title;
  els.previewDialog.classList.toggle("is-mobile-preview", metrics.kind === "mobile");
  els.previewDialog.classList.toggle("is-web-preview", metrics.kind === "web");
  els.previewDevice.style.setProperty("--preview-viewport-width", `${metrics.width}px`);
  els.previewDevice.style.setProperty("--preview-viewport-height", `${metrics.height}px`);
  els.previewFrame.src = state.previewPath;
  els.previewFrame.addEventListener("load", () => {
    if (!restoreY) return;
    els.previewFrame.contentWindow?.postMessage({ type: "prototype:restoreScroll", scrollY: restoreY }, "*");
  }, { once: true });
}

function openPreview(page) {
  state.routeStack = [];
  configurePreview(page, {});
  els.previewDialog.showModal();
}

function routeTo(page, params = {}, sourceScrollY = 0) {
  if (state.activePage) {
    state.routeStack.push({
      pageId: state.activePage,
      params: { ...state.routeParams },
      scrollY: Number(sourceScrollY) || state.activeScrollY || 0,
    });
  }
  if (els.previewDialog.open) configurePreview(page, params, 0);
  else renderPageCanvas(page.id, true, params, 0);
}

function routeBack(fallbackPageId) {
  const previous = state.routeStack.pop();
  const fallback = state.manifest.pages.find((item) => item.id === fallbackPageId);
  const page = previous
    ? state.manifest.pages.find((item) => item.id === previous.pageId)
    : fallback;
  if (!page) return;
  const params = previous?.params || {};
  const scrollY = previous?.scrollY || 0;
  if (els.previewDialog.open) configurePreview(page, params, scrollY);
  else renderPageCanvas(page.id, true, params, scrollY);
}

function setZoom(nextZoom) {
  state.zoom = Math.min(1.5, Math.max(0.5, nextZoom));
  els.canvas.style.transform = `scale(${state.zoom})`;
  els.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  document.querySelectorAll("[data-zoom-level]").forEach((button) => {
    button.classList.toggle("is-active", Math.abs(Number(button.dataset.zoomLevel) - state.zoom) < 0.005);
  });
  requestAnimationFrame(updateSizer);
}

function stepZoom(direction) {
  const target = direction > 0
    ? zoomLevels.find((level) => level > state.zoom + 0.005) ?? zoomLevels.at(-1)
    : [...zoomLevels].reverse().find((level) => level < state.zoom - 0.005) ?? zoomLevels[0];
  setZoom(target);
}

function setZoomMenu(open) {
  els.zoomMenu.hidden = !open;
  els.zoomMenuButton.setAttribute("aria-expanded", String(open));
  els.zoomMenuButton.classList.toggle("is-open", open);
}

function updateSizer() {
  const rawWidth = els.canvas.scrollWidth;
  const rawHeight = els.canvas.scrollHeight;
  els.canvasSizer.style.width = `${Math.max(els.workspace.clientWidth, rawWidth * state.zoom)}px`;
  els.canvasSizer.style.height = `${Math.max(els.workspace.clientHeight, rawHeight * state.zoom)}px`;
}

function fitCanvas(animate = true) {
  const activePage = state.manifest.pages.find((page) => page.id === state.activePage);
  const isMobilePage = state.mode === "page" && resolveViewportKind(activePage?.viewport || state.manifest.project.viewport) === "mobile";
  const gutter = isMobilePage ? 32 : 72;
  const widthZoom = (els.workspace.clientWidth - gutter) / els.canvas.scrollWidth;
  const heightZoom = (els.workspace.clientHeight - gutter) / els.canvas.scrollHeight;
  const limit = state.mode === "page" ? 1 : 0.62;
  setZoom(Math.min(limit, widthZoom, heightZoom));
  els.workspace.scrollTo({ left: 0, top: 0, behavior: animate ? "smooth" : "auto" });
}

function offsetWithin(element, ancestor) {
  let left = 0;
  let top = 0;
  let current = element;
  while (current && current !== ancestor) {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent;
  }
  return { left, top };
}

function drawConnections() {
  if (state.mode !== "overview") return;
  const width = els.canvas.scrollWidth;
  const height = els.canvas.scrollHeight;
  els.connections.setAttribute("viewBox", `0 0 ${width} ${height}`);
  els.connections.innerHTML = "";
  state.manifest.connections.forEach((connection) => {
    const from = document.querySelector(`#node-${CSS.escape(connection.from)}`);
    const to = document.querySelector(`#node-${CSS.escape(connection.to)}`);
    if (!from || !to) return;
    const fromPos = offsetWithin(from, els.canvas);
    const toPos = offsetWithin(to, els.canvas);
    const x1 = fromPos.left + from.offsetWidth / 2;
    const y1 = fromPos.top + from.offsetHeight;
    const x2 = toPos.left + to.offsetWidth / 2;
    const y2 = toPos.top;
    const middle = y1 + (y2 - y1) * 0.5;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "connection-path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`);
    els.connections.appendChild(path);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", "connection-dot");
    dot.setAttribute("cx", x2);
    dot.setAttribute("cy", y2);
    dot.setAttribute("r", 4);
    els.connections.appendChild(dot);
    const labelX = (x1 + x2) / 2;
    const labelY = middle;
    const labelWidth = Math.max(90, connection.label.length * 12 + 22);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "connection-label");
    group.innerHTML = `<rect x="${labelX - labelWidth / 2}" y="${labelY - 13}" width="${labelWidth}" height="26"></rect><text x="${labelX}" y="${labelY + 1}">${connection.label}</text>`;
    els.connections.appendChild(group);
  });
}

document.querySelector('[data-zoom="in"]').addEventListener("click", () => stepZoom(1));
document.querySelector('[data-zoom="out"]').addEventListener("click", () => stepZoom(-1));
els.zoomMenuButton.addEventListener("click", () => setZoomMenu(els.zoomMenu.hidden));
els.zoomMenu.querySelectorAll("[data-zoom-level]").forEach((button) => {
  button.addEventListener("click", () => {
    setZoom(Number(button.dataset.zoomLevel));
    setZoomMenu(false);
  });
});
document.querySelector("#fitButton").addEventListener("click", fitCanvas);
document.querySelector("#resetButton").addEventListener("click", () => state.mode === "overview" ? renderOverview() : renderPageCanvas(state.activePage || state.manifest.startPageId));
els.overviewNav.addEventListener("click", renderOverview);
document.querySelector("#closePreview").addEventListener("click", () => els.previewDialog.close());
document.querySelector("#openNewWindow").addEventListener("click", () => state.previewPath && window.open(state.previewPath, "_blank", "noopener"));
els.pageSearch.addEventListener("input", (event) => renderNavigation(event.target.value));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".zoom-picker")) setZoomMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setZoomMenu(false);
  if (event.key === "Escape" && (state.placement || state.editingMarker) && !els.previewDialog.open) {
    const page = state.manifest.pages.find((item) => item.id === state.activePage);
    const node = page && document.querySelector(`#node-${CSS.escape(page.id)}`);
    const marker = page && state.editingMarker
      ? page.markers.find((item) => item.id === state.editingMarker.markerId)
      : null;
    if (node && marker) cancelMarkerEdit(node, page, marker);
    else if (node && page) {
      resetAnnotationInteraction();
      rerenderMarkers(node, page);
    }
  }
});

window.addEventListener("message", (event) => {
  if (event.data?.type === "prototype:viewport") {
    if (event.source === els.previewFrame.contentWindow || event.source === document.querySelector(".page-node iframe")?.contentWindow) {
      state.activeScrollY = Number(event.data.scrollY) || 0;
    }
    const frame = [...document.querySelectorAll(".page-node iframe")].find((item) => item.contentWindow === event.source);
    const node = frame?.closest(".page-node");
    if (node) syncMarkerViewport(node, event.data.scrollX, event.data.scrollY);
    return;
  }
  if (event.data?.type === "prototype:back") {
    routeBack(event.data.fallback || event.data.target);
    return;
  }
  if (event.data?.type !== "prototype:navigate") return;
  const targetPageId = event.data.target || event.data.pageId;
  const page = state.manifest.pages.find((item) => item.id === targetPageId);
  if (!page) return;
  routeTo(page, event.data.params || {}, event.data.scrollY);
});

window.addEventListener("resize", () => {
  updateSizer();
  if (state.mode === "overview") drawConnections();
  document.querySelectorAll(".page-node").forEach((node) => {
    const frame = node.querySelector("iframe");
    if (frame) syncMarkerBinding(node, frame);
  });
});

let pan = null;
els.workspace.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".page-node")) return;
  pan = { x: event.clientX, y: event.clientY, left: els.workspace.scrollLeft, top: els.workspace.scrollTop };
  els.workspace.classList.add("is-panning");
  els.workspace.setPointerCapture(event.pointerId);
});
els.workspace.addEventListener("pointermove", (event) => {
  if (!pan) return;
  els.workspace.scrollLeft = pan.left - (event.clientX - pan.x);
  els.workspace.scrollTop = pan.top - (event.clientY - pan.y);
});
els.workspace.addEventListener("pointerup", () => { pan = null; els.workspace.classList.remove("is-panning"); });

boot().catch((error) => {
  els.flow.innerHTML = `<div style="padding:40px;color:#ff9a92">${error.message}<br><small>请通过本地 HTTP 服务打开此原型。</small></div>`;
});
