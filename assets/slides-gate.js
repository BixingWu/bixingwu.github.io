(() => {
  const gate = document.getElementById("slides-gate");
  if (!gate) return;
  const id = gate.dataset.id;
  const heading = document.getElementById("gate-heading");
  const form = document.getElementById("unlock-form");
  const input = document.getElementById("access-key");
  const button = document.getElementById("unlock-slides");
  const status = document.getElementById("unlock-status");
  const viewer = document.getElementById("slide-viewer");
  const copyButton = document.getElementById("copy-share-link");
  const copyLabel = document.getElementById("share-link-label");
  const copyStatus = document.getElementById("share-link-status");
  const shareDialog = document.getElementById("share-link-dialog");
  const shareField = document.getElementById("share-link-value");
  if (!/^[0-9a-f]{32}$/.test(id) || !window.isSecureContext || !window.crypto?.subtle) {
    status.textContent = "Open the original HTTPS link in a browser that supports secure decryption.";
    button.disabled = true;
    input.disabled = true;
    return;
  }

  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'";
  const prefix = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const encoder = new TextEncoder();
  const context = encoder.encode("bixingwu.com/slides/v1/" + id);
  const storageKey = "slides:access:" + id;
  const previewKey = "slides:preview-open:" + id;
  let pending;
  let accessCode = "";
  let viewerReady = false;
  let feedbackTimer;

  function canonicalCode(value) {
    const code = (value || "").normalize("NFKC").toLowerCase()
      .replace(/[il]/g, "1").replace(/o/g, "0").replace(/[\s\p{Dash_Punctuation}]/gu, "");
    return /^[0123456789abcdefghjkmnpqrstvwxyz]{12}$/.test(code) ? code : "";
  }
  function savedCode() {
    try { return canonicalCode(localStorage.getItem(storageKey)); } catch { return ""; }
  }
  function remember(code) {
    try {
      if (code) localStorage.setItem(storageKey, code);
      else localStorage.removeItem(storageKey);
    } catch { /* The shared link still works without device storage. */ }
  }
  function showCodeError(message, fromField) {
    status.textContent = message;
    input.setAttribute("aria-invalid", "true");
    if (fromField) {
      input.focus({ preventScroll: true });
      input.select();
    }
  }
  async function copyShareLink() {
    if (!accessCode) return;
    const link = new URL(location.pathname, location.origin);
    link.hash = "p=" + accessCode.match(/.{4}/g).join("-");
    clearTimeout(feedbackTimer);
    try {
      await navigator.clipboard.writeText(link.href);
      copyLabel.textContent = "Copied";
      copyStatus.textContent = "Share link copied.";
      feedbackTimer = setTimeout(() => {
        copyLabel.textContent = "Copy share link";
        copyStatus.textContent = "";
      }, 2200);
    } catch {
      copyLabel.textContent = "Copy share link";
      copyStatus.textContent = "";
      shareField.value = link.href;
      if (!shareDialog.open) shareDialog.showModal();
      shareField.focus();
      shareField.select();
    }
  }
  copyButton.addEventListener("click", copyShareLink);
  shareDialog.addEventListener("close", () => {
    shareField.value = "";
    copyButton.focus({ preventScroll: true });
  });
  function hashParts() {
    return location.hash.slice(1).split("&").filter(Boolean);
  }
  function clearSharedCode() {
    const rest = hashParts().filter(part => !new URLSearchParams(part).has("p")).join("&");
    history.replaceState(history.state, "", location.pathname + location.search + (rest ? "#" + rest : ""));
  }
  function slideNumber() {
    const part = hashParts().find(value => /^[1-9]\d*$/.test(value));
    const number = Number(part);
    return Number.isSafeInteger(number) ? number : 1;
  }
  function applySlideHash() {
    if (!viewerReady) return;
    const number = slideNumber();
    // The sandbox has an opaque origin, so messaging is bound to this frame's window.
    viewer.contentWindow.postMessage({ type: "bixing-slide:go", number }, "*");
    selectNotesPage(number);
  }
  function selectNotesPage(number) {
    document.dispatchEvent(new CustomEvent("bixing-notes:page", { detail: { slide: number } }));
  }
  viewer.addEventListener("load", () => {
    if (!accessCode) return;
    viewerReady = true;
    try {
      const preference = localStorage.getItem(previewKey);
      if (preference === "true" || preference === "false") {
        viewer.contentWindow.postMessage({ type: "bixing-preview:restore", open: preference === "true" }, "*");
      }
    } catch { /* The preview panel also works without persistence. */ }
    applySlideHash();
  });
  window.addEventListener("message", event => {
    const message = event.data;
    if (!accessCode || !viewerReady || event.source !== viewer.contentWindow || event.origin !== "null") return;
    if (message?.type === "bixing-preview:preference" && typeof message.open === "boolean") {
      try { localStorage.setItem(previewKey, String(message.open)); } catch { /* Keep the in-session choice. */ }
      return;
    }
    if (message?.type !== "bixing-slide:change" || !Number.isSafeInteger(message.number) || message.number < 1) return;
    const hash = message.number === 1 ? "" : "#" + message.number;
    if (location.hash !== hash) history.replaceState(history.state, "", location.pathname + location.search + hash);
    selectNotesPage(message.number);
  });

  async function decrypt(payload, code) {
    const material = await crypto.subtle.importKey("raw", encoder.encode(code), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({
      name: "PBKDF2", salt: context, iterations: 600000, hash: "SHA-256"
    }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    return crypto.subtle.decrypt({
      name: "AES-GCM", iv: payload.subarray(4, 16), additionalData: context, tagLength: 128
    }, key, payload.subarray(16));
  }

  function resetEntry() {
    pending?.abort();
    pending = null;
    button.disabled = false;
    input.removeAttribute("aria-invalid");
    form.removeAttribute("aria-busy");
    status.textContent = "";
  }
  async function unlock(value, fromField = false, startSlide = "") {
    resetEntry();
    const saved = savedCode();
    const codes = [...new Set([canonicalCode(value), saved].filter(Boolean))];
    if (!codes.length) {
      if (value !== null) showCodeError("Enter a 12-character code or paste this presentation’s share link.", fromField);
      return;
    }
    const request = new AbortController();
    pending = request;
    button.disabled = true;
    form.setAttribute("aria-busy", "true");
    status.textContent = "Opening presentation…";
    let wrongCode = false;
    try {
      const response = await fetch(gate.dataset.payload || "./deck.bin", {
        mode: "same-origin", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: request.signal
      });
      if (!response.ok) throw new Error("Unavailable presentation");
      const payload = new Uint8Array(await response.arrayBuffer());
      if (payload.length < 32 || String.fromCharCode(...payload.subarray(0, 4)) !== "BWS1") throw new Error("Invalid presentation");
      for (const code of codes) {
        if (pending !== request) return;
        let plain;
        try { plain = await decrypt(payload, code); } catch { continue; }
        if (pending !== request) return;
        const html = new TextDecoder().decode(plain);
        // The policy must precede the author's markup. The outer doctype keeps standards mode.
        viewer.setAttribute("sandbox", "allow-scripts");
        viewer.referrerPolicy = "no-referrer";
        viewerReady = false;
        accessCode = code;
        viewer.srcdoc = prefix + html.replace(/^\s*<!doctype\s+html(?:\s[^>]*)?>/i, "");
        remember(code);
        input.value = "";
        clearSharedCode();
        if (startSlide) history.replaceState(history.state, "", location.pathname + location.search + "#" + startSlide);
        heading.hidden = true;
        status.textContent = "";
        viewer.hidden = false;
        copyButton.hidden = false;
        viewer.focus({ preventScroll: true });
        return;
      }
      if (request === pending && saved) remember("");
      wrongCode = true;
      throw new Error("Invalid access code");
    } catch {
      if (request === pending) {
        if (wrongCode) showCodeError("This code doesn’t open the slides. Check the presenter’s link.", fromField);
        else status.textContent = "The slides could not be loaded. Try again.";
      }
    } finally {
      if (request === pending) {
        pending = null;
        button.disabled = false;
        form.removeAttribute("aria-busy");
      }
    }
  }

  input.addEventListener("input", resetEntry);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const value = input.value.trim();
    if (!/^https?:\/\//i.test(value)) {
      unlock(value, true);
      return;
    }
    let link;
    try { link = new URL(value); } catch { /* The input feedback below also covers malformed links. */ }
    if (!link || link.origin !== location.origin || link.pathname.replace(/\/$/, "") !== location.pathname.replace(/\/$/, "")) {
      showCodeError("Paste the share link for this presentation.", true);
      return;
    }
    const fragment = new URLSearchParams(link.hash.slice(1));
    const anchor = [...fragment.keys()].find(key => /^[1-9]\d*$/.test(key) && Number.isSafeInteger(Number(key)));
    unlock(fragment.get("p") || "", true, anchor);
  });
  function openLocation() {
    const explicit = new URLSearchParams(location.hash.slice(1)).get("p");
    if (explicit !== null || !accessCode) unlock(explicit);
    else applySlideHash();
  }
  window.addEventListener("hashchange", openLocation);
  openLocation();
})();
