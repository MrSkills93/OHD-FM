/* ==========================================================================
   OHD Field Manuals — cover hover preview
   Flips through a few pre-rendered pages while the pointer is over a cover,
   the way a video thumbnail scrubs on hover. The PDF is never touched: the
   frames are plain images, and they aren't downloaded until the first hover,
   so the landing page costs nothing extra to load.

   Markup expected:
     <a class="featured-cover" href="1/1/"
        data-preview-dir="1/1/preview" data-preview-count="4">
       <img src="1/1/cover.png" alt="...">
     </a>

   Frames must be named 1.webp, 2.webp, ... inside the preview folder.
   ========================================================================== */

(function () {
  "use strict";

  var FRAME_MS = 850;   // how long each page is held
  var START_DELAY = 200; // ignore pointers just passing over

  // Hover previews only make sense with a real pointer, and shouldn't run at
  // all for people who've asked for reduced motion.
  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canHover || reducedMotion) return;

  var covers = document.querySelectorAll("[data-preview-count]");

  Array.prototype.forEach.call(covers, function (cover) {
    var dir = cover.getAttribute("data-preview-dir");
    var count = parseInt(cover.getAttribute("data-preview-count"), 10);
    if (!dir || !count || count < 1) return;

    var baseImg = cover.querySelector("img");
    if (!baseImg) return;

    var frames = [];      // the <img> elements for pages 2..N
    var ticks = [];       // progress segments
    var loaded = false;
    var loading = false;
    var startTimer = null;
    var cycleTimer = null;
    var index = 0;        // 0 = cover, 1..count = frames
    var total = count + 1;

    cover.classList.add("has-preview");

    /* ---------------------------------------------------------------- */

    function buildTicks() {
      var bar = document.createElement("span");
      bar.className = "preview-ticks";
      bar.setAttribute("aria-hidden", "true");
      for (var i = 0; i < total; i++) {
        var t = document.createElement("span");
        t.className = "preview-tick";
        bar.appendChild(t);
        ticks.push(t);
      }
      cover.appendChild(bar);
    }

    function load() {
      if (loaded || loading) return Promise.resolve(loaded);
      loading = true;

      var jobs = [];
      for (var i = 1; i <= count; i++) {
        jobs.push(loadFrame(dir + "/" + i + ".webp"));
      }

      return Promise.all(jobs).then(function (imgs) {
        // Bail out entirely if any frame is missing, rather than showing gaps
        if (imgs.some(function (im) { return !im; })) {
          loading = false;
          cover.classList.remove("has-preview");
          return false;
        }
        imgs.forEach(function (im) {
          im.className = "preview-frame";
          im.setAttribute("aria-hidden", "true");
          cover.appendChild(im);
          frames.push(im);
        });
        buildTicks();
        loaded = true;
        loading = false;
        return true;
      });
    }

    function loadFrame(src) {
      return new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () { resolve(im); };
        im.onerror = function () { resolve(null); };
        im.src = src;
      });
    }

    /* ---------------------------------------------------------------- */

    function show(i) {
      index = i;
      frames.forEach(function (f, n) {
        f.classList.toggle("is-visible", n === i - 1);
      });
      ticks.forEach(function (t, n) {
        t.classList.toggle("is-active", n === i);
      });
    }

    function advance() {
      show((index + 1) % total);
    }

    function begin() {
      if (cycleTimer) return;
      show(1);
      cycleTimer = setInterval(advance, FRAME_MS);
    }

    function enter() {
      clearTimeout(startTimer);
      startTimer = setTimeout(function () {
        load().then(function (ok) {
          // Pointer may have left while frames were downloading
          if (ok && cover.matches(":hover, :focus-within")) begin();
        });
      }, START_DELAY);
    }

    function leave() {
      clearTimeout(startTimer);
      clearInterval(cycleTimer);
      cycleTimer = null;
      if (loaded) show(0);
    }

    cover.addEventListener("mouseenter", enter);
    cover.addEventListener("mouseleave", leave);
    cover.addEventListener("focus", enter);
    cover.addEventListener("blur", leave);
  });
})();
