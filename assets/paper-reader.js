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
    const setContents = () => { contents.open = !narrow.matches; };
    setContents();
    narrow.addEventListener("change", setContents);
    contents.addEventListener("click", event => {
      if (narrow.matches && ordinaryClick(event) && event.target.closest('a[href^="#"]')) contents.open = false;
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
    if (caption) caption.textContent = link.closest("figure")?.querySelector("figcaption")?.textContent.trim() || "";
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
