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
let currentLink = links[0];
let hoverLink = null;
let destination = null;
let markerLeft = 0;

function positionMarker() {
  const focused = nav.querySelector("a:focus-visible");
  const marker = focused || hoverLink || currentLink;
  const left = marker.offsetLeft;
  const right = nav.clientWidth - left - marker.offsetWidth;
  if (left !== markerLeft) nav.dataset.direction = left < markerLeft ? "back" : "forward";
  markerLeft = left;
  nav.style.setProperty("--mark-left", left + "px");
  nav.style.setProperty("--mark-right", right + "px");
  nav.dataset.marker = "";
}

function updateNavigation() {
  const scroll = Math.max(0, window.scrollY);
  const progress = Math.min(1, scroll / 235);
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
  if (destination) {
    // A native smooth scroll may pass another section on the way to the clicked anchor.
    active = links.indexOf(destination);
    const section = sections[active];
    const inset = parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
    const top = scroll + section.getBoundingClientRect().top - inset;
    const limit = Math.max(0, root.scrollHeight - innerHeight);
    if (Math.abs(scroll - Math.max(0, Math.min(top, limit))) < 2) destination = null;
  }
  currentLink = links[active];
  links.forEach((link, index) => {
    if (index === active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  positionMarker();
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
window.addEventListener("hashchange", () => {
  destination = links.find(link => link.hash === location.hash) || null;
  scheduleNavigation();
});
function resumeScrollTracking() {
  destination = null;
  hoverLink = null;
  scheduleNavigation();
}
window.addEventListener("wheel", resumeScrollTracking, { passive: true });
window.addEventListener("touchmove", resumeScrollTracking, { passive: true });
window.addEventListener("keydown", event => {
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) resumeScrollTracking();
});
nav.addEventListener("click", event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  destination = event.target.closest("a");
  scheduleNavigation();
});
nav.addEventListener("pointerover", event => {
  if (event.pointerType === "touch") return;
  hoverLink = event.target.closest("a");
  positionMarker();
});
nav.addEventListener("pointerleave", () => { hoverLink = null; positionMarker(); });
nav.addEventListener("focusin", positionMarker);
nav.addEventListener("focusout", scheduleNavigation);
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
    // Use the painted bitmap inside object-fit: contain, excluding toolbar and padding.
    const ratio = thumb.width / thumb.height;
    const width = Math.min(full.width, full.height * ratio);
    const height = width / ratio;
    const left = full.left - frame.left + (full.width - width) / 2;
    const top = full.top - frame.top + (full.height - height) / 2;
    const scale = thumb.width / width;
    const x = thumb.left - frame.left - left * scale;
    const y = thumb.top - frame.top - top * scale;
    const small = {
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      clipPath: `inset(${top}px ${frame.width - left - width}px ${frame.height - top - height}px ${left}px)`,
      opacity: 0
    };
    // Allow the panel shadow to appear as its frame opens around the figure.
    const large = { transform: "none", clipPath: "inset(-6rem)", opacity: 1 };
    const handoff = { offset: returning ? .95 : .05, opacity: 1 };
    return dialog.animate(returning ? [large, handoff, small] : [small, handoff, large], {
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
