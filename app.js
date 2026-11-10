(function () {
  "use strict";

  var CFG = window.X_CONFIG || {};
  var sb = CFG.supabaseUrl && CFG.supabaseKey && window.supabase ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

  var TRIGGERS = ["Aburrimiento", "Estrés", "Soledad", "Cansancio", "Ansiedad", "De noche en la cama", "Al despertar", "Solo en casa", "Redes sociales", "Contenido sugerente", "Tiempo libre sin plan", "Tristeza", "Otro"];
  // Qué fue: X cuenta días sin porno y sin masturbación. Cualquiera de las dos reinicia el contador.
  var WHAT = [{ v: "porno", label: "Porno" }, { v: "masturbacion", label: "Masturbación" }];
  function whatLabel(list) {
    return WHAT.filter(function (w) { return (list || []).indexOf(w.v) >= 0; }).map(function (w) { return w.label.toLowerCase(); }).join(" y ");
  }
  var ALTS = [
    "Levántate de la cama y sal del cuarto. No te quedes acostado con el impulso.",
    "Ve a un lugar donde haya gente: la sala, la cocina, la calle.",
    "Sal a caminar 10 minutos, aunque sea alrededor de la casa.",
    "Date una ducha. Si puedes, que el final sea con agua fría.",
    "Haz 20 sentadillas o flexiones ahora mismo.",
    "Escríbele o llama a alguien, de lo que sea.",
    "Toma un vaso de agua despacio.",
    "Deja el celular en otra habitación y sal del cuarto.",
    "Escribe en papel lo que estás sintiendo.",
    "Pon música y ordena algo pequeño: tu escritorio, tu cama.",
    "Lee 5 páginas de un libro."
  ];
  var MILESTONES = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365, 500, 730, 1000];
  var MOMENTS = [
    { key: "madrugada", label: "Madrugada (0–6 h)", from: 0, to: 6 },
    { key: "mañana", label: "Mañana (6–12 h)", from: 6, to: 12 },
    { key: "tarde", label: "Tarde (12–19 h)", from: 12, to: 19 },
    { key: "noche", label: "Noche (19–24 h)", from: 19, to: 24 }
  ];
  var ICONS = {
    wave: '<path d="M3 13c2.2 0 2.2-3 4.5-3s2.3 3 4.5 3 2.2-3 4.5-3 2.3 3 4.5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M3 17.5c2.2 0 2.2-3 4.5-3s2.3 3 4.5 3 2.2-3 4.5-3 2.3 3 4.5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" opacity=".55"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
    minus: '<path d="M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>'
  };
  function icon(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + "</svg>"; }

  var S = {
    authReady: false, uid: null, userMeta: {},
    loaded: false, loadError: false, missing: false,
    profile: null, events: [],
    sheet: null, busy: false, armedDel: null
  };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function must(res) { if (res.error) throw res.error; return res.data; }
  function nowIso() { return new Date().toISOString(); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3600);
  }
  function fmtDay(ms) { return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "long" }); }
  function fmtWhen(ms) {
    var d = new Date(ms), today = new Date(), yest = new Date(); yest.setDate(today.getDate() - 1);
    var time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === today.toDateString()) return "Hoy, " + time;
    if (d.toDateString() === yest.toDateString()) return "Ayer, " + time;
    return d.toLocaleDateString("es", { day: "numeric", month: "short" }) + ", " + time;
  }
  function localInputValue(ms) {
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function tableMissing(e) {
    var code = e && e.code, msg = String((e && e.message) || "");
    return code === "42P01" || code === "PGRST205" || /x_(profiles|events).*(does not exist|not find)|Could not find the table/i.test(msg);
  }

  // ---------- Tiempo y rachas ----------
  function startedAt() { return S.profile ? Date.parse(S.profile.started_at) : Date.now(); }
  function relapseTimes() {
    return S.events.filter(function (e) { return e.kind === "relapse"; })
      .map(function (e) { return Date.parse(e.at); }).sort(function (a, b) { return a - b; });
  }
  // La racha actual empieza en la última recaída (o en el inicio, si no hubo).
  function currentStart() {
    var t = startedAt();
    relapseTimes().forEach(function (r) { if (r > t) t = r; });
    return t;
  }
  function split(ms) {
    ms = Math.max(0, ms);
    return { days: Math.floor(ms / 864e5), hours: Math.floor((ms % 864e5) / 36e5), mins: Math.floor((ms % 36e5) / 6e4) };
  }
  function bestStreakMs() {
    var points = [startedAt()].concat(relapseTimes().filter(function (r) { return r >= startedAt(); }));
    points.push(Date.now());
    var best = 0;
    for (var i = 1; i < points.length; i++) best = Math.max(best, points[i] - points[i - 1]);
    return best;
  }
  function milestoneFor(days) {
    var prev = 0;
    for (var i = 0; i < MILESTONES.length; i++) {
      if (MILESTONES[i] > days) return { prev: prev, next: MILESTONES[i] };
      prev = MILESTONES[i];
    }
    var next = Math.ceil((days + 1) / 365) * 365;
    return { prev: next - 365, next: next };
  }

  // ---------- Render ----------
  function renderAuth() {
    $("authArea").innerHTML = S.uid ? '<button class="btn ghost" type="button" data-action="logout">Salir</button>' : "";
  }

  function render() {
    renderAuth();
    var el = $("app");
    if (!sb) { el.innerHTML = '<p class="notice">Falta configurar la conexión en config.js.</p>'; return; }
    if (!S.authReady) { el.innerHTML = '<p class="notice">Cargando…</p>'; return; }
    if (!S.uid) {
      el.innerHTML = '<section class="welcome"><h1>Un día a la vez.</h1>' +
        "<p>X te acompaña a dejar un hábito que ya no quieres: cuenta tus días, te sostiene en los momentos difíciles y te muestra tus patrones. Es privado: solo tú lo ves.</p>" +
        '<div class="actions"><button class="btn primary big" type="button" data-action="signup">Crear cuenta</button>' +
        '<button class="btn big" type="button" data-action="login">Ya tengo cuenta</button></div></section>';
      return;
    }
    if (!S.loaded) { el.innerHTML = '<p class="notice">Cargando…</p>'; return; }
    if (S.missing) { el.innerHTML = '<p class="notice">Falta crear las tablas de X en la base de datos (supabase.sql).</p>'; return; }
    if (S.loadError) { el.innerHTML = '<p class="notice">No se pudieron cargar tus datos. Revisa tu conexión y recarga la página.</p>'; return; }
    if (!S.profile) {
      el.innerHTML = '<section class="welcome"><h1>Empecemos.</h1><p>Dos preguntas rápidas y listo: desde cuándo cuentas y por qué quieres dejarlo.</p>' +
        '<div class="actions"><button class="btn primary big" type="button" data-action="onboarding">Empezar</button></div></section>';
      return;
    }
    renderDashboard();
  }

  function renderDashboard() {
    var reasons = (S.profile.reasons || []).filter(Boolean);
    var urges = S.events.filter(function (e) { return e.kind === "urge"; }).length;
    var relapses = relapseTimes().length;
    var best = split(bestStreakMs()).days;

    $("app").innerHTML =
      '<section class="hero">' +
        '<h1 class="count"><span class="num" id="cNum">0</span><span class="unit" id="cUnit">días</span></h1>' +
        '<p class="free">sin porno ni masturbación</p>' +
        '<p class="since" id="cSince"></p>' +
        '<div class="goal"><div class="goal-head"><span id="gText"></span><span id="gLeft"></span></div>' +
        '<div class="track"><span id="gBar"></span></div></div>' +
        '<button class="sos-btn" type="button" data-action="sos">' + icon("wave") + "Tengo un impulso</button>" +
        '<div class="quick"><button class="btn" type="button" data-action="urge">Registrar impulso</button>' +
        '<button class="btn ghost" type="button" data-action="relapse">Tuve una recaída</button></div>' +
      "</section>" +

      '<section class="panel"><div class="panel-head"><h2>Mis motivos</h2>' +
        '<button class="link" type="button" data-action="reasons">' + (reasons.length ? "Editar" : "Agregar") + "</button></div>" +
        (reasons.length ? '<ul class="reasons">' + reasons.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("") + "</ul>"
          : '<p class="notice">Escribe por qué quieres dejarlo. Te los mostraré cuando llegue un impulso.</p>') +
      "</section>" +

      '<section class="panel"><h2>Tu progreso</h2><dl class="facts">' +
        "<div><dt>" + plural(best, "día de mejor racha", "días de mejor racha") + "</dt><dd>" + best + "</dd></div>" +
        "<div><dt>" + plural(urges, "impulso superado", "impulsos superados") + "</dt><dd>" + urges + "</dd></div>" +
        "<div><dt>" + plural(relapses, "recaída", "recaídas") + "</dt><dd>" + relapses + "</dd></div>" +
      "</dl></section>" +

      renderPatterns() +
      renderHistory();

    updateCounter();
  }

  function updateCounter() {
    if (!$("cNum") || !S.profile) return;
    var start = currentStart(), t = split(Date.now() - start);
    $("cNum").textContent = t.days;
    $("cUnit").textContent = plural(t.days, "día", "días");
    $("cSince").textContent = "y " + t.hours + " h " + t.mins + " min · desde el " + fmtDay(start);
    var m = milestoneFor(t.days);
    var span = (m.next - m.prev) * 864e5, done = Date.now() - start - m.prev * 864e5;
    var left = split(m.next * 864e5 - (Date.now() - start));
    $("gText").innerHTML = "Próxima meta: <b>" + m.next + " " + plural(m.next, "día", "días") + "</b>";
    $("gLeft").textContent = "faltan " + (left.days ? left.days + " d " : "") + left.hours + " h";
    $("gBar").style.width = Math.max(2, Math.min(100, done / span * 100)) + "%";
  }
  setInterval(updateCounter, 30000);

  function renderPatterns() {
    var since = Date.now() - 30 * 864e5;
    var recent = S.events.filter(function (e) { return Date.parse(e.at) >= since; });
    var h = '<section class="panel"><h2>Tus patrones</h2>';
    if (recent.length < 3) {
      return h + '<p class="notice">Registra tus impulsos (y si pasa, tus recaídas). Con unos pocos registros aquí verás a qué hora aparecen y qué los provoca.</p></section>';
    }
    var byMoment = MOMENTS.map(function (m) {
      return { label: m.label, key: m.key, n: recent.filter(function (e) { var hr = new Date(e.at).getHours(); return hr >= m.from && hr < m.to; }).length };
    });
    var trig = {};
    recent.forEach(function (e) { (e.triggers || []).forEach(function (t) { trig[t] = (trig[t] || 0) + 1; }); });
    var trigList = Object.keys(trig).map(function (k) { return { label: k, n: trig[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
    var whatList = WHAT.map(function (w) {
      return { label: w.label, n: recent.filter(function (e) { return (e.what || []).indexOf(w.v) >= 0; }).length };
    });
    var hasWhat = whatList.some(function (x) { return x.n > 0; });

    // Si hay empate se nombran todos los que empatan (máximo dos).
    function tops(list, key) {
      var max = Math.max.apply(null, list.map(function (x) { return x.n; }));
      return list.filter(function (x) { return x.n === max && max > 0; }).slice(0, 2).map(function (x) { return "<b>" + esc(key(x)) + "</b>"; });
    }
    var moments = tops(byMoment, function (x) { return x.key; });
    var causes = trigList.length ? tops(trigList, function (x) { return x.label.toLowerCase(); }) : [];
    var insight = "En los últimos 30 días, lo que registras aparece más en la " + moments.join(" y la ") +
      (causes.length ? " y suele venir de " + causes.join(" o de ") : "") + ". Ten un plan para " + (moments.length > 1 ? "esos momentos." : "ese momento.");

    function bars(list) {
      var max = Math.max.apply(null, list.map(function (x) { return x.n; })) || 1;
      return '<div class="bars">' + list.map(function (x) {
        return '<div class="bar-row' + (x.n === max && x.n > 0 ? " peak" : "") + '"><span class="lbl" title="' + esc(x.label) + '">' + esc(x.label) + "</span>" +
          '<span class="bar"><span style="width:' + (x.n / max * 100) + '%"></span></span><span class="val">' + x.n + "</span></div>";
      }).join("") + "</div>";
    }
    return h + '<p class="insight">' + insight + "</p>" +
      '<p class="subhead">Momento del día</p>' + bars(byMoment) +
      (trigList.length ? '<p class="subhead">Qué lo provoca</p>' + bars(trigList) : "") +
      (hasWhat ? '<p class="subhead">Hacia qué</p>' + bars(whatList) : "") +
      "</section>";
  }

  function renderHistory() {
    var list = S.events.slice(0, 20);
    var h = '<section class="panel"><h2>Historial</h2>';
    if (!list.length) return h + '<p class="notice">Aún no hay registros. Cada impulso que superes aparecerá aquí.</p></section>';
    return h + '<ul class="history">' + list.map(function (e) {
      var relapse = e.kind === "relapse";
      var meta = [fmtWhen(Date.parse(e.at))];
      var w = whatLabel(e.what);
      if (w) meta.push(w);
      if (e.intensity) meta.push("intensidad " + e.intensity + "/5");
      if (e.triggers && e.triggers.length) meta.push(e.triggers.join(", "));
      var armed = S.armedDel === e.id;
      return '<li><span class="dot' + (relapse ? " relapse" : "") + '"></span><div>' +
        '<div class="what">' + (relapse ? "Recaída" : "Impulso superado") + "</div>" +
        '<div class="meta">' + esc(meta.join(" · ")) + "</div>" +
        (e.note ? '<p class="note">' + esc(e.note) + "</p>" : "") + "</div>" +
        '<button class="del' + (armed ? " armed" : "") + '" type="button" data-del="' + esc(e.id) + '">' + (armed ? "¿Eliminar? Toca otra vez" : "Eliminar") + "</button></li>";
    }).join("") + "</ul></section>";
  }

  // ---------- Datos ----------
  function loadAll() {
    if (!sb || !S.uid) { S.loaded = false; render(); return Promise.resolve(); }
    var uid = S.uid;
    return Promise.all([
      sb.from("x_profiles").select("started_at,reasons").eq("user_id", uid).maybeSingle(),
      // "*" para que funcione aunque aún no exista la columna "what".
      sb.from("x_events").select("*").eq("user_id", uid).order("at", { ascending: false }).limit(2000)
    ]).then(function (r) {
      if (uid !== S.uid) return;
      S.profile = must(r[0]);
      S.events = must(r[1]);
      S.loaded = true; S.loadError = false; S.missing = false;
      render();
      if (!S.profile && !S.sheet) openSheet("onboarding");
    }).catch(function (e) {
      if (uid !== S.uid) return;
      console.error("Error al cargar:", e);
      S.loaded = true;
      if (tableMissing(e)) S.missing = true; else S.loadError = true;
      render();
    });
  }

  // Si la base aún no tiene la columna "what", guarda sin ella en vez de fallar.
  function insertEvent(row) {
    return sb.from("x_events").insert(row).then(function (res) {
      var msg = String((res.error && res.error.message) || "");
      if (res.error && /what/.test(msg) && /column|schema/i.test(msg)) {
        var copy = {}; Object.keys(row).forEach(function (k) { if (k !== "what") copy[k] = row[k]; });
        return sb.from("x_events").insert(copy);
      }
      return res;
    }).then(must);
  }

  function run(fn) {
    if (S.busy || !sb || !S.uid) return Promise.resolve();
    S.busy = true;
    var submit = document.querySelector("#sheetForm [type=submit]");
    if (submit) submit.disabled = true;
    return Promise.resolve().then(fn).then(loadAll).catch(function (e) {
      console.error("Error al guardar:", e);
      toast(tableMissing(e) ? "Falta crear las tablas de X en la base de datos." : "No se pudo guardar. Revisa tu conexión e inténtalo otra vez.");
    }).then(function () {
      S.busy = false;
      var s = document.querySelector("#sheetForm [type=submit]");
      if (s) s.disabled = false;
    });
  }

  // ---------- Hojas (formularios) ----------
  function chipsHtml(list, name) {
    return '<div class="chips" data-group="' + name + '">' + list.map(function (t) {
      return '<button type="button" class="chip" aria-pressed="false" data-value="' + esc(t) + '">' + esc(t) + "</button>";
    }).join("") + "</div>";
  }
  function picked(name) {
    return Array.prototype.map.call(document.querySelectorAll('#sheetForm [data-group="' + name + '"] .chip[aria-pressed="true"]'),
      function (b) { return b.getAttribute("data-value"); });
  }
  function whatChips() {
    return '<div class="chips" data-group="what">' + WHAT.map(function (w) {
      return '<button type="button" class="chip" aria-pressed="false" data-value="' + w.v + '">' + w.label + "</button>";
    }).join("") + "</div>";
  }
  function scaleHtml() {
    var h = '<div class="scale chips" data-group="intensity" data-single="1">';
    for (var i = 1; i <= 5; i++) h += '<button type="button" class="chip" aria-pressed="false" data-value="' + i + '">' + i + "</button>";
    return h + "</div>";
  }
  function reasonInputs(list) {
    var rows = list.length ? list : ["", "", ""];
    return '<div class="section" id="reasonList">' + rows.map(function (r, i) {
      return '<div class="reason-row"><input type="text" maxlength="140" data-reason value="' + esc(r) + '" placeholder="' +
        esc(["Quiero tener relaciones sanas y reales", "Recuperar mi energía y mi concentración", "Sentirme en paz conmigo mismo"][i % 3]) +
        '" aria-label="Motivo ' + (i + 1) + '">' +
        '<button type="button" class="x" data-action="reason-remove" aria-label="Quitar motivo">' + icon("minus") + "</button></div>";
    }).join("") + "</div>" +
      '<button type="button" class="btn" data-action="reason-add">' + icon("plus") + "Agregar otro motivo</button>";
  }
  function readReasons() {
    return Array.prototype.map.call(document.querySelectorAll("#sheetForm [data-reason]"), function (i) { return i.value.trim(); })
      .filter(Boolean).slice(0, 8);
  }
  function formMsg(kind, text) {
    var e = $("fErr"), o = $("fOk");
    if (e) { e.hidden = kind !== "err"; if (kind === "err") e.textContent = text; }
    if (o) { o.hidden = kind !== "ok"; if (kind === "ok") o.textContent = text; }
  }
  var MSG = '<p class="err" id="fErr" hidden></p><p class="ok" id="fOk" hidden></p>';

  function openSheet(kind, opts) {
    opts = opts || {};
    S.sheet = kind;
    var title = "", body = "";
    if (kind === "login" || kind === "signup") {
      title = kind === "login" ? "Entrar" : "Crear cuenta";
      body = '<div class="seg" role="group" aria-label="Entrar o crear cuenta">' +
        '<button type="button" data-sheet="login" aria-pressed="' + (kind === "login") + '">Entrar</button>' +
        '<button type="button" data-sheet="signup" aria-pressed="' + (kind === "signup") + '">Crear cuenta</button></div>' +
        '<p class="lede">' + (kind === "login" ? "Si ya usas el Estante de Lecturas, es la misma cuenta." : "Tu cuenta es privada: solo tú ves tus datos.") + "</p>" +
        '<div class="field"><label for="fEmail">Correo</label><input id="fEmail" type="email" autocomplete="email"></div>' +
        '<div class="field"><label for="fPass">Contraseña</label><input id="fPass" type="password" autocomplete="' + (kind === "login" ? "current-password" : "new-password") + '">' +
        (kind === "signup" ? '<span class="hint">Mínimo 6 caracteres.</span>' : "") + "</div>" + MSG +
        '<div class="actions"><button class="btn primary" type="submit">' + (kind === "login" ? "Entrar" : "Crear cuenta") + "</button></div>" +
        (kind === "login" ? '<button class="link" type="button" data-sheet="reset">¿Olvidaste tu contraseña?</button>' : "");
    } else if (kind === "reset") {
      title = "Recuperar contraseña";
      body = '<p class="lede">Te enviaremos un enlace para crear una contraseña nueva.</p>' +
        '<div class="field"><label for="fEmail">Correo</label><input id="fEmail" type="email" autocomplete="email"></div>' + MSG +
        '<div class="actions"><button class="btn primary" type="submit">Enviar enlace</button>' +
        '<button class="link" type="button" data-sheet="login">Volver a entrar</button></div>';
    } else if (kind === "newpass") {
      title = "Nueva contraseña";
      body = '<div class="field"><label for="fPass">Contraseña nueva</label><input id="fPass" type="password" autocomplete="new-password"><span class="hint">Mínimo 6 caracteres.</span></div>' + MSG +
        '<div class="actions"><button class="btn primary" type="submit">Guardar contraseña</button></div>';
    } else if (kind === "onboarding") {
      title = "Empecemos";
      body = '<p class="lede">X cuenta tus días sin porno ni masturbación, te ayuda cuando llega un impulso y te muestra tus patrones. Todo es privado.</p>' +
        '<div class="field"><span class="lbl">¿Desde cuándo llevas sin porno ni masturbación?</span><div class="choice">' +
        '<label><input type="radio" name="since" value="today" checked> Empiezo hoy</label>' +
        '<label><input type="radio" name="since" value="date"> Desde una fecha</label></div>' +
        '<input id="fSince" type="date" max="' + localInputValue(Date.now()).slice(0, 10) + '" aria-label="Fecha de inicio" hidden></div>' +
        '<div class="field"><span class="lbl">¿Por qué quieres dejarlo?</span><span class="hint">Escribe tus motivos con tus palabras. Te los mostraré cuando más los necesites.</span></div>' +
        reasonInputs([]) + MSG +
        '<div class="actions"><button class="btn primary big" type="submit">Empezar a contar</button></div>';
    } else if (kind === "reasons") {
      title = "Mis motivos";
      body = '<p class="lede">Lo que te mueve a dejarlo. Aparecen cuando pulsas «Tengo un impulso».</p>' +
        reasonInputs((S.profile.reasons || []).filter(Boolean)) + MSG +
        '<div class="actions"><button class="btn primary" type="submit">Guardar</button></div>';
    } else if (kind === "urge") {
      title = "Registrar impulso";
      body = '<p class="lede">' + (opts.fromSos ? "Bien hecho. Anota cómo fue: te ayuda a ver cuándo y por qué aparecen." : "Anotarlo te ayuda a ver cuándo y por qué aparecen. Cuenta como impulso superado.") + "</p>" +
        '<div class="field"><span class="lbl">¿Ganas de qué?</span>' + whatChips() + "</div>" +
        '<div class="field"><span class="lbl">¿Qué tan fuerte fue?</span>' + scaleHtml() + '<span class="hint">1 = leve · 5 = muy fuerte</span></div>' +
        '<div class="field"><span class="lbl">¿Qué lo provocó?</span>' + chipsHtml(TRIGGERS, "triggers") + "</div>" +
        '<div class="field"><label for="fNote">Nota (opcional)</label><textarea id="fNote" maxlength="2000" placeholder="Qué estabas haciendo, cómo te sentías, qué te ayudó…"></textarea></div>' + MSG +
        '<div class="actions"><button class="btn calm" type="submit">Guardar</button></div>';
    } else if (kind === "relapse") {
      title = "Tuve una recaída";
      body = '<div class="calm-box">Pasa, y no borra lo que avanzaste: tu mejor racha y tu historial se quedan. Lo que importa ahora es entender qué pasó y volver a empezar.</div>' +
        '<div class="field"><span class="lbl">¿Qué pasó?</span>' + whatChips() + '<span class="hint">Marca una o las dos. Cualquiera reinicia el contador.</span></div>' +
        '<div class="field"><label for="fAt">¿Cuándo fue?</label><input id="fAt" type="datetime-local" value="' + localInputValue(Date.now()) + '" max="' + localInputValue(Date.now()) + '"></div>' +
        '<div class="field"><span class="lbl">¿Qué lo provocó?</span>' + chipsHtml(TRIGGERS, "triggers") + "</div>" +
        '<div class="field"><label for="fNote">¿Qué pasó antes? ¿Qué harías distinto la próxima vez?</label><textarea id="fNote" maxlength="2000"></textarea></div>' + MSG +
        '<div class="actions"><button class="btn primary" type="submit">Registrar y empezar de nuevo</button></div>';
    }
    $("sheetTitle").textContent = title;
    $("sheetForm").innerHTML = body;
    $("sheetLayer").hidden = false;
    var first = $("sheetForm").querySelector("input:not([type=radio]):not([hidden]), textarea");
    if (first && kind !== "relapse") first.focus();
  }
  function closeSheet() { S.sheet = null; $("sheetLayer").hidden = true; $("sheetForm").innerHTML = ""; }

  function authError(err) {
    var msg = String((err && err.message) || "");
    if (/already registered|already exists/i.test(msg)) return "Ese correo ya tiene una cuenta. Usa «Entrar».";
    if (/signups? not allowed|signup.*disabled/i.test(msg)) return "Los registros nuevos están cerrados por ahora.";
    if (/password.*(6|short|least)/i.test(msg)) return "La contraseña debe tener al menos 6 caracteres.";
    if (/rate limit|too many/i.test(msg)) return "Demasiados intentos. Espera unos minutos.";
    if (/not confirmed/i.test(msg)) return "Tu correo aún no está confirmado. Abre el enlace que te enviamos.";
    if (/invalid login credentials/i.test(msg)) return "Correo o contraseña incorrectos.";
    return "No se pudo completar. Revisa tu conexión e inténtalo otra vez.";
  }

  $("sheetForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var kind = S.sheet, here = location.origin + location.pathname;
    var email = $("fEmail") ? $("fEmail").value.trim() : "", pass = $("fPass") ? $("fPass").value : "";

    if (kind === "login" || kind === "signup" || kind === "reset" || kind === "newpass") {
      if ($("fEmail") && !email) { formMsg("err", "Escribe tu correo."); return; }
      if ($("fPass") && pass.length < 6) { formMsg("err", "La contraseña debe tener al menos 6 caracteres."); return; }
      var call = kind === "login" ? sb.auth.signInWithPassword({ email: email, password: pass })
        : kind === "signup" ? sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: here } })
        : kind === "reset" ? sb.auth.resetPasswordForEmail(email, { redirectTo: here })
        : sb.auth.updateUser({ password: pass });
      var btn = $("sheetForm").querySelector("[type=submit]"); btn.disabled = true;
      call.then(function (res) {
        btn.disabled = false;
        if (res.error) { formMsg("err", authError(res.error)); return; }
        if (kind === "signup" && !(res.data && res.data.session)) { formMsg("ok", "Te enviamos un correo a " + email + ". Abre el enlace para activar tu cuenta."); return; }
        if (kind === "reset") { formMsg("ok", "Si " + email + " tiene cuenta, te llegará un enlace en unos minutos."); return; }
        closeSheet();
        if (kind === "newpass") toast("Contraseña actualizada.");
      }, function () { btn.disabled = false; formMsg("err", "No se pudo completar. Revisa tu conexión."); });
      return;
    }

    if (kind === "onboarding") {
      var useDate = document.querySelector('#sheetForm input[name="since"]:checked').value === "date";
      var start = Date.now();
      if (useDate) {
        if (!$("fSince").value) { formMsg("err", "Elige la fecha."); return; }
        var p = $("fSince").value.split("-");
        start = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
        if (start > Date.now()) { formMsg("err", "La fecha no puede ser futura."); return; }
      }
      var reasons = readReasons();
      run(function () {
        return sb.from("x_profiles").upsert({ user_id: S.uid, started_at: new Date(start).toISOString(), reasons: reasons, updated_at: nowIso() })
          .then(must).then(function () { closeSheet(); toast("Listo. Un día a la vez."); });
      });
      return;
    }
    if (kind === "reasons") {
      var list = readReasons();
      run(function () {
        return sb.from("x_profiles").update({ reasons: list, updated_at: nowIso() }).eq("user_id", S.uid)
          .then(must).then(function () { closeSheet(); toast("Motivos guardados."); });
      });
      return;
    }
    if (kind === "urge") {
      var intensity = Number(picked("intensity")[0]) || null;
      var row = { user_id: S.uid, kind: "urge", at: nowIso(), intensity: intensity, what: picked("what"), triggers: picked("triggers"), note: $("fNote").value.trim() || null };
      run(function () {
        return insertEvent(row).then(function () { closeSheet(); toast("Impulso superado. Sigue así."); });
      });
      return;
    }
    if (kind === "relapse") {
      var at = $("fAt").value ? new Date($("fAt").value).getTime() : Date.now();
      if (at > Date.now() + 60000) { formMsg("err", "La fecha no puede ser futura."); return; }
      var what = picked("what");
      if (!what.length) { formMsg("err", "Marca qué pasó: porno, masturbación o las dos."); return; }
      var r = { user_id: S.uid, kind: "relapse", at: new Date(at).toISOString(), what: what, triggers: picked("triggers"), note: $("fNote").value.trim() || null };
      run(function () {
        return insertEvent(r).then(function () { closeSheet(); toast("Registrado. Tu nuevo comienzo empieza ahora."); });
      });
    }
  });

  // ---------- Modo impulso ----------
  var BREATH = [["Inhala", 4, true], ["Sostén", 4, true], ["Exhala", 6, false]];
  var sosT = { breath: null, tick: null, reason: null };
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function openSos() {
    $("sosLayer").hidden = false;
    document.body.style.overflow = "hidden";
    $("sosTitle").textContent = "Esto va a pasar.";
    $("sosAlts").innerHTML = shuffle(ALTS).slice(0, 4).map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("");

    var reasons = shuffle(((S.profile && S.profile.reasons) || []).filter(Boolean));
    var q = $("sosReason"), ri = 0;
    q.hidden = !reasons.length;
    function showReason() { if (reasons.length) { q.textContent = "«" + reasons[ri % reasons.length] + "»"; ri++; } }
    showReason();
    sosT.reason = setInterval(showReason, 15000);

    var circle = $("breathCircle"), text = $("breathText"), step = 0;
    function breathe() {
      var p = BREATH[step % BREATH.length];
      text.textContent = p[0];
      circle.style.transitionDuration = p[1] + "s";
      circle.classList.toggle("grow", p[2]);
      step++;
      sosT.breath = setTimeout(breathe, p[1] * 1000);
    }
    circle.classList.remove("grow");
    sosT.breath = setTimeout(breathe, 60);

    var end = Date.now() + 10 * 60 * 1000;
    function tick() {
      var left = Math.max(0, end - Date.now()), m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $("sosTimer").textContent = m + ":" + String(s).padStart(2, "0");
      if (!left) { clearInterval(sosT.tick); $("sosTitle").textContent = "Lo lograste."; $("sosTimer").textContent = "10 minutos"; }
    }
    tick();
    sosT.tick = setInterval(tick, 1000);
    $("sosLayer").querySelector(".x").focus();
  }
  function closeSos() {
    clearTimeout(sosT.breath); clearInterval(sosT.tick); clearInterval(sosT.reason);
    $("sosLayer").hidden = true;
    document.body.style.overflow = "";
  }

  // ---------- Eventos ----------
  var disarm = null;
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, [data-close]");
    if (!t) return;
    var close = t.getAttribute("data-close");
    if (close === "sheet") { closeSheet(); return; }
    if (close === "sos") { closeSos(); return; }
    if (t.hasAttribute("data-sheet")) { openSheet(t.getAttribute("data-sheet")); return; }

    var group = t.parentElement && t.parentElement.getAttribute("data-group");
    if (t.classList.contains("chip") && group) {
      var on = t.getAttribute("aria-pressed") !== "true";
      if (t.parentElement.hasAttribute("data-single")) {
        t.parentElement.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
      }
      t.setAttribute("aria-pressed", String(on));
      return;
    }
    if (t.hasAttribute("data-del")) {
      var id = t.getAttribute("data-del");
      clearTimeout(disarm);
      if (S.armedDel === id) {
        S.armedDel = null;
        run(function () { return sb.from("x_events").delete().eq("id", id).eq("user_id", S.uid).then(must).then(function () { toast("Registro eliminado."); }); });
      } else {
        S.armedDel = id;
        renderDashboard();
        disarm = setTimeout(function () { S.armedDel = null; if (S.profile) renderDashboard(); }, 4000);
      }
      return;
    }

    switch (t.getAttribute("data-action")) {
      case "login": openSheet("login"); break;
      case "signup": openSheet("signup"); break;
      case "logout": sb.auth.signOut(); break;
      case "onboarding": openSheet("onboarding"); break;
      case "reasons": openSheet("reasons"); break;
      case "urge": openSheet("urge"); break;
      case "relapse": openSheet("relapse"); break;
      case "sos": openSos(); break;
      case "sos-done": closeSos(); openSheet("urge", { fromSos: true }); break;
      case "reason-add":
        var listEl = $("reasonList");
        if (listEl && listEl.children.length < 8) {
          listEl.insertAdjacentHTML("beforeend", '<div class="reason-row"><input type="text" maxlength="140" data-reason aria-label="Motivo ' + (listEl.children.length + 1) + '">' +
            '<button type="button" class="x" data-action="reason-remove" aria-label="Quitar motivo">' + icon("minus") + "</button></div>");
          listEl.lastElementChild.querySelector("input").focus();
        }
        break;
      case "reason-remove": t.closest(".reason-row").remove(); break;
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.name === "since") $("fSince").hidden = e.target.value !== "date";
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("sosLayer").hidden) closeSos();
    else if (!$("sheetLayer").hidden) closeSheet();
  });

  // ---------- Sesión ----------
  function setSession(session) {
    var uid = session && session.user ? session.user.id : null;
    var first = !S.authReady;
    S.authReady = true;
    if (uid === S.uid && !first) return;
    S.uid = uid;
    S.profile = null; S.events = []; S.loaded = false; S.loadError = false; S.missing = false;
    closeSos();
    if (S.sheet && S.sheet !== "newpass" && uid) closeSheet();
    render();
    loadAll();
  }

  render();
  if (sb) {
    sb.auth.getSession().then(function (res) { setSession(res.data && res.data.session); });
    sb.auth.onAuthStateChange(function (event, session) {
      setSession(session);
      if (event === "PASSWORD_RECOVERY") openSheet("newpass");
    });
  } else {
    S.authReady = true;
    render();
  }
})();
