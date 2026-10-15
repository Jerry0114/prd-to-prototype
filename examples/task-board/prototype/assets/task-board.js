(() => {
  "use strict";
  const page = document.body.dataset.page;
  const key = "public-task-board-v1";
  const initial = [
    { id: "T-101", title: "整理新成员入门清单", owner: "成员 A", due: "10-05", status: "doing", description: "梳理新成员第一周需要了解的资料和协作流程，形成一份可以反复使用的入门清单。" },
    { id: "T-102", title: "完善帮助中心目录", owner: "成员 B", due: "10-08", status: "todo", description: "按照常见问题整理帮助中心的信息结构，让使用者更快找到需要的答案。" },
    { id: "T-103", title: "归档上月项目资料", owner: "成员 C", due: "10-10", status: "done", description: "按项目整理已完成的交付文档，为后续查找保留清楚的目录。" }
  ];
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { saved = null; }
  let tasks = Array.isArray(saved?.tasks) && saved.tasks.length === 3 ? saved.tasks : initial;
  let keyword = typeof saved?.keyword === "string" ? saved.keyword : "";
  let status = ["all", "todo", "doing", "done"].includes(saved?.status) ? saved.status : "all";
  const params = new URLSearchParams(location.search);
  let viewState = params.get("state") || "normal";
  const selectedId = params.get("id") || "T-101";
  const labels = { todo: "待办", doing: "进行中", done: "已完成" };
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  function save() {
    try { sessionStorage.setItem(key, JSON.stringify({ tasks, keyword, status })); return true; }
    catch { document.querySelector("#feedback").textContent = "当前更改未能保存，请检查浏览器存储设置。"; return false; }
  }
  function go(target, query = {}) {
    if (parent !== window) parent.postMessage({ type: "prototype:navigate", target, params: query }, location.origin);
    else location.href = `${target}.html?${new URLSearchParams(query)}`;
  }
  function stateContent() {
    const texts = { loading: "正在加载任务…", empty: page === "task-list" ? "没有找到匹配的任务。" : "找不到这个任务。", error: "任务加载失败，请重试。" };
    return `<div class="state"><p>${texts[viewState] || texts.empty}</p>${viewState === "error" ? '<button class="button" data-retry>重试</button>' : ""}</div>`;
  }
  function render() {
    if (page === "task-list") {
      const filtered = tasks.filter(task => task.title.includes(keyword.trim()) && (status === "all" || task.status === status));
      document.querySelector("#task-rows").innerHTML = viewState !== "normal" ? stateContent() : filtered.length ? filtered.map(task => `<div class="task-row"><a href="task-detail.html?id=${escape(task.id)}" data-task="${escape(task.id)}">${escape(task.title)}<small>${escape(task.id)}</small></a><span class="owner">${escape(task.owner)}</span><time>${escape(task.due)}</time><span class="status ${escape(task.status)}">${labels[task.status]}</span></div>`).join("") : '<div class="state">没有找到匹配的任务。</div>';
      document.querySelector("#count").textContent = viewState === "normal" ? `共 ${filtered.length} 个任务` : "";
    } else {
      const task = tasks.find(task => task.id === selectedId);
      document.querySelector("#detail").innerHTML = viewState !== "normal" || !task ? stateContent() : `<h2>${escape(task.title)}</h2><p>${escape(task.description)}</p><dl><div><dt>负责人</dt><dd>${escape(task.owner)}</dd></div><div><dt>截止日期</dt><dd>${escape(task.due)}</dd></div><div><dt>当前进度</dt><dd><span class="status ${escape(task.status)}">${labels[task.status]}</span></dd></div></dl>`;
      const complete = document.querySelector("#complete");
      complete.disabled = viewState !== "normal" || !task || task.status === "done";
      complete.textContent = task?.status === "done" ? "已完成" : "标记完成";
    }
  }
  if (page === "task-list") {
    document.querySelector("#keyword").value = keyword;
    document.querySelector("#status").value = status;
    document.querySelector("#keyword").addEventListener("input", event => { keyword = event.target.value; save(); render(); });
    document.querySelector("#status").addEventListener("change", event => { status = event.target.value; save(); render(); });
  } else {
    document.querySelector("#complete").addEventListener("click", () => {
      tasks = tasks.map(task => task.id === selectedId ? { ...task, status: "done" } : task);
      if (save()) document.querySelector("#feedback").textContent = "任务已完成。";
      render();
    });
    document.querySelector("#back").addEventListener("click", event => { event.preventDefault(); go("task-list"); });
  }
  document.addEventListener("click", event => {
    const task = event.target.closest("[data-task]");
    if (task) { event.preventDefault(); go("task-detail", { id: task.dataset.task }); }
    if (event.target.closest("[data-retry]")) { viewState = "normal"; render(); }
  });
  window.addEventListener("message", event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (["prototype:setState", "prototype:set-state"].includes(event.data?.type)) {
      viewState = ["normal", "loading", "empty", "error"].includes(event.data.state) ? event.data.state : "normal";
      render();
    }
    if (event.data?.type === "prototype:restoreScroll") window.scrollTo(0, Number(event.data.scrollY) || 0);
  });
  render();
})();
