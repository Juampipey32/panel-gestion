/* Panel de gestión · front estático sobre Supabase.
   - Login por link al email (sin contraseñas). Solo entran usuarios cargados en public.acceso.
   - Todo el cálculo vive en la base (funciones SQL); acá solo se muestran resultados y se piden acciones.
   - Los PDF los genera la Edge Function "pdf" con la sesión del usuario. */
(function () {
  "use strict";
  var CFG = window.PANEL;
  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  /* ---------- utilidades ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var nf = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var r2 = function (n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; };
  var money = function (n) { return "$ " + nf.format(r2(n)); };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var iso = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var parse = function (s) { return new Date(s + "T12:00:00"); };
  var today = function () { return iso(new Date()); };
  var addDays = function (s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  var lunesDe = function (s) { var d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  var fdate = function (s) { return s ? String(s).split("-").reverse().join("/") : ""; };
  var num = function (v) { var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
  var norm = function (s) { return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); };
  var toastT;
  function toast(m) { var t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 3200); }
  function twice(btn, fn) {
    if (btn.dataset.armed) { fn(); return; }
    btn.dataset.armed = "1"; var old = btn.textContent; btn.textContent = "¿Seguro? Tocá otra vez";
    setTimeout(function () { delete btn.dataset.armed; btn.textContent = old; }, 3500);
  }
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function msg(e) { return (e && (e.message || e.error_description)) || String(e); }

  /* totales de una cotización (misma regla que la función SQL cot_totales) */
  function totales(c, items) {
    var s = function (t) { return r2(items.filter(function (i) { return i.tipo === t; }).reduce(function (a, i) { return a + Number(i.cantidad) * Number(i.precio_unitario); }, 0)); };
    var mo = s("mo"), mat = s("mat"), sub = r2(mo + mat);
    var iva = c.discrimina_iva ? r2(sub * Number(c.iva_pct) / 100) : 0;
    return { mo: mo, mat: mat, iva: iva, total: r2(sub + iva) };
  }

  /* ---------- estado ---------- */
  var S = { tab: "semana", lunes: lunesDe(today()), nuevaCot: false, itemsCot: [], pdfLink: null, cat: null };
  var TABS = [["semana", "Semana"], ["partes", "Partes"], ["cot", "Cotizaciones"], ["adel", "Adelantos"], ["mem", "Memoria"]];
  var TIPOS = [["normal", "Normal"], ["urgencia", "Urgencia 24 hs"], ["sabado", "Sábado"], ["domingo", "Domingo"], ["feriado", "Feriado"]];
  var $app = $("#app");

  /* ---------- login ---------- */
  function pantallaLogin(aviso) {
    $app.innerHTML = '<div class="login card"><h1>Panel de gestión</h1><p class="sub">Ingresá con tu email. Te mandamos un link para entrar, sin contraseña.</p>' +
      (aviso ? '<div class="banner ' + (aviso.mal ? "bad" : "") + '">' + esc(aviso.texto) + "</div>" : "") +
      '<form id="f-login"><label class="f"><span>Email</span><input id="lg-email" type="email" autocomplete="email" required></label>' +
      '<div class="actions"><button class="btn primary" type="submit">Enviarme el link</button></div></form>' +
      '<p class="help">Solo pueden entrar las personas autorizadas. Si no te llega el correo, revisá spam.</p></div>';
  }
  async function pedirLink(email) {
    var r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
    if (r.error) throw r.error;
  }

  /* ---------- arranque ---------- */
  async function iniciar() {
    var ses = (await sb.auth.getSession()).data.session;
    if (!ses) { pantallaLogin(); return; }
    var ok = await sb.rpc("es_autorizado");
    if (ok.error || ok.data !== true) {
      $app.innerHTML = '<div class="login card"><h1>Sin acceso</h1><p>Este usuario (' + esc(ses.user.email) + ') todavía no está autorizado. Pedile a quien administra el panel que lo habilite.</p><div class="actions"><button class="btn" data-act="salir">Salir</button></div></div>';
      return;
    }
    S.user = ses.user; S.cat = null;
    marco(); await vista();
  }
  // SIGNED_IN también se emite al volver a la pestaña: solo se reinicia la pantalla si todavía no hay usuario cargado.
  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "SIGNED_IN" && !S.user) setTimeout(iniciar, 0);
    if (ev === "SIGNED_OUT") { S.user = null; pantallaLogin(); }
  });

  function marco() {
    $app.innerHTML = '<header class="top"><h1>Panel de gestión</h1><span class="sub">' + esc(S.user.email) + ' · <a href="#" data-act="salir">Salir</a></span></header>' +
      '<nav class="tabs" id="tabs"></nav><div id="vista"></div>';
    pintarTabs();
  }
  function pintarTabs() {
    $("#tabs").innerHTML = TABS.map(function (t) { return '<button data-act="tab" data-k="' + t[0] + '" aria-selected="' + (t[0] === S.tab) + '">' + t[1] + "</button>"; }).join("");
  }
  async function vista() {
    var v = $("#vista"); if (!v) return;
    v.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      var fn = { semana: vSemana, partes: vPartes, cot: vCot, adel: vAdel, mem: vMem }[S.tab];
      v.innerHTML = await fn();
      if (S.tab === "partes") refrescarParte();
      if (S.tab === "cot" && S.nuevaCot) refrescarTotalesCot();
    } catch (e) { v.innerHTML = '<div class="banner bad">No pude cargar: ' + esc(msg(e)) + "</div>"; }
  }

  /* catálogo: personal con tarifas, obras activas, recargos */
  async function catalogo(forzar) {
    if (S.cat && !forzar) return S.cat;
    var r = await Promise.all([
      q(sb.from("personal").select("id,nombre,tarifas(especialidad_id,tarifa_hora,desde,especialidades(nombre))").eq("activo", true).order("nombre")),
      q(sb.from("obras").select("id,nombre").eq("estado", "activa").order("nombre")),
      q(sb.from("recargos").select("tipo,porcentaje")),
    ]);
    S.cat = { personal: r[0], obras: r[1], recargos: r[2] };
    return S.cat;
  }
  function espsDe(persona, fecha) {
    var por = {};
    (persona.tarifas || []).filter(function (t) { return t.desde <= fecha; }).sort(function (a, b) { return a.desde < b.desde ? -1 : 1; }).forEach(function (t) {
      por[t.especialidad_id] = { id: t.especialidad_id, nombre: (t.especialidades || {}).nombre, tarifa: Number(t.tarifa_hora) };
    });
    return Object.keys(por).map(function (k) { return por[k]; });
  }

  /* ---------- SEMANA ---------- */
  async function vSemana() {
    var lunes = S.lunes, fin = addDays(lunes, 6);
    var r = await Promise.all([q(sb.rpc("liquidar_semana", { p_lunes: lunes })), q(sb.from("pagos").select("id,fecha,detalle,total_bruto,total_adelantos,total_neto").eq("semana_desde", lunes).maybeSingle())]);
    var pago = r[1], filas = pago ? pago.detalle : r[0];
    var tot = function (k) { return r2(filas.reduce(function (a, x) { return a + Number(x[k]); }, 0)); };
    var cuerpo = filas.map(function (x) {
      return "<tr><td><b>" + esc(x.nombre) + '</b></td><td class="n">' + Number(x.horas) + '</td><td class="n">' + money(x.bruto) + '</td><td class="n ' + (x.adelantos > 0 ? "neg" : "") + '">' + (Number(x.adelantos) ? "- " + money(x.adelantos) : "—") +
        '</td><td class="n"><b>' + money(x.neto) + '</b></td><td class="n">' + (pago ? '<button class="btn small" data-act="recibo" data-pago="' + pago.id + '" data-per="' + x.personal_id + '">Comprobante</button>' : "") + "</td></tr>";
    }).join("");
    return '<section class="card"><h2>Liquidación semanal</h2><div class="row"><button class="btn" data-act="sem-prev" aria-label="Semana anterior">←</button>' +
      '<label class="f sm"><span>Semana (lun a dom)</span><input id="sem-fecha" type="date" value="' + lunes + '"></label><button class="btn" data-act="sem-next" aria-label="Semana siguiente">→</button>' +
      '<span class="sub">' + fdate(lunes) + " al " + fdate(fin) + "</span>" + (pago ? '<span class="pill ok">Pagada el ' + fdate(pago.fecha) + "</span>" : "") + "</div>" +
      (filas.length ? '<div class="scroll" style="margin-top:10px"><table><thead><tr><th>Persona</th><th class="n">Horas</th><th class="n">Bruto</th><th class="n">Adelantos abiertos</th><th class="n">Neto</th><th></th></tr></thead><tbody>' + cuerpo +
        '</tbody><tfoot><tr><td><b>Total caja</b></td><td></td><td class="n"><b>' + money(tot("bruto")) + '</b></td><td class="n">' + (tot("adelantos") ? "- " + money(tot("adelantos")) : "—") + '</td><td class="n"><b>' + money(tot("neto")) + "</b></td><td></td></tr></tfoot></table></div>"
        : '<p class="muted" style="margin-top:10px">No hay partes ni adelantos abiertos en esta semana.</p>') +
      (pago ? "" : '<div class="actions"><button class="btn primary" data-act="sem-cerrar"' + (filas.length ? "" : " disabled") + ">Cerrar semana y marcar pagada</button></div>" +
        '<p class="help">Al cerrar, los adelantos abiertos incluidos pasan a "saldado" y no se vuelven a descontar.</p>') +
      '<p class="help">Liquidación de jornales por hora: no incluye cargas sociales, aguinaldo ni vacaciones y no reemplaza el recibo de sueldo legal.</p>' + linkPdf() + "</section>";
  }

  /* ---------- PARTES ---------- */
  async function vPartes() {
    var cat = await catalogo(true);
    var partes = await q(sb.from("partes").select("id,fecha,horas,tarifa_aplicada,recargo_pct,tipo_jornada,personal(nombre),obras(nombre),especialidades(nombre)").eq("anulado", false).gte("fecha", addDays(today(), -14)).order("fecha", { ascending: false }).order("creado_en", { ascending: false }));
    var filas = partes.map(function (p) {
      return "<tr><td>" + fdate(p.fecha) + "</td><td>" + esc((p.personal || {}).nombre) + "</td><td>" + esc((p.obras || {}).nombre) + "</td><td>" + esc((p.especialidades || {}).nombre) + (p.tipo_jornada !== "normal" ? ' <span class="pill warn">' + esc(p.tipo_jornada) + " +" + Number(p.recargo_pct) + "%</span>" : "") +
        '</td><td class="n">' + Number(p.horas) + '</td><td class="n">' + money(p.horas * p.tarifa_aplicada * (1 + p.recargo_pct / 100)) + '</td><td class="n"><button class="btn small danger" data-act="anular" data-id="' + p.id + '">Anular</button></td></tr>';
    }).join("");
    return '<section class="card"><h2>Cargar parte</h2><form id="f-parte"><div class="row">' +
      '<label class="f sm"><span>Fecha</span><input id="pa-fecha" type="date" value="' + today() + '" required></label>' +
      '<label class="f"><span>Persona</span><select id="pa-per">' + cat.personal.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f"><span>Obra</span><select id="pa-obra">' + cat.obras.map(function (o) { return '<option value="' + o.id + '">' + esc(o.nombre) + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="row" style="margin-top:10px"><label class="f"><span>Especialidad con la que se imputa</span><select id="pa-esp"></select></label>' +
      '<label class="f sm"><span>Horas</span><input id="pa-hs" type="number" step="0.5" min="0.5" max="24" required></label>' +
      '<label class="f"><span>Tipo de jornada</span><select id="pa-tipo">' + TIPOS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="f" style="margin-top:10px"><span>Observaciones (opcional)</span><input id="pa-obs"></label><p id="pa-info" class="help"></p>' +
      '<div class="actions"><button class="btn primary" type="submit">Cargar parte</button></div></form></section>' +
      '<section class="card"><h2>Últimos 14 días</h2>' + (filas ? '<div class="scroll"><table><thead><tr><th>Fecha</th><th>Persona</th><th>Obra</th><th>Especialidad</th><th class="n">Hs</th><th class="n">Costo</th><th></th></tr></thead><tbody>' + filas + "</tbody></table></div>" : '<p class="muted">Sin partes en los últimos 14 días.</p>') + "</section>";
  }
  function refrescarParte() {
    if (!$("#f-parte") || !S.cat) return;
    var per = S.cat.personal.filter(function (p) { return p.id === $("#pa-per").value; })[0], fecha = $("#pa-fecha").value || today();
    var esps = per ? espsDe(per, fecha) : [], sel = $("#pa-esp"), prev = sel.value;
    sel.innerHTML = (esps.length === 1 ? "" : '<option value="">Elegí con cuál</option>') + esps.map(function (e) { return '<option value="' + e.id + '">' + esc(e.nombre) + "</option>"; }).join("");
    if (esps.some(function (e) { return e.id === prev; })) sel.value = prev;
    var tipo = $("#pa-tipo").value, rec = Number((S.cat.recargos.filter(function (r) { return r.tipo === tipo; })[0] || {}).porcentaje || 0);
    var esp = esps.filter(function (e) { return e.id === sel.value; })[0], hs = num($("#pa-hs").value);
    var t = esp ? "Tarifa: " + money(esp.tarifa) + " por hora" + (rec ? " · recargo " + rec + "%" : "") + (hs ? " · costo " + money(hs * esp.tarifa * (1 + rec / 100)) : "") + "." : (esps.length ? "Elegí la especialidad para ver la tarifa." : "Esta persona no tiene tarifa vigente para esa fecha.");
    if (tipo !== "normal" && !rec) t += " ⚠ El recargo de este tipo no está configurado: se carga sin recargo.";
    $("#pa-info").textContent = t;
  }

  /* ---------- COTIZACIONES ---------- */
  function itemsHtml() {
    return S.itemsCot.map(function (it, i) {
      return '<div class="item"><select data-f="tipo" data-i="' + i + '" aria-label="Tipo"><option value="mo"' + (it.tipo === "mo" ? " selected" : "") + '>Mano de obra</option><option value="mat"' + (it.tipo === "mat" ? " selected" : "") + '>Material</option><option value="gar"' + (it.tipo === "gar" ? " selected" : "") + ">Garantía (sin costo)</option></select>" +
        '<input data-f="descripcion" data-i="' + i + '" value="' + esc(it.descripcion) + '" placeholder="Descripción"><input data-f="cantidad" data-i="' + i + '" type="number" step="any" min="0" value="' + it.cantidad + '">' +
        '<input data-f="precio_unitario" data-i="' + i + '" type="number" step="any" min="0" value="' + (it.tipo === "gar" ? 0 : it.precio_unitario) + '"' + (it.tipo === "gar" ? " disabled" : "") + '><button class="btn small danger" data-act="item-del" data-i="' + i + '" aria-label="Quitar">×</button></div>';
    }).join("");
  }
  async function vCot() {
    var r = await Promise.all([
      q(sb.from("cotizaciones").select("id,numero,tipo,fecha,estado,descripcion,discrimina_iva,iva_pct,clientes(nombre)").order("fecha", { ascending: false }).order("numero", { ascending: false }).limit(300)),
      q(sb.from("cotizacion_items").select("cotizacion_id,tipo,cantidad,precio_unitario").limit(5000)),
      S.nuevaCot ? q(sb.from("clientes").select("nombre").order("nombre")) : Promise.resolve([]),
    ]);
    var cots = r[0], items = r[1];
    var filas = cots.map(function (c) {
      var t = totales(c, items.filter(function (i) { return i.cotizacion_id === c.id; }));
      return "<tr><td>" + esc(c.numero) + "</td><td>" + fdate(c.fecha) + "</td><td>" + esc((c.clientes || {}).nombre || "—") + (c.tipo === "trabajo" ? ' <span class="pill">trabajo realizado</span>' : "") + '<br><span class="muted small">' + esc(String(c.descripcion || "").slice(0, 90)) + '</span></td><td><span class="pill ' + (c.estado === "enviada" || c.estado === "emitida" ? "ok" : "warn") + '">' + esc(c.estado) + '</span></td><td class="n">' + money(t.total) + '</td><td class="n"><button class="btn small" data-act="pdf-cot" data-id="' + c.id + '">PDF</button></td></tr>';
    }).join("");
    var form = "";
    if (S.nuevaCot) {
      form = '<section class="card"><h2>Nueva cotización</h2><form id="f-cot"><div class="row"><label class="f"><span>Documento</span><select id="ct-tipo"><option value="cotizacion">Cotización</option><option value="trabajo">Trabajo realizado</option></select></label>' +
        '<label class="f"><span>Cliente</span><input id="ct-cliente" list="dl-cli" required autocomplete="off"></label><datalist id="dl-cli">' + r[2].map(function (c) { return '<option value="' + esc(c.nombre) + '">'; }).join("") + "</datalist>" +
        '<label class="f"><span>Obra o dirección</span><input id="ct-obra"></label><label class="f sm"><span>Validez (días)</span><input id="ct-validez" type="number" min="0" value="7"></label></div>' +
        '<label class="f" style="margin-top:10px"><span>Trabajo a realizar</span><textarea id="ct-desc"></textarea></label><h3 style="margin-top:12px">Ítems</h3><div id="ct-items">' + itemsHtml() + "</div>" +
        '<div class="actions" style="margin-top:6px"><button type="button" class="btn small" data-act="item-add">+ Ítem</button></div>' +
        '<div class="row" style="margin-top:12px"><label class="chk"><input id="ct-detalle" type="checkbox"> Mostrar cada ítem (si no, solo "Mano de obra" y "Materiales")</label><label class="chk"><input id="ct-iva" type="checkbox"> Discriminar IVA</label>' +
        '<label class="f sm"><span>IVA %</span><input id="ct-ivapct" type="number" step="any" value="21"></label><label class="chk"><input id="ct-transf" type="checkbox" checked> Mostrar datos de transferencia</label></div>' +
        '<label class="f" style="margin-top:10px"><span>Notas</span><textarea id="ct-notas"></textarea></label><div id="ct-totales" class="totals"></div>' +
        '<div class="actions"><button class="btn primary" type="submit">Guardar y generar PDF</button><button type="button" class="btn" data-act="cot-cancel">Cancelar</button></div></form></section>';
    }
    return (S.nuevaCot ? form : '<div class="actions" style="margin:0 0 12px"><button class="btn primary" data-act="cot-nueva">+ Nueva cotización</button></div>') + linkPdf() +
      '<section class="card"><h2>Cotizaciones</h2>' + (filas ? '<div class="scroll"><table><thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th class="n">Total</th><th></th></tr></thead><tbody>' + filas + "</tbody></table></div>" : '<p class="muted">Todavía no hay cotizaciones.</p>') + "</section>";
  }
  function leerItems() {
    document.querySelectorAll("#ct-items [data-f]").forEach(function (el) {
      var it = S.itemsCot[+el.dataset.i], f = el.dataset.f;
      it[f] = (f === "cantidad" || f === "precio_unitario") ? num(el.value) : el.value;
    });
  }
  function refrescarTotalesCot() {
    if (!$("#ct-totales")) return;
    leerItems();
    var t = totales({ discrimina_iva: $("#ct-iva").checked, iva_pct: num($("#ct-ivapct").value) }, S.itemsCot);
    $("#ct-totales").innerHTML = "<div><span>Mano de obra</span><span>" + money(t.mo) + "</span></div><div><span>Materiales</span><span>" + money(t.mat) + "</span></div>" +
      ($("#ct-iva").checked ? "<div><span>IVA</span><span>" + money(t.iva) + "</span></div>" : "") + '<div class="big"><span>Total</span><span>' + money(t.total) + "</span></div>";
  }
  async function guardarCot() {
    leerItems();
    var cliente = $("#ct-cliente").value.trim(), items = S.itemsCot.filter(function (i) { return i.descripcion.trim(); });
    if (!cliente) return toast("Falta el cliente.");
    if (!items.length) return toast("Cargá al menos un ítem con descripción.");
    var tipo = $("#ct-tipo").value;
    var clis = await q(sb.from("clientes").select("id,nombre")), cli = clis.filter(function (c) { return norm(c.nombre) === norm(cliente); })[0];
    if (!cli) cli = await q(sb.from("clientes").insert({ nombre: cliente }).select("id").single());
    var numero = await q(sb.rpc("siguiente_numero", { p_tipo: tipo }));
    var cot = await q(sb.from("cotizaciones").insert({ numero: numero, tipo: tipo, cliente_id: cli.id, obra_texto: $("#ct-obra").value.trim() || null, descripcion: $("#ct-desc").value.trim() || null,
      detalle: $("#ct-detalle").checked, discrimina_iva: $("#ct-iva").checked, iva_pct: num($("#ct-ivapct").value) || 21, validez_dias: Math.round(num($("#ct-validez").value)),
      transferencia: $("#ct-transf").checked, notas: $("#ct-notas").value.trim() || null, estado: "emitida" }).select("id,numero").single());
    await q(sb.from("cotizacion_items").insert(items.map(function (i) { return { cotizacion_id: cot.id, tipo: i.tipo, descripcion: i.descripcion.trim(), cantidad: i.cantidad || 1, precio_unitario: i.tipo === "gar" ? 0 : i.precio_unitario }; })));
    S.nuevaCot = false; S.itemsCot = [];
    toast("Guardada como " + cot.numero + ".");
    await generarPdf({ tipo: "cotizacion", id: cot.id }, "Cotización " + cot.numero);
  }

  /* ---------- PDF ---------- */
  function linkPdf() { return S.pdfLink ? '<div class="result">' + esc(S.pdfLink.titulo) + ': <a href="' + esc(S.pdfLink.url) + '" target="_blank" rel="noopener">Abrir PDF</a> <span class="small">(el link vale 1 hora)</span></div>' : ""; }
  async function generarPdf(body, titulo) {
    toast("Generando PDF…");
    var ses = (await sb.auth.getSession()).data.session;
    var r = await fetch(CFG.SUPABASE_URL + "/functions/v1/pdf", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + ses.access_token, apikey: CFG.SUPABASE_KEY }, body: JSON.stringify(body) });
    var j = await r.json().catch(function () { return {}; });
    if (!j.url) throw new Error(j.error || "No se pudo generar el PDF (" + r.status + ")");
    S.pdfLink = { url: j.url, titulo: titulo };
    await vista();
  }

  /* ---------- ADELANTOS ---------- */
  async function vAdel() {
    var r = await Promise.all([catalogo(true), q(sb.from("adelantos").select("id,fecha,monto,nota,estado,personal(nombre)").order("fecha", { ascending: false }).limit(60))]);
    var cat = r[0], filas = r[1].map(function (a) {
      return "<tr><td>" + fdate(a.fecha) + "</td><td>" + esc((a.personal || {}).nombre) + '</td><td class="n">' + money(a.monto) + "</td><td>" + esc(a.nota || "") + '</td><td><span class="pill ' + (a.estado === "abierto" ? "warn" : "ok") + '">' + esc(a.estado) + "</span></td></tr>";
    }).join("");
    return '<section class="card"><h2>Registrar adelanto</h2><form id="f-adel"><div class="row"><label class="f"><span>Persona</span><select id="ad-per">' + cat.personal.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f sm"><span>Monto</span><input id="ad-monto" type="number" step="any" min="1" required></label><label class="f sm"><span>Fecha</span><input id="ad-fecha" type="date" value="' + today() + '" required></label>' +
      '<label class="f"><span>Nota</span><input id="ad-nota"></label><button class="btn primary" type="submit">Registrar</button></div></form></section><section class="card"><h2>Últimos adelantos</h2>' +
      (filas ? '<div class="scroll"><table><thead><tr><th>Fecha</th><th>Persona</th><th class="n">Monto</th><th>Nota</th><th>Estado</th></tr></thead><tbody>' + filas + "</tbody></table></div>" : '<p class="muted">Sin adelantos.</p>') + "</section>";
  }

  /* ---------- MEMORIA ---------- */
  async function vMem() {
    return '<section class="card"><h2>Buscar en la memoria</h2><form id="f-mem"><div class="row"><label class="f"><span>¿Qué querés recordar?</span><input id="me-q" placeholder="Ej: adelantos, forma de cotizar, cuota del estudio"></label><button class="btn primary" type="submit">Buscar</button></div></form><div id="me-res"></div></section>' +
      '<section class="card"><h2>Anotar algo para recordar</h2><form id="f-nota"><label class="f"><span>Título</span><input id="no-t" required></label><label class="f" style="margin-top:10px"><span>Contenido</span><textarea id="no-c" required></textarea></label>' +
      '<div class="actions"><button class="btn primary" type="submit">Guardar nota</button></div></form></section>';
  }
  async function buscarMem(texto) {
    var rows = await q(sb.rpc("buscar_memoria", { p_consulta: texto, p_limite: 12 }));
    var tag = { memoria: "Nota", historial: "Conversación", chat_reciente: "Chat reciente" };
    $("#me-res").innerHTML = rows.length ? rows.map(function (m) { return '<div class="mem"><span class="pill">' + esc(tag[m.origen] || m.origen) + "</span> <b>" + esc(m.titulo) + '</b><div class="small" style="white-space:pre-wrap;margin-top:4px">' + esc(m.fragmento) + "</div></div>"; }).join("") : '<p class="muted">No encontré nada sobre eso.</p>';
  }

  /* ---------- eventos ---------- */
  document.addEventListener("click", async function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var a = b.dataset.act;
    try {
      if (a === "salir") { e.preventDefault(); await sb.auth.signOut(); }
      else if (a === "tab") { S.tab = b.dataset.k; S.pdfLink = null; pintarTabs(); await vista(); }
      else if (a === "sem-prev") { S.lunes = addDays(S.lunes, -7); S.pdfLink = null; await vista(); }
      else if (a === "sem-next") { S.lunes = addDays(S.lunes, 7); S.pdfLink = null; await vista(); }
      else if (a === "sem-cerrar") twice(b, async function () { try { await q(sb.rpc("cerrar_semana", { p_lunes: S.lunes })); toast("Semana cerrada y adelantos saldados."); await vista(); } catch (er) { toast("No se pudo cerrar: " + msg(er)); } });
      else if (a === "recibo") await generarPdf({ tipo: "recibo", pago_id: b.dataset.pago, personal_id: b.dataset.per }, "Comprobante de pago");
      else if (a === "anular") twice(b, async function () { try { await q(sb.rpc("anular_parte", { p_id: b.dataset.id })); toast("Parte anulado."); await vista(); } catch (er) { toast("No se pudo anular: " + msg(er)); } });
      else if (a === "cot-nueva") { S.nuevaCot = true; S.itemsCot = [{ tipo: "mo", descripcion: "", cantidad: 1, precio_unitario: 0 }]; await vista(); }
      else if (a === "cot-cancel") { S.nuevaCot = false; await vista(); }
      else if (a === "item-add") { leerItems(); S.itemsCot.push({ tipo: "mo", descripcion: "", cantidad: 1, precio_unitario: 0 }); $("#ct-items").innerHTML = itemsHtml(); refrescarTotalesCot(); }
      else if (a === "item-del") { leerItems(); S.itemsCot.splice(+b.dataset.i, 1); if (!S.itemsCot.length) S.itemsCot.push({ tipo: "mo", descripcion: "", cantidad: 1, precio_unitario: 0 }); $("#ct-items").innerHTML = itemsHtml(); refrescarTotalesCot(); }
      else if (a === "pdf-cot") await generarPdf({ tipo: "cotizacion", id: b.dataset.id }, "Cotización");
    } catch (er) { toast("Error: " + msg(er)); }
  });
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (S.tab === "partes" && el.closest("#f-parte")) refrescarParte();
    if (S.tab === "cot" && (el.closest("#ct-items") || /^ct-(iva|ivapct)$/.test(el.id))) refrescarTotalesCot();
  });
  document.addEventListener("change", async function (e) {
    var el = e.target;
    if (el.id === "sem-fecha" && el.value) { S.lunes = lunesDe(el.value); S.pdfLink = null; await vista(); }
    if (el.dataset && el.dataset.f === "tipo" && S.tab === "cot") { leerItems(); if (S.itemsCot[+el.dataset.i].tipo === "gar") S.itemsCot[+el.dataset.i].precio_unitario = 0; $("#ct-items").innerHTML = itemsHtml(); refrescarTotalesCot(); }
  });
  document.addEventListener("submit", async function (e) {
    e.preventDefault(); var f = e.target;
    try {
      if (f.id === "f-login") {
        var em = $("#lg-email").value.trim(); await pedirLink(em);
        pantallaLogin({ texto: "Listo: si ese email está autorizado, te llegó un link. Abrilo desde este mismo dispositivo." });
      } else if (f.id === "f-parte") {
        var esp = $("#pa-esp").value; if (!esp) return toast("Elegí con qué especialidad se imputa.");
        await q(sb.rpc("cargar_parte", { p_fecha: $("#pa-fecha").value, p_personal: $("#pa-per").value, p_obra: $("#pa-obra").value, p_esp: esp, p_horas: num($("#pa-hs").value), p_tipo: $("#pa-tipo").value, p_obs: $("#pa-obs").value.trim() || null }));
        toast("Parte cargado."); await vista();
      } else if (f.id === "f-cot") { await guardarCot(); }
      else if (f.id === "f-adel") {
        await q(sb.from("adelantos").insert({ fecha: $("#ad-fecha").value, personal_id: $("#ad-per").value, monto: num($("#ad-monto").value), nota: $("#ad-nota").value.trim() || null }));
        toast("Adelanto registrado."); await vista();
      } else if (f.id === "f-mem") { await buscarMem($("#me-q").value.trim()); }
      else if (f.id === "f-nota") {
        await q(sb.from("memoria").insert({ titulo: $("#no-t").value.trim(), contenido: $("#no-c").value.trim(), fuente: "panel" }));
        toast("Nota guardada."); f.reset();
      }
    } catch (er) { toast("Error: " + msg(er)); }
  });

  iniciar().catch(function (e) { $app.innerHTML = '<div class="banner bad">Error al iniciar: ' + esc(msg(e)) + "</div>"; });
})();
