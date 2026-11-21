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
