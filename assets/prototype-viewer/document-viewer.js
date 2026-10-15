(function initDocumentViewer() {
  const core = window.PrototypeDocumentPreview;
  const content = document.querySelector("#documentContent");
  const titleNode = document.querySelector("#documentTitle");
  const closeButton = document.querySelector("#closeDocument");
  const params = new URLSearchParams(window.location.search);
  const sourcePath = params.get("src") || "";
  const preferredTitle = (params.get("title") || "").trim();
  const preferredSection = (params.get("section") || "").trim();
  const assetRoot = new URL("./", window.location.href);

  function showError(message) {
    content.innerHTML = `
      <div class="document-error">
        <strong>文档暂时无法预览</strong>
        <p>${String(message || "请检查关联文档是否仍在当前原型包内。")}</p>
      </div>
    `;
  }

  function sameAssetUrl(value, baseUrl) {
    try {
      const resolved = new URL(value, baseUrl);
      return resolved.origin === assetRoot.origin && resolved.pathname.startsWith(assetRoot.pathname)
        ? resolved
        : null;
    } catch {
      return null;
    }
  }

  function assetRelativePath(url) {
    return decodeURIComponent(url.pathname.slice(assetRoot.pathname.length));
  }

  function sanitizeRenderedHtml(html, documentUrl) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const allowedTags = new Set([
      "A", "BLOCKQUOTE", "BR", "CODE", "DEL", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
      "HR", "IMG", "INPUT", "LI", "OL", "P", "PRE", "STRONG", "TABLE", "TBODY", "TD", "TH",
      "THEAD", "TR", "UL",
    ]);
    const removeWithContent = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH"]);

    [...template.content.querySelectorAll("*")].forEach((element) => {
      if (!allowedTags.has(element.tagName)) {
        if (removeWithContent.has(element.tagName)) element.remove();
        else element.replaceWith(...element.childNodes);
        return;
      }

      [...element.attributes].forEach((attribute) => element.removeAttribute(attribute.name));

      if (element.tagName === "A") {
        const originalHref = element.getAttribute("data-sanitized-href") || "";
        if (originalHref) element.removeAttribute("data-sanitized-href");
      }
    });

    const sourceTemplate = document.createElement("template");
    sourceTemplate.innerHTML = html;
    const sourceElements = [...sourceTemplate.content.querySelectorAll("*")];
    const targetElements = [...template.content.querySelectorAll("*")];
    targetElements.forEach((element, index) => {
      const source = sourceElements[index];
      if (!source || source.tagName !== element.tagName) return;

      if (element.tagName === "A") {
        const href = source.getAttribute("href") || "";
        if (href.startsWith("#")) {
          element.setAttribute("href", href);
          return;
        }
        const localUrl = sameAssetUrl(href, documentUrl);
        if (localUrl) {
          const relativePath = assetRelativePath(localUrl);
          const extension = relativePath.split("#")[0].split("?")[0].toLowerCase();
          if (extension.endsWith(".md") || extension.endsWith(".markdown")) {
            const previewHref = core.relatedDocHref({ label: element.textContent.trim(), path: relativePath });
            if (previewHref !== "#") element.setAttribute("href", previewHref);
          } else {
            element.setAttribute("href", localUrl.href);
          }
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer");
          return;
        }
        try {
          const externalUrl = new URL(href);
          if (externalUrl.protocol === "https:" || externalUrl.protocol === "http:" || externalUrl.protocol === "mailto:") {
            element.setAttribute("href", externalUrl.href);
            element.setAttribute("target", "_blank");
            element.setAttribute("rel", "noopener noreferrer");
          }
        } catch {
          element.replaceWith(...element.childNodes);
        }
      }

      if (element.tagName === "IMG") {
        const src = source.getAttribute("src") || "";
        const localUrl = sameAssetUrl(src, documentUrl);
        if (!localUrl) {
          element.remove();
          return;
        }
        element.setAttribute("src", localUrl.href);
        const alt = source.getAttribute("alt");
        if (alt) element.setAttribute("alt", alt);
        element.setAttribute("loading", "lazy");
      }

      if (element.tagName === "INPUT" && source.getAttribute("type") === "checkbox") {
        element.setAttribute("type", "checkbox");
        element.setAttribute("disabled", "");
        if (source.hasAttribute("checked")) element.setAttribute("checked", "");
      }

      if (element.tagName === "CODE") {
        const className = source.getAttribute("class") || "";
        if (/^language-[a-z0-9_-]+$/i.test(className)) element.setAttribute("class", className);
      }
    });

    const headingIds = new Map();
    template.content.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      const base = core.slugifyHeading(heading.textContent);
      const count = headingIds.get(base) || 0;
      headingIds.set(base, count + 1);
      heading.id = count ? `${base}-${count + 1}` : base;
    });

    template.content.querySelectorAll("table").forEach((table) => {
      const wrapper = document.createElement("div");
      wrapper.className = "document-table-wrap";
      table.replaceWith(wrapper);
      wrapper.append(table);
    });
    return template.innerHTML;
  }

  async function renderDocument() {
    if (!core || !window.marked || !core.isSafeDocumentPath(sourcePath)) {
      showError("关联文档路径无效或预览组件未完整加载。");
      return;
    }
    const extension = sourcePath.toLowerCase();
    if (!extension.endsWith(".md") && !extension.endsWith(".markdown")) {
      showError("当前阅读页只处理 Markdown 文档，HTML 文档会直接打开。");
      return;
    }

    const documentUrl = sameAssetUrl(sourcePath, assetRoot);
    if (!documentUrl) {
      showError("关联文档必须位于当前原型包内。");
      return;
    }

    try {
      const response = await fetch(documentUrl.href, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`文档请求失败（${response.status}）`);
      const markdown = await response.text();
      const rendered = window.marked.parse(core.escapeRawHtml(markdown), { gfm: true, breaks: false });
      content.innerHTML = sanitizeRenderedHtml(rendered, documentUrl);
      const firstHeading = content.querySelector("h1, h2, h3");
      const documentTitle = preferredTitle || firstHeading?.textContent?.trim() || sourcePath.split("/").pop();
      titleNode.textContent = documentTitle;
      document.title = `${documentTitle} · 原型工作台`;
      if (preferredSection) {
        const sectionId = core.slugifyHeading(preferredSection);
        requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ block: "start" }));
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : "文档读取失败。");
    }
  }

  closeButton.addEventListener("click", () => {
    if (window.opener) window.close();
    else window.location.href = "./";
  });

  renderDocument();
}());
