/* ==========================================================================
   OHD Field Manuals — shared viewer
   This file is identical for every manual. Per-manual settings (the PDF
   path and the contents list) come from the manual's own index.html, so a
   new manual never needs this file edited.
   ========================================================================== */

import * as pdfjsLib from "../vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;

/* -------------------------------------------------------------------- */
/* Per-manual configuration                                              */
/* -------------------------------------------------------------------- */

const config = readConfig();

function readConfig() {
  const el = document.getElementById("manual-config");
  if (!el) {
    return { pdf: "manual.pdf", contents: [] };
  }
  try {
    const parsed = JSON.parse(el.textContent);
    return {
      pdf: parsed.pdf || "manual.pdf",
      contents: Array.isArray(parsed.contents) ? parsed.contents : [],
    };
  } catch (err) {
    console.error("Could not read manual config:", err);
    return { pdf: "manual.pdf", contents: [] };
  }
}

/* -------------------------------------------------------------------- */
/* Tuning                                                                */
/* -------------------------------------------------------------------- */

const MAX_CONTENT_WIDTH = 900;     // reading column cap, CSS px
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.2;
const ZOOM_STEP = 0.15;
const ABS_MAX_RENDER_SCALE = 3.0;  // sharpness ceiling; higher = more memory
const OBSERVER_MARGIN = "500px 0px 500px 0px";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const els = {
  viewer: document.getElementById("viewer"),
  pageStack: document.getElementById("pageStack"),
  loading: document.getElementById("pdfLoading"),
  loadingFill: document.getElementById("loadingFill"),
  loadingText: document.getElementById("loadingText"),
  pageInput: document.getElementById("pageInput"),
  pageTotal: document.getElementById("pageTotal"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomLevel: document.getElementById("zoomLevel"),
  tocToggle: document.getElementById("tocToggle"),
  tocClose: document.getElementById("tocClose"),
  tocScrim: document.getElementById("tocScrim"),
  tocList: document.getElementById("tocList"),
};

let pdfDoc = null;
let baseScale = 1;
let zoomFactor = 1;
let currentPage = 1;
let scrollRaf = null;

/** One entry per PDF page */
const pageEntries = [];

init().catch((err) => {
  console.error(err);
  els.loadingText.textContent = "COULD NOT LOAD THE MANUAL — TRY REFRESHING";
});

async function init() {
  const loadingTask = pdfjsLib.getDocument({ url: config.pdf });
  loadingTask.onProgress = (p) => {
    if (p.total) updateLoadingBar(p.loaded / p.total);
  };
  pdfDoc = await loadingTask.promise;
  els.pageTotal.textContent = pdfDoc.numPages;

  await buildPlaceholders();
  buildToc();
  setupObserver();
  wireControls();

  els.loading.remove();
  els.pageStack.hidden = false;

  const initial = pageFromHash();
  if (initial) goToPage(initial, "auto");

  els.viewer.addEventListener("scroll", onScroll, { passive: true });
}

function updateLoadingBar(fraction) {
  els.loadingFill.style.width = `${Math.max(8, Math.round(fraction * 100))}%`;
}

async function buildPlaceholders() {
  const containerWidth = Math.min(els.pageStack.clientWidth || window.innerWidth, MAX_CONTENT_WIDTH + 24) - 24;

  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const pdfPage = await pdfDoc.getPage(n);
    const unscaled = pdfPage.getViewport({ scale: 1 });

    if (n === 1) {
      baseScale = Math.min(containerWidth, MAX_CONTENT_WIDTH) / unscaled.width;
    }

    const container = document.createElement("div");
    container.className = "page-container skeleton";
    container.dataset.pageNum = String(n);
    container.style.width = `${unscaled.width * baseScale}px`;
    container.style.height = `${unscaled.height * baseScale}px`;

    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Page ${n}`);
    container.appendChild(canvas);

    els.pageStack.appendChild(container);
    pageEntries.push({
      pageNum: n,
      pdfPage,
      container,
      canvas,
      unscaled: { w: unscaled.width, h: unscaled.height },
      rendered: false,
      rendering: false,
      renderTask: null,
    });
  }
}

function setupObserver() {
  const observer = new IntersectionObserver(onIntersect, {
    root: els.viewer,
    rootMargin: OBSERVER_MARGIN,
  });
  pageEntries.forEach((e) => observer.observe(e.container));
}

function onIntersect(entries) {
  for (const entry of entries) {
    const n = parseInt(entry.target.dataset.pageNum, 10);
    const e = pageEntries[n - 1];
    if (!e) continue;
    if (entry.isIntersecting) renderPage(e);
    else unrenderPage(e);
  }
}

async function renderPage(e, force = false) {
  if (e.rendering) return;
  if (e.rendered && !force) return;

  e.rendering = true;
  const cssScale = baseScale * zoomFactor;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const renderScale = Math.min(cssScale * dpr, ABS_MAX_RENDER_SCALE);
  const viewport = e.pdfPage.getViewport({ scale: renderScale });

  e.canvas.width = Math.round(viewport.width);
  e.canvas.height = Math.round(viewport.height);
  e.canvas.style.width = `${e.unscaled.w * cssScale}px`;
  e.canvas.style.height = `${e.unscaled.h * cssScale}px`;
  e.container.style.width = `${e.unscaled.w * cssScale}px`;
  e.container.style.height = `${e.unscaled.h * cssScale}px`;

  if (e.renderTask) {
    try { e.renderTask.cancel(); } catch (_) { /* noop */ }
  }

  const ctx = e.canvas.getContext("2d");
  const task = e.pdfPage.render({ canvasContext: ctx, viewport });
  e.renderTask = task;

  try {
    await task.promise;
    e.rendered = true;
    e.container.classList.remove("skeleton");
  } catch (err) {
    if (err?.name !== "RenderingCancelledException") console.error(err);
  } finally {
    e.rendering = false;
    e.renderTask = null;
  }
}

function unrenderPage(e) {
  if (e.renderTask) {
    try { e.renderTask.cancel(); } catch (_) { /* noop */ }
    e.renderTask = null;
  }
  if (e.rendered) {
    e.canvas.width = 0;
    e.canvas.height = 0;
    e.rendered = false;
    e.container.classList.add("skeleton");
  }
}

function relayout() {
  const cssScale = baseScale * zoomFactor;
  for (const e of pageEntries) {
    e.container.style.width = `${e.unscaled.w * cssScale}px`;
    e.container.style.height = `${e.unscaled.h * cssScale}px`;
    if (e.rendered) renderPage(e, true);
  }
}

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    updateCurrentPage();
  });
}

function updateCurrentPage() {
  const refY = els.viewer.getBoundingClientRect().top + 90;
  let best = pageEntries[0];
  for (const e of pageEntries) {
    const top = e.container.getBoundingClientRect().top;
    if (top <= refY) best = e;
    else break;
  }
  if (best && best.pageNum !== currentPage) {
    currentPage = best.pageNum;
    els.pageInput.value = String(currentPage);
    highlightToc();
    history.replaceState(null, "", `#page=${currentPage}`);
  }
}

