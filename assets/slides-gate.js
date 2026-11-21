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
  let pending;
  let opened = false;
  let viewerReady = false;

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
    if (!opened) return;
    viewerReady = true;
    applySlideHash();
  });
  window.addEventListener("message", event => {
    const message = event.data;
    if (!opened || !viewerReady || event.source !== viewer.contentWindow || event.origin !== "null" ||
        message?.type !== "bixing-slide:change" || !Number.isSafeInteger(message.number) || message.number < 1) return;
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

  async function unlock(value) {
    pending?.abort();
    pending = null;
    button.disabled = false;
    const saved = savedCode();
    const codes = [...new Set([canonicalCode(value), saved].filter(Boolean))];
    if (!codes.length) {
      if (value !== null) status.textContent = "Enter the 12-character access code from the private link.";
      return;
    }
    const request = new AbortController();
    pending = request;
    button.disabled = true;
    status.textContent = "Opening presentation…";
    let failure = "The encrypted presentation could not be loaded. Try again.";
    try {
      const response = await fetch("./deck.bin", {
        mode: "same-origin", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: request.signal
      });
      if (!response.ok) throw new Error("Unavailable presentation");
      const payload = new Uint8Array(await response.arrayBuffer());
      if (payload.length < 32 || String.fromCharCode(...payload.subarray(0, 4)) !== "BWS1") throw new Error("Invalid presentation");
      failure = "This code does not open the presentation. Check the original private link.";
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
        opened = true;
        viewer.srcdoc = prefix + html.replace(/^\s*<!doctype\s+html(?:\s[^>]*)?>/i, "");
        remember(code);
        input.value = "";
        clearSharedCode();
        heading.hidden = true;
        status.textContent = "";
        viewer.hidden = false;
        viewer.focus({ preventScroll: true });
        return;
      }
      if (request === pending && saved) remember("");
      throw new Error("Invalid access code");
    } catch {
      if (request === pending) status.textContent = failure;
    } finally {
      if (request === pending) {
        pending = null;
        button.disabled = false;
      }
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    unlock(input.value);
  });
  function openLocation() {
    const explicit = new URLSearchParams(location.hash.slice(1)).get("p");
    if (explicit !== null || !opened) unlock(explicit);
    else applySlideHash();
  }
  window.addEventListener("hashchange", openLocation);
  openLocation();
})();
