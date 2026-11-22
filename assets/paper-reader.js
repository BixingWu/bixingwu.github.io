(() => {
  const root = document.documentElement;
  const theme = document.getElementById("theme-toggle");
  if (theme) {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const dark = () => root.dataset.theme ? root.dataset.theme === "dark" : system.matches;
    function updateThemeButton() {
      const label = dark() ? "Switch to light appearance" : "Switch to dark appearance";
      theme.title = label;
      theme.setAttribute("aria-label", label);
      theme.querySelector("use")?.setAttribute("href", dark() ? "#sun" : "#moon");
    }
    theme.addEventListener("click", () => {
      root.dataset.theme = dark() ? "light" : "dark";
      try { localStorage.setItem("appearance", root.dataset.theme); } catch { /* Keep this page's choice. */ }
      updateThemeButton();
    });
    system.addEventListener("change", updateThemeButton);
    updateThemeButton();
    theme.hidden = false;
  }

  const paper = document.querySelector(".paper-body");
  if (!paper) return;

  const contents = document.getElementById("paper-contents");
  if (contents) {
    const narrow = matchMedia("(max-width: 54rem)");
    const summary = contents.querySelector("summary");
    const locationLabel = summary.querySelector(".contents-location");
    const sections = [...contents.querySelectorAll('a[href^="#"]')].map(link => ({
      link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))),
    })).filter(section => section.target);
    let current;
    let pending = 0;
    function locateSection() {
      pending = 0;
      const line = narrow.matches ? summary.offsetHeight + 24 : 64;
      let next;
      for (const section of sections) {
        if (!section.target.getClientRects().length) continue;
        if (section.target.getBoundingClientRect().top > line) break;
        next = section;
      }
      if (window.scrollY + root.clientHeight >= root.scrollHeight - 2) next = sections.at(-1);
      if (current === next) return;
      current?.link.removeAttribute("aria-current");
      next?.link.setAttribute("aria-current", "location");
      if (locationLabel) locationLabel.textContent = next?.link.textContent.trim() || "";
      current = next;
    }
    function queueLocation() {
      if (!pending) pending = requestAnimationFrame(locateSection);
    }
    const setContents = () => { contents.open = !narrow.matches; queueLocation(); };
    contents.classList.add("interactive-contents");
    setContents();
    narrow.addEventListener("change", setContents);
    window.addEventListener("scroll", queueLocation, { passive: true });
    window.addEventListener("resize", queueLocation);
    window.addEventListener("pageshow", queueLocation);
    paper.addEventListener("toggle", queueLocation, true);
    contents.addEventListener("toggle", () => {
      if (!narrow.matches || !contents.open || !current) return;
      const group = current.link.closest(".contents-appendices");
      if (group) group.open = true;
      const list = contents.querySelector("ol");
      const linkTop = current.link.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (linkTop < 0 || linkTop + current.link.offsetHeight > list.clientHeight) {
        list.scrollTop += linkTop - (list.clientHeight - current.link.offsetHeight) / 2;
      }
    });
    contents.addEventListener("click", event => {
      if (narrow.matches && ordinaryClick(event) && event.target.closest('a[href^="#"]')) contents.open = false;
    });
    document.addEventListener("pointerdown", event => {
      if (narrow.matches && contents.open && !contents.contains(event.target)) contents.open = false;
    });
    document.addEventListener("focusin", event => {
      if (narrow.matches && contents.open && !contents.contains(event.target)) contents.open = false;
    });
    contents.addEventListener("keydown", event => {
      if (event.key === "Escape" && narrow.matches && contents.open) {
        contents.open = false;
        summary.focus();
      }
    });
  }

  function revealFragment() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target || !paper.contains(target)) return;
    let opened = false;
    for (let parent = target.parentElement; parent && parent !== paper; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS" && !parent.open) {
        parent.open = true;
        opened = true;
      }
    }
    if (opened) target.scrollIntoView({ block: "start", behavior: "instant" });
  }
  revealFragment();
  window.addEventListener("hashchange", revealFragment);

  function ordinaryClick(event) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  }
  for (const paragraph of paper.querySelectorAll(".ltx_para[id], p[id]")) {
    if (paragraph.tagName === "P" && paragraph.closest(".ltx_para[id]")) continue;
    const link = document.createElement("a");
    link.className = "paragraph-link";
    link.href = "#" + encodeURIComponent(paragraph.id);
    link.textContent = "¶";
    link.title = "Copy link to this paragraph";
    link.setAttribute("aria-label", link.title);
    paragraph.append(link);
  }

  const status = document.createElement("span");
  status.className = "reader-status";
  status.setAttribute("role", "status");
  document.body.append(status);
  let markedControl = null;
  let resetStatus;
  function announce(control, message) {
    clearTimeout(resetStatus);
    if (markedControl) delete markedControl.dataset.copied;
    markedControl = control;
    if (control) control.dataset.copied = "";
    status.textContent = message;
    resetStatus = setTimeout(() => {
      if (markedControl) delete markedControl.dataset.copied;
      markedControl = null;
      status.textContent = "";
    }, 2000);
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const active = document.activeElement;
      const field = document.createElement("textarea");
      field.value = value;
      field.readOnly = true;
      field.tabIndex = -1;
      field.style.cssText = "position:fixed;inset:0 auto auto 0;opacity:0;pointer-events:none";
      document.body.append(field);
      field.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { /* The caller offers a manual alternative. */ }
      field.remove();
      active?.focus({ preventScroll: true });
      return copied;
    }
  }

  paper.addEventListener("click", async event => {
    const link = event.target.closest("a.paragraph-link");
    if (!link || !ordinaryClick(event)) return;
    event.preventDefault();
    if (await copyText(link.href)) announce(link, "Paragraph link copied.");
    else {
      location.hash = link.hash;
      announce(null, "Copy the paragraph link from the address bar.");
    }
  });

  const bibtex = document.getElementById("paper-bibtex");
  const bibtexButton = document.getElementById("copy-bibtex");
  if (bibtex && bibtexButton) {
    bibtexButton.hidden = false;
    bibtexButton.addEventListener("click", async () => {
      if (await copyText(bibtex.textContent.trim())) announce(bibtexButton, "BibTeX copied.");
      else {
        const details = bibtex.closest("details");
        if (details) details.open = true;
        const range = document.createRange();
        range.selectNodeContents(bibtex);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        announce(null, "BibTeX selected. Use your device’s copy command.");
      }
    });
  }

  const dialog = document.getElementById("reader-figure");
  const image = dialog?.querySelector("img");
  const close = dialog?.querySelector("[data-close-figure]");
  if (!image || !close || typeof dialog.showModal !== "function") return;
  const caption = dialog.querySelector("[data-figure-caption]");
  const original = dialog.querySelector("[data-original-figure]");
  const zoom = dialog.querySelector("[data-zoom-figure]");
  const stage = document.getElementById("reader-figure-stage");
  function fitFigure() {
    if (!stage || !zoom) return;
    stage.removeAttribute("tabindex");
    stage.removeAttribute("data-enlarged");
    image.style.removeProperty("width");
    stage.scrollTo(0, 0);
    zoom.textContent = "Zoom in";
  }
  if (stage && zoom) {
    zoom.addEventListener("click", () => {
      if (stage.hasAttribute("data-enlarged")) { fitFigure(); return; }
      const width = image.getBoundingClientRect().width;
      if (!width) return;
      image.style.width = Math.ceil(width * 2) + "px";
      stage.setAttribute("data-enlarged", "");
      stage.tabIndex = 0;
      zoom.textContent = "Fit image";
    });
  }
  let opener;
  const article = paper.closest(".reader-article") || paper;
  article.addEventListener("click", event => {
    const link = event.target.closest("a[data-figure-zoom]");
    if (!link || !ordinaryClick(event)) return;
    event.preventDefault();
    opener = link;
    image.alt = link.querySelector("img")?.alt || "Enlarged figure";
    image.src = link.href;
    if (original) original.href = link.href;
    const figure = link.closest("figure");
    if (caption) {
      const selector = figure?.classList.contains("overview-figure") ? "figcaption > span" : "figcaption";
      caption.textContent = figure?.querySelector(selector)?.textContent.trim() || "";
    }
    fitFigure();
    dialog.showModal();
    close.focus({ preventScroll: true });
  });
  close.addEventListener("click", () => dialog.close());
  function onBackdrop(event) {
    if (event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  }
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", event => { pressedBackdrop = event.isPrimary && onBackdrop(event); });
  dialog.addEventListener("click", event => {
    if (pressedBackdrop && onBackdrop(event)) dialog.close();
    pressedBackdrop = false;
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    if (document.activeElement === document.body) opener?.focus({ preventScroll: true });
    opener = null;
  });
})();
