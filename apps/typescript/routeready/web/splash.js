// Opening animation: a route draws itself, the rider rides it, and a stop takes
// a call. Plays once per browser tab session, not inside the embedded phones,
// and briefly for people who prefer reduced motion. A click or key skips it.
// Loaded as a classic script at the top of <body>, so it covers the page before first paint.
(function () {
  if (window.top !== window.self) return;
  var KEY = "routeready-splash";
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
  } catch (error) {
    // Storage can be blocked; the animation simply plays.
  }
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var root = document.documentElement;
  root.classList.add("splash-on");

  var splash = document.createElement("div");
  splash.className = "splash" + (reduced ? " reduced" : "");
  splash.setAttribute("aria-hidden", "true");
  splash.innerHTML =
    '<div class="splash-mark">ROUTE<br>READY</div>' +
    '<svg viewBox="0 0 320 170" role="presentation">' +
    '<defs><path id="rr-splash-route" pathLength="1" d="M24 138 C 84 138, 92 60, 160 72 S 250 132, 296 44"></path></defs>' +
    '<use href="#rr-splash-route" class="route-ghost"></use>' +
    '<use href="#rr-splash-route" class="route-line"></use>' +
    '<g transform="translate(24 138)"><g class="pin hub"><rect x="-12" y="-12" width="24" height="24" rx="8"></rect><text>H</text></g></g>' +
    '<g transform="translate(88 101)"><g class="pin p1"><rect x="-12" y="-12" width="24" height="24" rx="8"></rect><text>1</text></g></g>' +
    '<g transform="translate(160 72)">' +
    '<circle class="ring" r="14"></circle><circle class="ring second" r="14"></circle>' +
    '<g class="pin p2"><rect x="-12" y="-12" width="24" height="24" rx="8"></rect><rect class="done" x="-12" y="-12" width="24" height="24" rx="8"></rect><text>2</text></g>' +
    '<g transform="translate(0 -32)"><g class="chip calling"><rect x="-54" y="-11" width="108" height="22" rx="11"></rect><text>📞 Calling Karim…</text></g></g>' +
    '<g transform="translate(0 -32)"><g class="chip ready"><rect x="-44" y="-11" width="88" height="22" rx="11"></rect><text>Ready now ✓</text></g></g>' +
    "</g>" +
    '<g transform="translate(296 44)"><g class="pin p3"><rect x="-12" y="-12" width="24" height="24" rx="8"></rect><text>3</text></g></g>' +
    '<g class="scooter"><g transform="scale(-1 1)"><text x="-14" y="-10" font-size="24">🛵</text></g>' +
    '<animateMotion dur="' + (reduced ? "0.01s" : "1.5s") + '" begin="' + (reduced ? "0s" : "0.35s") + '" fill="freeze" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.25 1">' +
    '<mpath href="#rr-splash-route"></mpath></animateMotion></g>' +
    "</svg>" +
    '<p class="tagline">The delivery route that calls ahead.</p>' +
    '<p class="powered">Real phone calls through CALL-E</p>' +
    '<span class="skip">Tap to skip</span>';
  document.body.prepend(splash);

  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    splash.classList.add("leaving");
    root.classList.remove("splash-on");
    window.dispatchEvent(new Event("routeready:splash-done"));
    setTimeout(function () {
      splash.remove();
    }, 750);
  }
  splash.addEventListener("click", finish);
  document.addEventListener("keydown", finish, { once: true });
  setTimeout(finish, reduced ? 600 : 2700);
})();
