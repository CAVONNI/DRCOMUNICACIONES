/* ============================================================
   DMR COMUNICACIONES - usuarios.js
   Módulo "Usuarios" (SOLO ADMINISTRADOR).

   - usuarios.html:       lista de usuarios con su resumen.
   - perfilusuario.html:  perfil de un usuario: movimientos, pagos
                          que registró, ingresos por mes, detalle
                          de cada registro y descarga en Excel/PDF.

   Depende de funciones.js (db, rolUsuarioActual, escaparHTML,
   formatearMoneda, obtenerParametroURL, registrarActividad).
   funciones.js llama a inicializarModuloUsuarios() al arrancar.

   ¿A quién se le atribuye un pago?
   1) Pagos nuevos: campo "registradoPor" (correo de quien lo guardó).
   2) Pagos anteriores: se busca en la colección "actividad" el
      movimiento "Registró pago" con el mismo cliente, mes y valor.
   3) Si no hay forma de saberlo, queda como "sin responsable".
============================================================ */
(function () {
    "use strict";

    var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    var datos = null; // { lista, sinAsignar }
    var estado = { usuario: null, periodo: "", accion: "", pagosVista: [], movsVista: [] };

    // ---------- utilidades ----------
    function dosDigitos(n) { return n < 10 ? "0" + n : "" + n; }
    function mesDeFecha(f) { return f.getFullYear() + "-" + dosDigitos(f.getMonth() + 1); }
    function mesActual() { return mesDeFecha(new Date()); }
    function nombreMes(ym) {
        var m = /^(\d{4})-(\d{2})$/.exec(ym || "");
        if (!m) return ym || "Sin fecha";
        return MESES[Number(m[2]) - 1] + " " + m[1];
    }
    function fechaDe(a) { return a && a.fecha && a.fecha.toDate ? a.fecha.toDate() : null; }
    function textoFecha(a) { var f = fechaDe(a); return f ? f.toLocaleString("es-CO") : "-"; }
    function textoRegistro(ts) { return ts && ts.toDate ? ts.toDate().toLocaleString("es-CO") : "-"; }
    function mesDeMov(a) { var f = fechaDe(a); return f ? mesDeFecha(f) : ""; }
    function mesDePago(p) { return (p.fechaPago || "").slice(0, 7); }
    function sumar(pagos) { return pagos.reduce(function (t, p) { return t + p.valorPagado; }, 0); }
    function nombreVisible(u) { return u.nombre || u.email || ("UID " + u.uid); }
    function slug(t) { return String(t || "usuario").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "usuario"; }
    function llavePago(p) { return (p.clienteNombre || "") + " - " + (p.mes || "") + " - " + formatearMoneda(p.valorPagado); }
    function etiquetaPeriodo() { return estado.periodo === "todo" ? "Todo el historial" : nombreMes(estado.periodo); }

    // ---------- carga y armado de datos ----------
    function cargarDatos() {
        if (datos) return Promise.resolve(datos);
        return Promise.all([
            db.collection("actividad").orderBy("fecha", "desc").limit(3000).get(),
            db.collectionGroup("pagos").get(),
            db.collection("usuarios").get()
        ]).then(function (r) {
            var actividad = [], pagos = [], docs = [];
            r[0].forEach(function (d) { var a = d.data(); a._id = d.id; actividad.push(a); });
            r[1].forEach(function (d) {
                var p = d.data();
                p._id = d.id;
                p.clienteId = p.clienteId || (d.ref && d.ref.parent && d.ref.parent.parent ? d.ref.parent.parent.id : "");
                p.valorPagado = Number(p.valorPagado) || 0;
                pagos.push(p);
            });
            r[2].forEach(function (d) { var u = d.data(); u._uid = d.id; docs.push(u); });
            datos = construir(actividad, pagos, docs);
            return datos;
        });
    }

    function construir(actividad, pagos, docs) {
        var uidAEmail = {}, mapaPago = {}, usuarios = {}, sinAsignar = [], i;

        actividad.forEach(function (a) {
            var e = (a.usuario || "").toLowerCase();
            if (a.uid && e && e !== "desconocido") uidAEmail[a.uid] = e;
        });
        // del más antiguo al más reciente: se conserva el primer "Registró pago"
        for (i = actividad.length - 1; i >= 0; i--) {
            var a0 = actividad[i];
            if (a0.accion === "Registró pago" && a0.detalle && !mapaPago[a0.detalle]) {
                mapaPago[a0.detalle] = (a0.usuario || "").toLowerCase();
            }
        }

        function obtener(clave) {
            if (!usuarios[clave]) usuarios[clave] = { clave: clave, email: "", uid: "", nombre: "", rol: "", movimientos: [], pagos: [] };
            return usuarios[clave];
        }

        docs.forEach(function (d) {
            var email = (d.correo || "").toLowerCase() || uidAEmail[d._uid] || "";
            var u = obtener(email || ("uid:" + d._uid));
            u.email = email;
            u.uid = d._uid;
            u.nombre = d.nombre || "";
            u.rol = d.rol || "empleado";
        });
        actividad.forEach(function (a) {
            var e = (a.usuario || "desconocido").toLowerCase();
            var u = obtener(e);
            u.email = e;
            if (a.uid && !u.uid) u.uid = a.uid;
            u.movimientos.push(a);
        });
        pagos.forEach(function (p) {
            var directo = (p.registradoPor || "").toLowerCase();
            var clave = directo || mapaPago[llavePago(p)] || "";
            if (clave) {
                p._origen = directo ? "Registrado con el usuario" : "Deducido del registro de actividad";
                obtener(clave).pagos.push(p);
            } else {
                sinAsignar.push(p);
            }
        });

        var lista = Object.keys(usuarios).map(function (k) { return usuarios[k]; });
        lista.sort(function (a, b) { return nombreVisible(a).toLowerCase().localeCompare(nombreVisible(b).toLowerCase()); });
        return { lista: lista, sinAsignar: sinAsignar };
    }

    function resumen(u) {
        var ma = mesActual();
        var r = { mesTotal: 0, mesPagos: 0, total: 0, pagos: u.pagos.length, movs: u.movimientos.length, ultimo: u.movimientos[0] || null };
        u.pagos.forEach(function (p) {
            r.total += p.valorPagado;
            if (mesDePago(p) === ma) { r.mesTotal += p.valorPagado; r.mesPagos++; }
        });
        return r;
    }

    // ---------- modal de detalle ----------
    function abrirModal(titulo, filas, accionesHtml) {
        var modal = document.getElementById("puModal");
        if (!modal) return;
        document.getElementById("puModalTitulo").textContent = titulo;
        document.getElementById("puModalContenido").innerHTML = filas.map(function (f) {
            return '<div class="comprobante-fila"><span>' + escaparHTML(f[0]) + ':</span> <strong style="text-align:right; word-break:break-word;">' + escaparHTML(f[1] === "" || f[1] == null ? "-" : f[1]) + "</strong></div>";
        }).join("");
        document.getElementById("puModalAcciones").innerHTML = (accionesHtml || "") + '<button class="btn-secondary" type="button" id="puModalCerrar">Cerrar</button>';
        document.getElementById("puModalCerrar").addEventListener("click", cerrarModal);
        modal.style.display = "flex";
    }
    function cerrarModal() { var m = document.getElementById("puModal"); if (m) m.style.display = "none"; }

    function detallePago(p) {
        abrirModal("Detalle del pago", [
            ["Cliente", p.clienteNombre || "N/A"],
            ["Mes pagado", p.mes],
            ["Valor pagado", formatearMoneda(p.valorPagado)],
            ["Fecha de pago", p.fechaPago],
            ["Método de pago", p.metodoPago],
            ["Observaciones", p.observaciones],
            ["Registrado por", p.registradoPor || estado.usuario.email],
            ["Cómo se identificó al usuario", p._origen],
            ["Registrado el", textoRegistro(p.registradoEn)],
            ["Editado por", p.editadoPor],
            ["Editado el", textoRegistro(p.editadoEn)]
        ], p.clienteId ? '<a class="btn-secondary" style="text-decoration:none;" href="perfilciente.html?id=' + encodeURIComponent(p.clienteId) + '">Ver cliente</a>' : "");
    }
    function detalleMov(a) {
        abrirModal("Detalle del movimiento", [
            ["Usuario", a.usuario],
            ["Acción", a.accion],
            ["Detalle", a.detalle],
            ["Fecha y hora", textoFecha(a)],
            ["UID del usuario", a.uid],
            ["ID del registro", a._id]
        ]);
    }

    // ============================================================
    // LISTA DE USUARIOS
    // ============================================================
    function iniciarLista() {
        document.getElementById("buscarUsuario").addEventListener("input", pintarLista);
        pintarLista();
        var nota = document.getElementById("usuariosNota");
        if (nota && datos.sinAsignar.length) {
            nota.textContent = datos.sinAsignar.length + " pago(s) por " + formatearMoneda(sumar(datos.sinAsignar)) +
                " no se pueden atribuir a un usuario (son anteriores al registro de actividad).";
            nota.style.display = "";
        }
    }
    function pintarLista() {
        var tbody = document.getElementById("tablaUsuariosBody");
        var texto = (document.getElementById("buscarUsuario").value || "").toLowerCase();
        var lista = datos.lista.filter(function (u) {
            return (u.email + " " + u.nombre + " " + u.uid).toLowerCase().indexOf(texto) !== -1;
        });
        if (!lista.length) { tbody.innerHTML = '<tr><td colspan="8">No se encontraron usuarios</td></tr>'; return; }
        tbody.innerHTML = lista.map(function (u) {
            var r = resumen(u);
            var rol = u.rol || "-";
            var claseRol = rol === "administrador" ? "active" : "pending";
            return "<tr>" +
                "<td><strong>" + escaparHTML(nombreVisible(u)) + "</strong>" +
                    (u.nombre && u.email ? '<br><span style="font-size:12px;color:gray;">' + escaparHTML(u.email) + "</span>" : "") + "</td>" +
                '<td><span class="status-badge ' + claseRol + '">' + escaparHTML(rol) + "</span></td>" +
                "<td>" + r.movs + "</td>" +
                "<td>" + r.mesPagos + "</td>" +
                "<td>" + formatearMoneda(r.mesTotal) + "</td>" +
                "<td>" + formatearMoneda(r.total) + "</td>" +
                "<td>" + escaparHTML(r.ultimo ? textoFecha(r.ultimo) : "Sin actividad") + "</td>" +
                '<td><button class="btn-action-sm" onclick="location.href=\'perfilusuario.html?u=' + encodeURIComponent(u.clave) + '\'">Ver perfil</button></td>' +
                "</tr>";
        }).join("");
    }

    // ============================================================
    // PERFIL DE USUARIO
    // ============================================================
    function iniciarPerfil() {
        var clave = obtenerParametroURL("u");
        var u = datos.lista.filter(function (x) { return x.clave === clave; })[0];
        if (!clave || !u) {
            document.getElementById("puTitulo").textContent = "Usuario no encontrado";
            document.getElementById("puTablaMovs").innerHTML = '<tr><td colspan="4">No se encontró el usuario. <a href="usuarios.html">Volver a la lista</a></td></tr>';
            return;
        }
        estado.usuario = u;
        estado.periodo = mesActual();

        document.getElementById("puTitulo").textContent = nombreVisible(u);
        document.getElementById("puSub").textContent = (u.email || ("UID " + u.uid)) + " · Rol: " + (u.rol || "sin definir");

        var r = resumen(u);
        document.getElementById("puMes").textContent = formatearMoneda(r.mesTotal);
        document.getElementById("puPagosMes").textContent = r.mesPagos;
        document.getElementById("puTotal").textContent = formatearMoneda(r.total);
        document.getElementById("puMovs").textContent = r.movs;

        // selector de periodo
        var meses = {};
        meses[mesActual()] = true;
        u.pagos.forEach(function (p) { if (mesDePago(p)) meses[mesDePago(p)] = true; });
        u.movimientos.forEach(function (a) { if (mesDeMov(a)) meses[mesDeMov(a)] = true; });
        var orden = Object.keys(meses).sort().reverse();
        var selPeriodo = document.getElementById("puPeriodo");
        selPeriodo.innerHTML = '<option value="todo">Todo el historial</option>' +
            orden.map(function (m) { return '<option value="' + m + '">' + escaparHTML(nombreMes(m)) + (m === mesActual() ? " (este mes)" : "") + "</option>"; }).join("");
        selPeriodo.value = estado.periodo;
        selPeriodo.addEventListener("change", function () { estado.periodo = selPeriodo.value; pintarPerfil(); });

        // filtro por acción
        var acciones = {};
        u.movimientos.forEach(function (a) { acciones[a.accion || "Sin acción"] = true; });
        var selAccion = document.getElementById("puFiltroAccion");
        selAccion.innerHTML = '<option value="">Todas las acciones</option>' +
            Object.keys(acciones).sort().map(function (x) { return '<option value="' + escaparHTML(x) + '">' + escaparHTML(x) + "</option>"; }).join("");
        selAccion.addEventListener("change", function () { estado.accion = selAccion.value; pintarPerfil(); });

        // delegación de clics en "Ver detalle" y en los meses
        document.getElementById("puTablaPagos").addEventListener("click", function (e) {
            var b = e.target.closest("button[data-i]");
            if (b) detallePago(estado.pagosVista[Number(b.getAttribute("data-i"))]);
        });
        document.getElementById("puTablaMovs").addEventListener("click", function (e) {
            var b = e.target.closest("button[data-i]");
            if (b) detalleMov(estado.movsVista[Number(b.getAttribute("data-i"))]);
        });
        document.getElementById("puTablaMeses").addEventListener("click", function (e) {
            var b = e.target.closest("button[data-mes]");
            if (!b) return;
            selPeriodo.value = b.getAttribute("data-mes");
            estado.periodo = selPeriodo.value;
            pintarPerfil();
        });

        document.getElementById("puModal").addEventListener("click", function (e) { if (e.target.id === "puModal") cerrarModal(); });
        document.getElementById("btnPuExcel").addEventListener("click", exportarExcel);
        document.getElementById("btnPuPDF").addEventListener("click", exportarPDF);

        pintarPerfil();
    }

    function vista() {
        var u = estado.usuario, per = estado.periodo;
        var pagos = u.pagos.filter(function (p) { return per === "todo" || mesDePago(p) === per; })
            .sort(function (a, b) { return (b.fechaPago || "").localeCompare(a.fechaPago || ""); });
        var movs = u.movimientos.filter(function (a) { return per === "todo" || mesDeMov(a) === per; });
        return { pagos: pagos, movs: movs };
    }

    function resumenPorMes(u) {
        var porMes = {};
        u.pagos.forEach(function (p) {
            var m = mesDePago(p) || "Sin fecha";
            if (!porMes[m]) porMes[m] = { mes: m, pagos: 0, total: 0 };
            porMes[m].pagos++;
            porMes[m].total += p.valorPagado;
        });
        return Object.keys(porMes).sort().reverse().map(function (m) { return porMes[m]; });
    }

    function pintarPerfil() {
        var u = estado.usuario, v = vista();

        document.getElementById("puResumenPeriodo").innerHTML =
            "<strong>" + escaparHTML(etiquetaPeriodo()) + ":</strong> " + v.pagos.length + " pago(s) registrados por " +
            "<strong>" + formatearMoneda(sumar(v.pagos)) + "</strong> y " + v.movs.length + " movimiento(s).";

        // ingresos por mes (historial completo)
        var filasMes = resumenPorMes(u);
        var tm = document.getElementById("puTablaMeses");
        tm.innerHTML = filasMes.length ? filasMes.map(function (f) {
            var activo = f.mes === estado.periodo ? ' style="background:#eaf6ff;"' : "";
            return "<tr" + activo + "><td>" + escaparHTML(nombreMes(f.mes)) + "</td><td>" + f.pagos + "</td><td>" + formatearMoneda(f.total) + "</td>" +
                '<td><button class="btn-action-sm" data-mes="' + escaparHTML(f.mes) + '">Ver mes</button></td></tr>';
        }).join("") : '<tr><td colspan="4">Este usuario no tiene pagos atribuidos</td></tr>';

        // pagos del periodo
        estado.pagosVista = v.pagos;
        var tp = document.getElementById("puTablaPagos");
        tp.innerHTML = v.pagos.length ? v.pagos.map(function (p, i) {
            return "<tr><td>" + escaparHTML(p.clienteNombre || "N/A") + "</td><td>" + escaparHTML(p.mes || "") + "</td><td>" + formatearMoneda(p.valorPagado) +
                "</td><td>" + escaparHTML(p.fechaPago || "") + "</td><td>" + escaparHTML(p.metodoPago || "") +
                '</td><td><button class="btn-action-sm" data-i="' + i + '">Ver detalle</button></td></tr>';
        }).join("") : '<tr><td colspan="6">Sin pagos registrados en este periodo</td></tr>';

        // movimientos del periodo (con filtro de acción)
        var movs = v.movs.filter(function (a) { return !estado.accion || (a.accion || "Sin acción") === estado.accion; });
        estado.movsVista = movs;
        var tmv = document.getElementById("puTablaMovs");
        tmv.innerHTML = movs.length ? movs.map(function (a, i) {
            return "<tr><td>" + escaparHTML(textoFecha(a)) + "</td><td>" + escaparHTML(a.accion || "") + "</td><td>" + escaparHTML(a.detalle || "") +
                '</td><td><button class="btn-action-sm" data-i="' + i + '">Ver detalle</button></td></tr>';
        }).join("") : '<tr><td colspan="4">Sin movimientos en este periodo</td></tr>';
    }

    // ============================================================
    // DESCARGAS
    // ============================================================
    function hoja(filas, vacio) {
        return XLSX.utils.json_to_sheet(filas.length ? filas : [vacio]);
    }

    function exportarExcel() {
        var u = estado.usuario, v = vista(), r = resumen(u);
        if (typeof XLSX === "undefined") { alert("No se cargó la librería de Excel. Revisa tu conexión y recarga la página."); return; }

        var resumenFilas = [
            { Campo: "Usuario", Valor: u.email || ("UID " + u.uid) },
            { Campo: "Nombre", Valor: u.nombre || "-" },
            { Campo: "Rol", Valor: u.rol || "-" },
            { Campo: "Periodo del informe", Valor: etiquetaPeriodo() },
            { Campo: "Pagos registrados en el periodo", Valor: v.pagos.length },
            { Campo: "Recaudado en el periodo", Valor: sumar(v.pagos) },
            { Campo: "Movimientos en el periodo", Valor: v.movs.length },
            { Campo: "Recaudado este mes (" + nombreMes(mesActual()) + ")", Valor: r.mesTotal },
            { Campo: "Recaudado total (histórico)", Valor: r.total },
            { Campo: "Movimientos totales", Valor: r.movs },
            { Campo: "Generado", Valor: new Date().toLocaleString("es-CO") }
        ];
        var porMes = resumenPorMes(u).map(function (f) { return { Mes: nombreMes(f.mes), Pagos: f.pagos, TotalRecaudado: f.total }; });
        var pagos = v.pagos.map(function (p) {
            return { Cliente: p.clienteNombre || "", MesPagado: p.mes || "", Valor: p.valorPagado, FechaPago: p.fechaPago || "", Metodo: p.metodoPago || "", Observaciones: p.observaciones || "", RegistradoEl: textoRegistro(p.registradoEn) };
        });
        var movs = v.movs.map(function (a) { return { Fecha: textoFecha(a), Accion: a.accion || "", Detalle: a.detalle || "" }; });

        var libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(resumenFilas), "Resumen");
        XLSX.utils.book_append_sheet(libro, hoja(porMes, { Mes: "", Pagos: "", TotalRecaudado: "" }), "Ingresos por mes");
        XLSX.utils.book_append_sheet(libro, hoja(pagos, { Cliente: "", MesPagado: "", Valor: "", FechaPago: "", Metodo: "", Observaciones: "", RegistradoEl: "" }), "Pagos");
        XLSX.utils.book_append_sheet(libro, hoja(movs, { Fecha: "", Accion: "", Detalle: "" }), "Movimientos");
        XLSX.writeFile(libro, "usuario_" + slug(u.email || u.uid) + "_" + estado.periodo + ".xlsx");
        registrarActividad("Descargó informe de usuario", "Excel - " + (u.email || u.uid) + " - " + etiquetaPeriodo());
    }

    function exportarPDF() {
        var u = estado.usuario, v = vista(), r = resumen(u);
        if (!window.jspdf || !window.jspdf.jsPDF) { alert("No se cargó la librería de PDF. Revisa tu conexión y recarga la página."); return; }
        var doc = new window.jspdf.jsPDF();
        var y = 18;

        doc.setFontSize(16); doc.setTextColor(10, 61, 98);
        doc.text("DMR Comunicaciones", 14, y); y += 7;
        doc.setFontSize(11); doc.setTextColor(120);
        doc.text("Informe detallado de usuario", 14, y); y += 10;

        doc.setFontSize(10); doc.setTextColor(30);
        [
            "Usuario: " + (u.email || ("UID " + u.uid)),
            "Nombre: " + (u.nombre || "-") + "     Rol: " + (u.rol || "-"),
            "Periodo del informe: " + etiquetaPeriodo(),
            "Generado: " + new Date().toLocaleString("es-CO")
        ].forEach(function (l) { doc.text(l, 14, y); y += 6; });

        y += 3;
        doc.autoTable({
            startY: y,
            head: [["Resumen", "Valor"]],
            body: [
                ["Pagos registrados en el periodo", String(v.pagos.length)],
                ["Recaudado en el periodo", formatearMoneda(sumar(v.pagos))],
                ["Movimientos en el periodo", String(v.movs.length)],
                ["Recaudado este mes (" + nombreMes(mesActual()) + ")", formatearMoneda(r.mesTotal)],
                ["Recaudado total (histórico)", formatearMoneda(r.total)],
                ["Movimientos totales", String(r.movs)]
            ],
            styles: { fontSize: 9 }, headStyles: { fillColor: [10, 61, 98] }
        });

        function titulo(texto) {
            y = doc.lastAutoTable.finalY + 10;
            if (y > 262) { doc.addPage(); y = 18; }
            doc.setFontSize(12); doc.setTextColor(10, 61, 98);
            doc.text(texto, 14, y);
            y += 3;
        }

        titulo("Ingresos por mes (historial completo)");
        var filasMes = resumenPorMes(u).map(function (f) { return [nombreMes(f.mes), String(f.pagos), formatearMoneda(f.total)]; });
        doc.autoTable({
            startY: y, head: [["Mes", "Pagos", "Total recaudado"]],
            body: filasMes.length ? filasMes : [["Sin pagos atribuidos", "", ""]],
            styles: { fontSize: 9 }, headStyles: { fillColor: [10, 61, 98] }
        });

        titulo("Pagos registrados - " + etiquetaPeriodo());
        var filasPagos = v.pagos.map(function (p) {
            return [p.clienteNombre || "", p.mes || "", formatearMoneda(p.valorPagado), p.fechaPago || "", p.metodoPago || "", p.observaciones || ""];
        });
        doc.autoTable({
            startY: y, head: [["Cliente", "Mes", "Valor", "Fecha de pago", "Método", "Observaciones"]],
            body: filasPagos.length ? filasPagos : [["Sin pagos en este periodo", "", "", "", "", ""]],
            styles: { fontSize: 8 }, headStyles: { fillColor: [10, 61, 98] }
        });

        titulo("Movimientos - " + etiquetaPeriodo());
        var filasMov = v.movs.map(function (a) { return [textoFecha(a), a.accion || "", a.detalle || ""]; });
        doc.autoTable({
            startY: y, head: [["Fecha y hora", "Acción", "Detalle"]],
            body: filasMov.length ? filasMov : [["Sin movimientos en este periodo", "", ""]],
            styles: { fontSize: 8 }, headStyles: { fillColor: [10, 61, 98] },
            columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 40 } }
        });

        var n = doc.getNumberOfPages();
        for (var i = 1; i <= n; i++) {
            doc.setPage(i);
            doc.setFontSize(8); doc.setTextColor(140);
            doc.text("DMR Comunicaciones - Página " + i + " de " + n, 105, 290, { align: "center" });
        }
        doc.save("informe_usuario_" + slug(u.email || u.uid) + "_" + estado.periodo + ".pdf");
        registrarActividad("Descargó informe de usuario", "PDF - " + (u.email || u.uid) + " - " + etiquetaPeriodo());
    }

    // ============================================================
    // ARRANQUE (lo llama funciones.js dentro de inicializarPagina)
    // ============================================================
    window.inicializarModuloUsuarios = function () {
        var esLista = !!document.getElementById("tablaUsuariosBody");
        var esPerfil = !!document.getElementById("puTablaMovs");
        if (!esLista && !esPerfil) return;

        if (rolUsuarioActual !== "administrador") {
            alert("Solo el administrador puede ver esta sección.");
            window.location.replace("incio.html");
            return;
        }
        cargarDatos().then(function () {
            if (esLista) iniciarLista(); else iniciarPerfil();
        }).catch(function (err) {
            var celda = document.getElementById("tablaUsuariosBody") || document.getElementById("puTablaMovs");
            if (celda) celda.innerHTML = '<tr><td colspan="8">Error al cargar los datos: ' + escaparHTML(err.message) + "</td></tr>";
        });
    };
})();