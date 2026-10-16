const state = {
  manifest: null,
  mode: "page",
  zoom: 1,
  autoFit: true,
  sidebarOpen: window.innerWidth > 720,
  inspectorOpen: window.innerWidth > 980,
  handoffTab: "overview",
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
  template: document.querySelector("#pageNodeTemplate"),
  previewDialog: document.querySelector("#previewDialog"),
  previewViewport: document.querySelector("#previewViewport"),
  previewDevice: document.querySelector("#previewDevice"),
  previewFrame: document.querySelector("#previewFrame"),
  previewTitle: document.querySelector("#previewTitle"),
  inspector: document.querySelector("#inspector"),
  sidebar: document.querySelector("#sidebar"),
  appShell: document.querySelector(".app-shell"),
  shortcutsDialog: document.querySelector("#shortcutsDialog"),
  advancedTools: document.querySelector("#advancedTools"),
  moreTools: document.querySelector("#moreTools"),
  moreToolsButton: document.querySelector("#moreToolsButton"),
};

const zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const annotationStoreApi = window.PrototypeAnnotationStore;

// Inspectors live outside the transformed canvas in page mode.
function inspectorFor(node) {
  return node._inspector || node.querySelector(".annotation-card");
}

function activeNode() {
  return state.activePage && document.querySelector(`#node-${CSS.escape(state.activePage)}`);
}

function applyPanelState() {
  els.appShell.classList.toggle("is-sidebar-hidden", !state.sidebarOpen);
  els.appShell.classList.toggle("is-inspector-hidden", !state.inspectorOpen);
  document.querySelector("#toggleSidebar").setAttribute("aria-expanded", String(state.sidebarOpen));
  document.querySelector("#toggleInspector").setAttribute("aria-expanded", String(state.inspectorOpen));
  document.querySelector("#toggleInspector").classList.toggle("is-active", state.inspectorOpen);
  const drawerOpen = (window.innerWidth <= 720 && state.sidebarOpen) || (window.innerWidth <= 980 && state.inspectorOpen);
  document.querySelector("#panelBackdrop").hidden = !drawerOpen;
  requestAnimationFrame(() => state.autoFit && state.manifest ? fitCanvas(false) : updateSizer());
}