function goToPage(n, behavior = prefersReducedMotion ? "auto" : "smooth") {
  const clamped = Math.min(Math.max(n, 1), pdfDoc.numPages);
  const e = pageEntries[clamped - 1];
  if (!e) return;
  e.container.scrollIntoView({ behavior, block: "start" });
  closeToc();
}

function pageFromHash() {
  const m = /page=(\d+)/.exec(location.hash);
  if (!m) return null;
  return Math.min(Math.max(parseInt(m[1], 10), 1), pdfDoc.numPages);
}

function buildToc() {
  els.tocList.innerHTML = "";
  if (!config.contents.length) {
    els.tocToggle.hidden = true;
    return;
  }
  for (const item of config.contents) {
    const li = document.createElement("li");
    li.className = item.level === "section" ? "toc-section" : "toc-chapter";

    const row = document.createElement("button");
    row.className = "toc-row";
    row.type = "button";
    row.dataset.pdfPage = String(item.pdf);

    const label = document.createElement("span");
    label.textContent = item.label;

    const fill = document.createElement("span");
    fill.className = "fill";
    fill.setAttribute("aria-hidden", "true");

    const pg = document.createElement("span");
    pg.className = "pg";
    pg.textContent = String(item.printed ?? item.pdf);

    row.append(label, fill, pg);
    row.addEventListener("click", () => goToPage(item.pdf));
    li.appendChild(row);
    els.tocList.appendChild(li);
  }
}

function highlightToc() {
  const rows = els.tocList.querySelectorAll(".toc-row");
  let activeRow = null;
  for (const row of rows) {
    const pdf = parseInt(row.dataset.pdfPage, 10);
    if (pdf <= currentPage) activeRow = row;
    row.removeAttribute("aria-current");
  }
  if (activeRow) activeRow.setAttribute("aria-current", "true");
}

function openToc() {
  document.body.classList.add("toc-open");
  els.tocToggle.setAttribute("aria-expanded", "true");
  els.tocClose.focus();
}

function closeToc() {
  const wasOpen = document.body.classList.contains("toc-open");
  document.body.classList.remove("toc-open");
  els.tocToggle.setAttribute("aria-expanded", "false");
  if (wasOpen) els.tocToggle.focus();
}

function wireControls() {
  els.tocToggle.addEventListener("click", openToc);
  els.tocClose.addEventListener("click", closeToc);
  els.tocScrim.addEventListener("click", closeToc);

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeToc();
  });

  els.pageInput.addEventListener("change", () => {
    const n = parseInt(els.pageInput.value, 10);
    if (!Number.isNaN(n)) goToPage(n);
    else els.pageInput.value = String(currentPage);
  });
  els.pageInput.addEventListener("focus", () => els.pageInput.select());

  els.zoomIn.addEventListener("click", () => setZoom(zoomFactor + ZOOM_STEP));
  els.zoomOut.addEventListener("click", () => setZoom(zoomFactor - ZOOM_STEP));

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const containerWidth = Math.min(els.pageStack.clientWidth || window.innerWidth, MAX_CONTENT_WIDTH + 24) - 24;
      const first = pageEntries[0];
      if (first) baseScale = Math.min(containerWidth, MAX_CONTENT_WIDTH) / first.unscaled.w;
      relayout();
    }, 200);
  });
}

function setZoom(next) {
  zoomFactor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  els.zoomLevel.textContent = `${Math.round(zoomFactor * 100)}%`;
  relayout();
}

setZoom(1);
