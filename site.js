const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
let bottomLink = null;
let resizedBottomScroll = null;
let markerLink = null;
let markerLeft = 0;
let markerRight = 0;

function positionMarker(measure = false) {
  const focused = nav.querySelector("a:focus-visible");
  const marker = focused || hoverLink || currentLink;
  if (marker === markerLink && !measure) return;
  const track = nav.getBoundingClientRect();
  if (!track.width) return;
  const item = marker.getBoundingClientRect();
  // Relative edges follow the mobile flex track as the header folds.
  const left = (item.left - track.left) / track.width;
  const right = (track.right - item.right) / track.width;
  let direction = left < markerLeft ? "back" : "forward";
  if (marker === markerLink) {
    const difference = Math.max(Math.abs(left - markerLeft), Math.abs(right - markerRight));
    if (difference * track.width < 0.25) return;
    direction = "align";
  }
  if (nav.dataset.direction !== direction) nav.dataset.direction = direction;
  if (!markerLink || markerLeft !== left) nav.style.setProperty("--mark-left", (left * 100).toFixed(4) + "%");
  if (!markerLink || markerRight !== right) nav.style.setProperty("--mark-right", (right * 100).toFixed(4) + "%");
  if (!markerLink) nav.dataset.marker = "";
  markerLink = marker;
  markerLeft = left;
  markerRight = right;
}

const alignMarker = () => positionMarker(true);
if ("ResizeObserver" in window) {
  const markerResize = new ResizeObserver(alignMarker);
  markerResize.observe(nav);
  for (const link of links) markerResize.observe(link);
} else {
  document.fonts?.addEventListener("loadingdone", alignMarker);
}

function anchorInset(section) {
  return parseFloat(getComputedStyle(section).scrollMarginTop) || 0;
}

function updateNavigation() {
  const scroll = Math.max(0, window.scrollY);
  const progress = Math.min(1, scroll / 235);
  const fold = reducedMotion.matches ? Number(scroll > 0) : progress * progress * (3 - 2 * progress);
  const drift = reducedMotion.matches ? 0 : Math.min(1, scroll / cover.offsetHeight);
  const threshold = bar.offsetHeight + 24;
  const limit = Math.max(0, root.scrollHeight - innerHeight);
  const atEnd = scroll > 0 && Math.ceil(scroll) >= limit - 2;
  let active = 0;
  sections.forEach((section, index) => {
    if (section.getBoundingClientRect().top <= threshold) active = index;
  });
  if (atEnd || (bottomLink && scroll === resizedBottomScroll)) {
    active = bottomLink ? links.indexOf(bottomLink) : links.length - 1;
  } else {
    bottomLink = null;
  }
  // When the whole page fits, all anchors share the same scroll position.
  if (!limit) active = Math.max(0, links.findIndex(link => link.hash === location.hash));
  if (destination) {
    // A native smooth scroll may pass another section on the way to the clicked anchor.
    active = links.indexOf(destination);
    const section = sections[active];
    const top = scroll + section.getBoundingClientRect().top - anchorInset(section);
    if (Math.abs(scroll - Math.max(0, Math.min(top, limit))) < 2) {
      // Several anchors may share the bottom pixel. Keep the chosen one only there.
      bottomLink = atEnd ? destination : null;
      resizedBottomScroll = null;
      destination = null;
    }
  }
  if (currentLink !== links[active]) {
    currentLink.removeAttribute("aria-current");
    currentLink = links[active];
    currentLink.setAttribute("aria-current", "location");
  }
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
window.addEventListener("resize", () => {
  if (bottomLink) {
    const section = sections[links.indexOf(bottomLink)];
    const top = section.getBoundingClientRect().top;
    const remaining = root.scrollHeight - innerHeight - scrollY;
    // Keep the explicit choice at this exact position if resizing leaves it visible and still clamped.
    resizedBottomScroll = top < innerHeight && top - anchorInset(section) >= remaining ? scrollY : null;
  }
  alignMarker();
  scheduleNavigation();
});
window.addEventListener("load", scheduleNavigation);
function followHash() {
  bottomLink = null;
  destination = links.find(link => link.hash === location.hash) || null;
  scheduleNavigation();
}
window.addEventListener("hashchange", followHash);
function resumeScrollTracking() {
  bottomLink = null;
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
nav.addEventListener("focusin", () => positionMarker());
nav.addEventListener("focusout", scheduleNavigation);
reducedMotion.addEventListener("change", scheduleNavigation);
followHash();

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
  let pressedBackdrop = false;

  function bitmapBounds(img) {
    const box = img.getBoundingClientRect();
    const ratio = Number(img.getAttribute("width")) / Number(img.getAttribute("height"));
    if (!Number.isFinite(ratio) || ratio <= 0) return box;
    const width = Math.min(box.width, box.height * ratio);
    const height = width / ratio;
    return { width, height, left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2 };
  }

  function animateFigure(thumb, returning = false) {
    if (reducedMotion.matches || typeof dialog.animate !== "function") return null;
    const frame = dialog.getBoundingClientRect();
    const full = bitmapBounds(image);
    if (!thumb.width || !thumb.height || !full.width || !full.height) return null;
    const left = full.left - frame.left;
    const top = full.top - frame.top;
    const scale = thumb.width / full.width;
    const x = thumb.left - frame.left - left * scale;
    const y = thumb.top - frame.top - top * scale;
    const small = {
      transform: `translate(${x}px, ${y}px) scale(${scale})`,
      clipPath: `inset(${top}px ${frame.width - left - full.width}px ${frame.height - top - full.height}px ${left}px)`,
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

  function revealOriginal() {
    image.style.visibility = "";
    original.style.backgroundImage = "";
  }
  image.addEventListener("load", revealOriginal);

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
      motion = animateFigure(bitmapBounds(opener.querySelector("img")), true);
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
      const thumb = bitmapBounds(thumbnail);
      image.width = Number(thumbnail.getAttribute("width")) || thumbnail.naturalWidth;
      image.height = Number(thumbnail.getAttribute("height")) || thumbnail.naturalHeight;
      original.style.backgroundImage = `url("${thumbnail.currentSrc || thumbnail.src}")`;
      image.style.visibility = "hidden";
      image.src = link.href;
      if (image.complete && image.naturalWidth) revealOriginal();
      image.alt = thumbnail.alt;
      original.href = link.href;
      source.href = link.dataset.source;
      title.textContent = link.dataset.paper + " pipeline";
      link.focus({ preventScroll: true });
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
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const box = dialog.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom;
  }
  dialog.addEventListener("pointerdown", event => {
    pressedBackdrop = event.isPrimary && isBackdrop(event);
  });
  dialog.addEventListener("click", event => {
    if (pressedBackdrop && isBackdrop(event)) closeFigure();
    pressedBackdrop = false;
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    clearMotion();
    dialog.removeAttribute("data-closing");
    closing = false;
    if (document.activeElement === document.body) opener?.focus({ preventScroll: true });
    opener = null;
  });
  reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches || !motion) return;
    clearMotion();
    if (closing) dialog.close();
  });
}