function positionTopPopover(panel, trigger, width) {
  const rect = trigger.getBoundingClientRect();
  panel.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))}px`;
  panel.style.top = `${rect.bottom + 10}px`;
}

function syncTopTools() {
  const compact = window.innerWidth <= 1000;
  const target = document.querySelector(compact ? "#compactTools" : "#desktopTools");
  if (els.advancedTools.parentElement !== target) {
    setZoomMenu(false);
    if (els.moreTools.matches(":popover-open")) els.moreTools.hidePopover();
    target.appendChild(els.advancedTools);
  }
  els.moreToolsButton.hidden = !compact;
}

function togglePanel(panel, open) {
  const panelElement = panel === "sidebar" ? els.sidebar : els.inspector;
  const focusWasInside = panelElement?.contains(document.activeElement);
  state[`${panel}Open`] = open ?? !state[`${panel}Open`];
  if (state[`${panel}Open`] && window.innerWidth <= 720) {
    state[panel === "sidebar" ? "inspectorOpen" : "sidebarOpen"] = false;
  }
  applyPanelState();
  const isDrawer = window.innerWidth <= (panel === "sidebar" ? 720 : 980);
  if (isDrawer && state[`${panel}Open`]) panelElement?.querySelector("button, input")?.focus();
  else if (focusWasInside) document.querySelector(panel === "sidebar" ? "#toggleSidebar" : "#toggleInspector").focus();
}

let toastTimer;
function notify(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

function canLeaveEditor() {
  if (!state.editingMarker) return true;
  const node = activeNode();
  const form = node && inspectorFor(node)?.querySelector(".annotation-edit-form");
  const page = state.manifest?.pages.find(item => item.id === state.editingMarker.pageId);
  const marker = page?.markers.find(item => item.id === state.editingMarker.markerId);
  if (!form || !marker) return true;
  const values = markerEditorValues(form);
  if (!marker._draft && values.title === marker.title && values.content === marker.content) return true;
  return window.confirm("当前标注尚未保存。放弃本次修改并继续？");
}

function updateWorkspaceContext() {
  if (!state.manifest) return;
  const page = state.manifest.pages.find(item => item.id === state.activePage);
  const overview = state.mode === "overview";
  document.querySelector("#activePageTitle").textContent = overview ? "项目流程总览" : page?.title || "未选择页面";
  document.querySelector("#pagePosition").textContent = overview ? `${state.manifest.pages.length} 个页面` : `${state.manifest.pages.indexOf(page) + 1} / ${state.manifest.pages.length} 页`;
  document.querySelector("#pageModeButton").classList.toggle("is-active", !overview);
  document.querySelector("#pageModeButton").setAttribute("aria-pressed", String(!overview));
  els.overviewNav.setAttribute("aria-pressed", String(overview));
  document.querySelector("#canvasHint").textContent = state.placement ? "点击原型放置标注 · Esc 取消" : overview ? "选择页面查看详情" : "M 显隐标注 · 0 适应画布";
}

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
  if (!element) return;
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
  document.title = `${state.manifest.project.name} · 原型工作台`;
  const rawInitialView = window.location.hash.slice(1);
  let initialView = rawInitialView;
  try {
    initialView = decodeURIComponent(rawInitialView);
  } catch {
    // 编码异常时保留原值，并按默认页面兜底。
  }
  syncTopTools();
  applyPanelState();
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
  // 100% means one canvas CSS pixel per declared viewport pixel.
  const pageScale = 1;
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
    ? normalizedItems.map((item) => `<div class="handoff-row"><strong>${escapeHtml(item.label)}</strong>${item.description && item.description !== item.label ? `<p>${escapeHtml(item.description)}</p>` : ""}</div>`).join("")
    : `<p class="handoff-empty">${escapeHtml(emptyText)}</p>`;
  return `<section class="handoff-section"><h3>${escapeHtml(title)}</h3><div class="handoff-rows">${content}</div></section>`;
}

function renderOverviewPanel(node, page) {
  const panel = inspectorFor(node).querySelector('[data-handoff-panel="overview"]');
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
  const panel = inspectorFor(node).querySelector('[data-handoff-panel="states"]');
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
  const panel = inspectorFor(node).querySelector('[data-handoff-panel="delivery"]');
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
  if (state.mode === "page") state.handoffTab = tabName;
  inspectorFor(node).querySelectorAll("[data-handoff-tab]").forEach((button) => {
    const active = button.dataset.handoffTab === tabName;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  inspectorFor(node).querySelectorAll("[data-handoff-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.handoffPanel === tabName);
  });
}

function bindHandoffTabs(node) {
  const buttons = [...inspectorFor(node).querySelectorAll("[data-handoff-tab]")];
  buttons.forEach((button, index) => {
    const name = button.dataset.handoffTab;
    button.id = `tab-${node.id}-${name}`;
    button.setAttribute("aria-controls", `panel-${node.id}-${name}`);
    const panel = inspectorFor(node).querySelector(`[data-handoff-panel="${name}"]`);
    panel.id = `panel-${node.id}-${name}`;
    panel.setAttribute("aria-labelledby", button.id);
    button.addEventListener("click", () => setHandoffTab(node, button.dataset.handoffTab));
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      setHandoffTab(node, buttons[target].dataset.handoffTab);
      buttons[target].focus();
    });
  });
}

function renderHandoff(node, page) {
  renderOverviewPanel(node, page);
  renderStatesPanel(node, page);
  renderDeliveryPanel(node, page);
  renderMarkers(node, page);
  bindHandoffTabs(node);
  setHandoffTab(node, state.handoffTab);
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
        const manifestMarkers = new Map(markers.map(marker => [marker.id, marker]));
        // The spec is authoritative; the manifest only supplies legacy geometry.
        markers = spec.annotations.map(marker => ({
          ...manifestMarkers.get(marker.id),
          ...marker,
          anchor: { ...manifestMarkers.get(marker.id)?.anchor, ...marker.anchor },
        }));
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
    folder.innerHTML = `<span class="nav-chevron" aria-hidden="true"></span><svg class="icon" aria-hidden="true"><use href="#icon-folder"/></svg><span class="nav-folder-title">${escapeHtml(node.title)}</span>`;
    folder.title = node.title;
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
    button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-page"/></svg><span class="nav-title">${escapeHtml(page.title)}</span>`;
    button.title = `${page.title} · ${resolveViewportKind(page.viewport || state.manifest.project.viewport) === "mobile" ? "App" : "Web"}`;
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
  node.querySelector(".close-inspector").addEventListener("click", () => togglePanel("inspector", false));
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
  if (state.editingMarker && !canLeaveEditor()) return;
  resetAnnotationInteraction();
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
  const node = createPageNode(page, state.manifest.pages.indexOf(page) + 1, params, restoreY);
  node._inspector = node.querySelector(".annotation-card");
  els.inspector.replaceChildren(node._inspector);
  row.appendChild(node);
  els.flow.appendChild(row);
  if (window.innerWidth <= 720) { state.sidebarOpen = false; applyPanelState(); }
  syncNavigation();
  requestAnimationFrame(() => {
    if (state.autoFit) fitCanvas(false);
    else setZoom(state.zoom);
    els.workspace.scrollTo({ left: 0, top: 0, behavior: animate ? "smooth" : "auto" });
    setActive(pageId);
  });
}

