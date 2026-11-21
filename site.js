const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
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

toggle.hidden = false;
toggle.addEventListener("click", () => {
  root.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem("appearance", root.dataset.theme); } catch { /* Keep the choice for this page. */ }
  updateToggle();
});
updateToggle();
systemTheme.addEventListener("change", updateToggle);

const links = Array.from(document.querySelectorAll("nav a"));
const navigation = document.querySelector("nav");
const sections = links.map(link => document.querySelector(link.hash));
const header = document.querySelector("header");
let scheduled = false;

function updateNavigation() {
  const threshold = header.offsetHeight + 28;
  const atEnd = Math.ceil(window.scrollY + window.innerHeight) >= root.scrollHeight - 2;
  let active = 0;
  sections.forEach((section, index) => {
    if (atEnd || section.getBoundingClientRect().top <= threshold) active = index;
  });
  links.forEach((link, index) => {
    if (index === active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  const current = links[active];
  navigation.style.setProperty("--indicator-x", current.offsetLeft + "px");
  navigation.style.setProperty("--indicator-width", current.offsetWidth + "px");
  navigation.classList.add("tracked");
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
scheduleNavigation();

const dialog = document.getElementById("figure-dialog");
if (typeof dialog.showModal === "function") {
  const image = document.getElementById("figure-detail");
  const original = document.getElementById("figure-original");
  const source = document.getElementById("figure-source");
  const close = document.getElementById("figure-close");

  document.querySelectorAll(".figure-link").forEach(link => {
    link.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      image.src = link.href;
      image.alt = link.querySelector("img").alt;
      original.href = link.href;
      source.href = link.dataset.source;
      document.getElementById("figure-dialog-title").textContent = link.dataset.paper + " pipeline";
      dialog.showModal();
      close.focus({ preventScroll: true });
    });
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
