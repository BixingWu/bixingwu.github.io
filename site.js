const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
try {
  const saved = localStorage.getItem("appearance");
  if (saved === "light" || saved === "dark") root.dataset.theme = saved;
} catch { /* System appearance works when storage is unavailable. */ }

function currentTheme() {
  return root.dataset.theme || (systemTheme.matches ? "dark" : "light");
}

function updateToggle() {
  const dark = currentTheme() === "dark";
  const label = dark ? "Switch to light appearance" : "Switch to dark appearance";
  toggle.setAttribute("aria-label", label);
  toggle.title = label;
  toggle.querySelector("use").setAttribute("href", dark ? "#sun" : "#moon");
}

function switchTheme() {
  root.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem("appearance", root.dataset.theme); } catch { /* Keep the choice for this page. */ }
  updateToggle();
}

toggle.hidden = false;
toggle.addEventListener("click", () => {
  if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(switchTheme);
  else switchTheme();
});
updateToggle();
systemTheme.addEventListener("change", updateToggle);

const nav = document.querySelector("nav");
const links = Array.from(nav.querySelectorAll("a"));
const sections = links.map(link => document.querySelector(link.hash));
const bar = document.querySelector(".site-bar");
const cover = document.querySelector(".cover");
let scheduled = false;

function updateNavigation() {
  const scroll = Math.max(0, window.scrollY);
  const progress = Math.min(1, scroll / 180);
  const fold = reducedMotion.matches ? Number(scroll > 0) : progress * progress * (3 - 2 * progress);
  const drift = reducedMotion.matches ? 0 : Math.min(1, scroll / cover.offsetHeight);
  const threshold = bar.offsetHeight + 24;
  const atEnd = window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= root.scrollHeight - 2;
  let active = 0;
  sections.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= threshold) active = index;
  });
  if (atEnd) {
    // On a tall screen several anchors can share the same final scroll position.
    const target = links.findIndex(link => link.hash === location.hash);
    active = target >= 0 && sections[target].getBoundingClientRect().top >= threshold - 16 ? target : links.length - 1;
  }
  links.forEach((link, index) => {
    if (index === active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  const marker = links[active];
  nav.style.setProperty("--mark-x", marker.offsetLeft + "px");
  nav.style.setProperty("--mark-width", marker.offsetWidth + "px");
  nav.dataset.marker = "";
  bar.style.setProperty("--fold", fold.toFixed(3));
  cover.style.setProperty("--drift", drift.toFixed(3));
  scheduled = false;
}

function scheduleNavigation() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(updateNavigation);
  }
}
window.addEventListener("scroll", scheduleNavigation, { passive: true });
window.addEventListener("resize", scheduleNavigation);
window.addEventListener("load", scheduleNavigation);
window.addEventListener("hashchange", scheduleNavigation);
reducedMotion.addEventListener("change", scheduleNavigation);
scheduleNavigation();

const dialog = document.getElementById("figure-dialog");
if (dialog && typeof dialog.showModal === "function") {
  const image = document.getElementById("figure-detail");
  const original = document.getElementById("figure-original");
  const source = document.getElementById("figure-source");
  const close = document.getElementById("figure-close");
  const title = document.getElementById("figure-dialog-title");
  let opener = null;
  let motion = null;
  let closing = false;

  function animateFigure(thumb, returning = false) {
    if (reducedMotion.matches || typeof dialog.animate !== "function") return null;
    const frame = dialog.getBoundingClientRect();
    const full = image.getBoundingClientRect();
    if (!thumb.width || !thumb.height || !full.width || !full.height) return null;
    // A height-limited image can have empty space on either side of the bitmap.
    const bitmapWidth = Math.min(full.width, full.height * thumb.width / thumb.height);
    const scale = thumb.width / bitmapWidth;
    const x = thumb.left + thumb.width / 2 - frame.left - (full.left + full.width / 2 - frame.left) * scale;
    const y = thumb.top + thumb.height / 2 - frame.top - (full.top + full.height / 2 - frame.top) * scale;
    const small = { transform: `translate(${x}px, ${y}px) scale(${scale})` };
    const large = { transform: "none" };
    return dialog.animate(returning ? [large, small] : [small, large], {
      duration: returning ? 280 : 350,
      easing: returning ? "cubic-bezier(.30,.08,.28,1)" : "cubic-bezier(.24,.08,.20,1)",
      fill: "both"
    });
  }

  function clearMotion() {
    motion?.cancel();
    motion = null;
  }

  function closeFigure() {
    if (!dialog.open || closing) return;
    closing = true;
    dialog.setAttribute("data-closing", "");
    if (reducedMotion.matches) {
      dialog.close();
      return;
    }
    if (motion) {
      if (!motion.currentTime) {
        dialog.close();
        return;
      }
      motion.reverse();
    } else {
      motion = animateFigure(opener.querySelector("img").getBoundingClientRect(), true);
    }
    if (motion) motion.onfinish = () => dialog.close();
    else dialog.close();
  }

  document.querySelectorAll(".figure-link").forEach(link => {
    link.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (dialog.open) return;
      clearMotion();
      opener = link;
      closing = false;
      dialog.removeAttribute("data-closing");
      const thumbnail = link.querySelector("img");
      const thumb = thumbnail.getBoundingClientRect();
      image.width = thumbnail.naturalWidth || Number(thumbnail.getAttribute("width"));
      image.height = thumbnail.naturalHeight || Number(thumbnail.getAttribute("height"));
      image.src = link.href;
      image.alt = thumbnail.alt;
      original.href = link.href;
      source.href = link.dataset.source;
      title.textContent = link.dataset.paper + " pipeline";
      dialog.showModal();
      close.focus({ preventScroll: true });
      motion = animateFigure(thumb);
      if (motion) motion.onfinish = clearMotion;
    });
  });
  close.addEventListener("click", closeFigure);
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeFigure();
  });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) closeFigure();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    clearMotion();
    dialog.removeAttribute("data-closing");
    closing = false;
    opener?.focus({ preventScroll: true });
    opener = null;
  });
  reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches || !motion) return;
    clearMotion();
    if (closing) dialog.close();
  });
}