function renderOverview() {
  if (!state.manifest || !canLeaveEditor()) return;
  resetAnnotationInteraction();
  state.mode = "overview";
  els.inspector.innerHTML = '<div class="inspector-empty"><svg class="icon" aria-hidden="true"><use href="#icon-flow"/></svg><strong>查看完整页面流程</strong><p>选择任一页面，查看概要、标注与交付说明。</p></div>';
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
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", `打开${page.title}页面说明`);
      node.addEventListener("keydown", event => {
        if (event.target === node && ["Enter", " "].includes(event.key)) { event.preventDefault(); renderPageCanvas(page.id); }
      });
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
    fitCanvas(false);
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
  if (state.editingMarker && state.editingMarker.markerId !== markerId) {
    if (!canLeaveEditor()) return;
    resetAnnotationInteraction();
  }
  state.placement = null;
  state.editingMarker = { pageId: page.id, markerId, isNew };
  setHandoffTab(node, "annotations");
  rerenderMarkers(node, page);
  togglePanel("inspector", true);
  inspectorFor(node).querySelector(`.annotation-editor[data-marker="${CSS.escape(markerId)}"] input[name="title"]`)?.focus();
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
    if (window.innerWidth <= 980) togglePanel("inspector", false);
    rerenderMarkers(node, page);
  });
  return item;
}

function renderMarkerItem(node, page, marker, number) {
  const source = markerSource(marker);
  const item = document.createElement("div");
  item.className = "annotation-item";
  item.dataset.marker = marker.id;
  const descriptionId = `${node.id}-annotation-${marker.id}`;
  const restoreButton = marker.origin === "system" && marker.modified
    ? `<button type="button" data-marker-action="restore" title="恢复系统备注" aria-label="恢复系统备注">↺</button>`
    : "";
  item.innerHTML = `
    <span class="annotation-number">${number}</span>
    <span class="annotation-content">
      <span class="annotation-title-row">
        <button type="button" class="annotation-disclosure" aria-expanded="false" aria-controls="${escapeHtml(descriptionId)}" title="展开标注"><strong>${escapeHtml(marker.title)}</strong><svg class="annotation-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>
        <span class="annotation-item-actions">
          <em class="annotation-source ${source.className}">${source.label}</em>
          ${restoreButton}
          <button type="button" data-marker-action="edit" title="编辑标注" aria-label="编辑标注">✎</button>
          <button type="button" data-marker-action="delete" title="删除标注" aria-label="删除标注">×</button>
        </span>
      </span>
      <span id="${escapeHtml(descriptionId)}" class="annotation-description" hidden>${escapeHtml(marker.content)}</span>
    </span>`;
  item.addEventListener("click", (event) => {
    const action = event.target.closest("[data-marker-action]")?.dataset.markerAction;
    if (action === "edit") beginMarkerEdit(node, page, marker.id);
    else if (action === "delete") deleteMarker(node, page, marker);
    else if (action === "restore") restoreSystemMarker(node, page, marker);
    else if (!event.target.closest("a") && (event.target.closest(".annotation-disclosure") || !event.detail || !window.getSelection()?.toString())) {
      const expanded = !item.classList.contains("is-active");
      activateMarker(node, expanded ? marker.id : null, false);
      if (expanded) focusMarker(node, marker);
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
    togglePanel("inspector", true);
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
  togglePanel("inspector", true);
  inspectorFor(node).querySelector(`.annotation-editor[data-marker="${CSS.escape(marker.id)}"] input[name="title"]`)?.focus();
}

function renderMarkers(node, page) {
  const markers = page.markers || [];
  const screen = node.querySelector(".screen-frame");
  screen.querySelector(".marker-layer")?.remove();
  screen.querySelector(".marker-placement-layer")?.remove();
  const layer = document.createElement("div");
  layer.className = "marker-layer";
  const inspector = inspectorFor(node);
  const list = inspector.querySelector(".annotation-list");
  updateAnnotationStorageStatusElement(inspector.querySelector(".annotation-storage-status"));
  list.innerHTML = "";
  const markerToggle = inspector.querySelector(".marker-toggle input");
  const addButton = inspector.querySelector(".annotation-add-button");
  const placementActive = state.placement?.pageId === page.id;
  const editingActive = state.editingMarker?.pageId === page.id;
  inspector.querySelector(".annotation-count").textContent = `${markers.length} 条标注`;
  inspector.querySelector(".tab-marker-count").textContent = markers.length;
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
    if (window.innerWidth <= 980 && state.placement) togglePanel("inspector", false);
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
      togglePanel("inspector", true);
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
    const previous = node._activeMarkerId;
    const next = previous === null ? null : markers.some(marker => marker.id === previous) ? previous : markers[0].id;
    activateMarker(node, next, false);
  }
  if (state.mode === "page") updateWorkspaceContext();
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
  node._activeMarkerId = markerId;
  node.querySelectorAll(".annotation-marker").forEach((element) => element.classList.toggle("is-active", element.dataset.marker === markerId));
  inspectorFor(node).querySelectorAll(".annotation-item").forEach((element) => {
    const active = element.dataset.marker === markerId;
    element.classList.toggle("is-active", active);
    const disclosure = element.querySelector(".annotation-disclosure");
    if (disclosure) {
      disclosure.setAttribute("aria-expanded", String(active));
      disclosure.title = active ? "收起标注" : "展开标注";
      element.querySelector(".annotation-description").hidden = !active;
    }
    if (active && scrollList) element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function focusMarker(node, marker) {
  try {
    const frame = node.querySelector("iframe");
    const anchor = marker.anchor?.anchorId && frame.contentDocument.getElementById(marker.anchor.anchorId);
    if (anchor) anchor.scrollIntoView({ block: "center", behavior: "auto" });
    else frame.contentWindow.scrollTo({ top: Number(marker.y) / 100 * Number(node.dataset.viewportHeight), behavior: "auto" });
    requestAnimationFrame(() => syncMarkerBinding(node, frame));
  } catch { /* Cross-origin prototypes still highlight the annotation and fallback marker. */ }
}

function setMarkerVisibility(visible) {
  state.showMarkers = visible;
  document.querySelectorAll(".page-node").forEach((node) => node.classList.toggle("markers-hidden", !visible));
  document.querySelectorAll(".marker-toggle input").forEach((input) => { input.checked = visible; });
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
  updateWorkspaceContext();
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
  requestAnimationFrame(fitPreviewDevice);
  els.previewFrame.addEventListener("load", () => {
    if (!restoreY) return;
    els.previewFrame.contentWindow?.postMessage({ type: "prototype:restoreScroll", scrollY: restoreY }, "*");
  }, { once: true });
}

function fitPreviewDevice() {
  const mobile = els.previewDialog.classList.contains("is-mobile-preview");
  const width = Number.parseFloat(els.previewDevice.style.getPropertyValue("--preview-viewport-width")) || 390;
  const height = Number.parseFloat(els.previewDevice.style.getPropertyValue("--preview-viewport-height")) || 844;
  const padding = window.innerWidth <= 720 ? 24 : 48;
  els.previewDevice.style.zoom = mobile ? Math.min(1,
    Math.max(160, els.previewViewport.clientWidth - padding) / (width + 18),
    Math.max(160, els.previewViewport.clientHeight - padding) / (height + 18)) : 1;
}

function openPreview(page) {
  if (!page || !canLeaveEditor()) return;
  if (state.editingMarker) {
    resetAnnotationInteraction();
    const node = activeNode();
    if (node) rerenderMarkers(node, page);
  }
  state.routeStack = [];
  configurePreview(page, state.mode === "page" ? state.routeParams : {}, state.activeScrollY);
  els.previewDialog.showModal();
  fitPreviewDevice();
  requestAnimationFrame(fitPreviewDevice);
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

function setZoom(nextZoom, autoFit = false) {
  state.autoFit = autoFit;
  state.zoom = Math.min(2, Math.max(0.1, nextZoom));
  els.canvas.style.transform = `scale(${state.zoom})`;
  els.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  document.querySelector("#fitButton").classList.toggle("is-active", state.autoFit);
  document.querySelector("#fitButton").setAttribute("aria-pressed", String(state.autoFit));
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
  if (!open && els.zoomMenu.matches(":popover-open")) els.zoomMenu.hidePopover();
  els.zoomMenu.hidden = !open;
  els.zoomMenuButton.setAttribute("aria-expanded", String(open));
  els.zoomMenuButton.classList.toggle("is-open", open);
  if (open) {
    positionTopPopover(els.zoomMenu, els.zoomMenuButton, 124);
    els.zoomMenu.showPopover();
  }
}

function updateSizer() {
  const rawWidth = els.canvas.scrollWidth;
  const rawHeight = els.canvas.scrollHeight;
  els.canvas.style.left = `${Math.max(0, (els.workspace.clientWidth - rawWidth * state.zoom) / 2)}px`;
  els.canvas.style.top = `${Math.max(0, (els.workspace.clientHeight - rawHeight * state.zoom) / 2)}px`;
  els.canvasSizer.style.width = `${Math.max(els.workspace.clientWidth, rawWidth * state.zoom)}px`;
  els.canvasSizer.style.height = `${Math.max(els.workspace.clientHeight, rawHeight * state.zoom)}px`;
}

function fitCanvas(animate = true) {
  if (!els.canvas.scrollWidth || !state.manifest) return;
  const widthZoom = Math.max(80, els.workspace.clientWidth - 24) / els.canvas.scrollWidth;
  const heightZoom = Math.max(80, els.workspace.clientHeight - 24) / els.canvas.scrollHeight;
  const limit = state.mode === "page" ? 1 : 0.8;
  setZoom(Math.min(limit, widthZoom, heightZoom), true);
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
  els.connections.innerHTML = '<defs><marker id="connection-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 9 5 1 9" fill="none" stroke="#7986d4" stroke-width="1.5"/></marker></defs>';
  state.manifest.connections.forEach((connection) => {
    const from = document.querySelector(`#node-${CSS.escape(connection.from)}`);
    const to = document.querySelector(`#node-${CSS.escape(connection.to)}`);
    if (!from || !to) return;
    const fromPos = offsetWithin(from, els.canvas);
    const toPos = offsetWithin(to, els.canvas);
    const downward = toPos.top >= fromPos.top;
    const bidirectional = state.manifest.connections.some(other => other.from === connection.to && other.to === connection.from);
    const lane = bidirectional ? (downward ? -90 : 90) : 0;
    let x1 = fromPos.left + from.offsetWidth / 2 + lane;
    let y1 = fromPos.top + (downward ? from.offsetHeight : 0);
    let x2 = toPos.left + to.offsetWidth / 2 + lane;
    let y2 = toPos.top + (downward ? 0 : to.offsetHeight);
    const horizontal = Math.abs(toPos.top - fromPos.top) < 8;
    if (horizontal) {
      const rightward = toPos.left >= fromPos.left;
      x1 = fromPos.left + (rightward ? from.offsetWidth : 0);
      x2 = toPos.left + (rightward ? 0 : to.offsetWidth);
      y1 = fromPos.top + from.offsetHeight / 2 + lane;
      y2 = toPos.top + to.offsetHeight / 2 + lane;
    }
    const middle = y1 + (y2 - y1) * 0.5;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "connection-path");
    path.setAttribute("marker-end", "url(#connection-arrow)");
    path.setAttribute("d", horizontal
      ? `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`);
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
    group.innerHTML = `<rect x="${labelX - labelWidth / 2}" y="${labelY - 13}" width="${labelWidth}" height="26" rx="4"></rect><text x="${labelX}" y="${labelY + 1}">${escapeHtml(connection.label)}</text>`;
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
document.querySelector("#fitButton").addEventListener("click", () => fitCanvas());
els.overviewNav.addEventListener("click", renderOverview);
document.querySelector("#pageModeButton").addEventListener("click", () => renderPageCanvas(state.activePage || state.manifest?.startPageId));
document.querySelector("#toggleSidebar").addEventListener("click", () => togglePanel("sidebar"));
document.querySelector("#closeSidebar").addEventListener("click", () => togglePanel("sidebar", false));
document.querySelector("#toggleInspector").addEventListener("click", () => togglePanel("inspector"));
document.querySelector("#panelBackdrop").addEventListener("click", () => {
  if (window.innerWidth <= 720) state.sidebarOpen = false;
  state.inspectorOpen = false;
  applyPanelState();
});
document.querySelector("#runPrototypeButton").addEventListener("click", () => openPreview(state.manifest?.pages.find(page => page.id === (state.mode === "overview" ? state.manifest.startPageId : state.activePage)) || state.manifest?.pages[0]));
document.querySelector("#copyLinkButton").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    notify("当前页面链接已复制。其他人需要能访问这个项目地址。");
  } catch { notify("无法访问剪贴板，请复制浏览器地址栏中的链接。"); }
});
document.querySelector("#shortcutsButton").addEventListener("click", () => els.shortcutsDialog.showModal());
els.moreTools.addEventListener("beforetoggle", event => {
  els.moreToolsButton.setAttribute("aria-expanded", String(event.newState === "open"));
  if (event.newState === "open") positionTopPopover(els.moreTools, els.moreToolsButton, 258);
  else setZoomMenu(false);
});
document.querySelector("#closeShortcuts").addEventListener("click", () => els.shortcutsDialog.close());
document.querySelector("#closePreview").addEventListener("click", () => els.previewDialog.close());
els.previewDialog.addEventListener("close", () => {
  if (state.manifest) renderPageCanvas(state.activePage, false, state.routeParams, state.activeScrollY);
  document.querySelector("#runPrototypeButton").focus();
});
document.querySelector("#openNewWindow").addEventListener("click", () => state.previewPath && window.open(state.previewPath, "_blank", "noopener"));
els.pageSearch.addEventListener("input", (event) => renderNavigation(event.target.value));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".zoom-picker")) setZoomMenu(false);
});
document.addEventListener("keydown", (event) => {
  const drawer = window.innerWidth <= 720 && state.sidebarOpen ? els.sidebar
    : window.innerWidth <= 980 && state.inspectorOpen ? els.inspector : null;
  if (event.key === "Tab" && drawer && !els.previewDialog.open && !els.shortcutsDialog.open && !els.moreTools.matches(":popover-open") && els.zoomMenu.hidden) {
    const stops = [...drawer.querySelectorAll('button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]')].filter(element => element.getClientRects().length);
    const first = stops[0], last = stops.at(-1);
    if (first && (!drawer.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last))) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  if (event.key === "Escape") {
    if (!els.zoomMenu.hidden) { event.preventDefault(); setZoomMenu(false); els.zoomMenuButton.focus(); return; }
    if (els.moreTools.matches(":popover-open")) { event.preventDefault(); els.moreTools.hidePopover(); els.moreToolsButton.focus(); return; }
  }
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
    return;
  }
  if (els.previewDialog.open || els.shortcutsDialog.open || !state.manifest) return;
  const editingText = event.target.closest("input, textarea, select, [contenteditable='true']");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    togglePanel("sidebar", true);
    els.pageSearch.focus();
    return;
  }
  if (editingText || event.metaKey || event.ctrlKey) return;
  if (event.key === "/") { event.preventDefault(); togglePanel("sidebar", true); els.pageSearch.focus(); }
  else if (event.key === "?") { event.preventDefault(); els.shortcutsDialog.showModal(); }
  else if (event.key === "0") { event.preventDefault(); fitCanvas(); }
  else if (event.key === "1") { event.preventDefault(); setZoom(1); }
  else if (["+", "="].includes(event.key)) { event.preventDefault(); stepZoom(1); }
  else if (event.key === "-") { event.preventDefault(); stepZoom(-1); }
  else if (event.altKey && event.key === "Enter") { event.preventDefault(); document.querySelector("#runPrototypeButton").click(); }
  else if (event.key.toLowerCase() === "m") setMarkerVisibility(!state.showMarkers);
  else if (event.key === "Escape") {
    if (window.innerWidth <= 980) { state.inspectorOpen = false; if (window.innerWidth <= 720) state.sidebarOpen = false; applyPanelState(); }
  }
});

window.addEventListener("message", (event) => {
  const sourceFrame = [els.previewFrame, ...document.querySelectorAll(".page-node iframe")].find(frame => frame.contentWindow === event.source);
  if (!sourceFrame || event.origin !== new URL(sourceFrame.src, window.location.href).origin || !state.manifest) return;
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

let lastWindowWidth = window.innerWidth;
window.addEventListener("resize", () => {
  syncTopTools();
  if (!els.zoomMenu.hidden) positionTopPopover(els.zoomMenu, els.zoomMenuButton, 124);
  if (els.moreTools.matches(":popover-open")) positionTopPopover(els.moreTools, els.moreToolsButton, 258);
  if ((window.innerWidth <= 980) !== (lastWindowWidth <= 980)) state.inspectorOpen = window.innerWidth > 980;
  if ((window.innerWidth <= 720) !== (lastWindowWidth <= 720)) state.sidebarOpen = window.innerWidth > 720;
  lastWindowWidth = window.innerWidth;
  applyPanelState();
  if (els.previewDialog.open) fitPreviewDevice();
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
els.workspace.addEventListener("pointercancel", () => { pan = null; els.workspace.classList.remove("is-panning"); });

window.addEventListener("hashchange", () => {
  if (!state.manifest) return;
  let id;
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
  if (id === "overview" && state.mode !== "overview") renderOverview();
  else if (id !== state.activePage && state.manifest.pages.some(page => page.id === id)) renderPageCanvas(id);
  const actual = state.mode === "overview" ? "overview" : state.activePage;
  if (actual && id !== actual) history.replaceState(null, "", `#${encodeURIComponent(actual)}`);
});
window.addEventListener("beforeunload", event => {
  if (state.editingMarker || state.annotationPersistence.status === "saving") { event.preventDefault(); event.returnValue = ""; }
});

function setupQuickTooltips() {
  const tooltip = document.querySelector("#controlTooltip");
  let anchor = null, showTimer, hideTimer;
  const hide = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (tooltip.matches(":popover-open")) tooltip.hidePopover();
    tooltip.hidden = true;
    if (anchor) {
      const descriptions = (anchor.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== tooltip.id);
      if (descriptions.length) anchor.setAttribute("aria-describedby", descriptions.join(" "));
      else anchor.removeAttribute("aria-describedby");
    }
    anchor = null;
  };
  const show = button => {
    hide();
    if (!button.isConnected || button.disabled || !button.getClientRects().length) return;
    anchor = button;
    tooltip.textContent = button.dataset.tooltip;
    tooltip.style.left = "8px";
    tooltip.style.top = "0px";
    tooltip.hidden = false;
    tooltip.showPopover();
    const rect = button.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, rect.left + rect.width / 2 - box.width / 2))}px`;
    tooltip.style.top = `${rect.bottom + box.height + 8 <= innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - box.height - 8)}px`;
    const descriptions = (button.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
    button.setAttribute("aria-describedby", [...new Set([...descriptions, tooltip.id])].join(" "));
  };
  document.querySelectorAll(".topbar button").forEach(button => {
    const label = button.getAttribute("title") || button.getAttribute("aria-label");
    if (!label) return;
    button.dataset.tooltip = label;
    button.removeAttribute("title");
    button.addEventListener("pointerenter", event => {
      if (event.pointerType === "touch") return;
      hide();
      showTimer = setTimeout(() => show(button), 80);
    });
    button.addEventListener("pointerleave", () => {
      clearTimeout(showTimer);
      hideTimer = setTimeout(hide, 100);
    });
    button.addEventListener("focus", () => {
      if (!button.matches(":focus-visible")) return;
      hide();
      // Native popovers may restore focus while still completing their own toggle.
      // Show on the next task to avoid opening another popover reentrantly.
      showTimer = setTimeout(() => {
        if (document.activeElement === button && button.matches(":focus-visible")) show(button);
      }, 0);
    });
    button.addEventListener("blur", hide);
    button.addEventListener("click", hide);
  });
  tooltip.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  tooltip.addEventListener("pointerleave", hide);
  document.addEventListener("keydown", event => { if (event.key === "Escape") hide(); });
  window.addEventListener("resize", hide);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
  els.moreTools.addEventListener("beforetoggle", hide);
  els.previewDialog.addEventListener("beforetoggle", hide);
  els.shortcutsDialog.addEventListener("beforetoggle", hide);
}

setupQuickTooltips();
boot().catch((error) => {
  els.flow.innerHTML = `<div class="workspace-error" role="alert"><strong>暂时无法打开原型</strong>${escapeHtml(error.message)}<br>请通过本地 HTTP 服务访问，并检查项目的 prototype.json。</div>`;
});
