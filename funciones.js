/* ============================================================
   DMR COMUNICACIONES - funciones.js
   Script único compartido por todas las ventanas.

   Requiere que cada HTML incluya, ANTES de este archivo:
     <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"></script>

   MODELO DE COBRO (cuenta corriente única, calculada en vivo):
     meses      = meses cumplidos desde fechaInicio
                  (28/sep = 0 meses, 28/oct = 1 mes, 28/nov = 2 meses...)
     facturado  = valorMensual × meses
     saldo      = facturado − totalPagado (todo lo abonado históricamente)
   Solo "totalPagado" se guarda en Firestore; lo demás se calcula.
   ============================================================ */

// 1) CONFIGURACIÓN DE FIREBASE -------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyB1fdW4UhwFcI4tDVb00ygB_7ftBFaZqGc",
    authDomain: "drm-comunicacioes.firebaseapp.com",
    projectId: "drm-comunicacioes",
    storageBucket: "drm-comunicacioes.firebasestorage.app",
    messagingSenderId: "785178429175",
    appId: "1:785178429175:web:3d413757b30912dd8b35f2",
    measurementId: "G-H6EVQPSHZ1"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ============================================================
// SPINNER GLOBAL DE CARGA
// ============================================================
(function () {
    let contadorProcesos = 0;
    let overlay = null;

    function crearOverlay() {
        if (overlay || !document.body) return;
        overlay = document.createElement("div");
        overlay.className = "spinner-global-overlay";
        overlay.innerHTML = '<div class="spinner-global-circulo"></div><div class="spinner-global-texto" id="spinnerGlobalTexto">Cargando...</div>';
        document.body.appendChild(overlay);
    }

    window.mostrarCargandoGlobal = function (mensaje) {
        crearOverlay();
        if (!overlay) return;
        contadorProcesos++;
        document.getElementById("spinnerGlobalTexto").textContent = mensaje || "Cargando...";
        overlay.classList.add("visible");
    };

    window.ocultarCargandoGlobal = function () {
        contadorProcesos = Math.max(0, contadorProcesos - 1);
        if (overlay && contadorProcesos === 0) overlay.classList.remove("visible");
    };
})();

// ============================================================
// SPINNER AUTOMÁTICO EN TODAS LAS LLAMADAS A FIRESTORE
// ============================================================
(function () {
    function envolverConSpinner(prototipo, nombreMetodo) {
        if (!prototipo || typeof prototipo[nombreMetodo] !== "function") return;
        const original = prototipo[nombreMetodo];
        prototipo[nombreMetodo] = function () {
            mostrarCargandoGlobal();
            const resultado = original.apply(this, arguments);
            if (resultado && typeof resultado.then === "function") {
                resultado.then(ocultarCargandoGlobal, ocultarCargandoGlobal);
            } else {
                ocultarCargandoGlobal();
            }
            return resultado;
        };
    }

    envolverConSpinner(firebase.firestore.Query.prototype, "get");

    ["get", "set", "update", "delete"].forEach(function (metodo) {
        envolverConSpinner(firebase.firestore.DocumentReference.prototype, metodo);
    });

    envolverConSpinner(firebase.firestore.CollectionReference.prototype, "add");

    envolverConSpinner(firebase.auth.Auth.prototype, "signInWithEmailAndPassword");
    envolverConSpinner(firebase.auth.Auth.prototype, "signOut");
})();


// 2) UTILIDADES -----------------------------------------------
function formatearMoneda(valor) {
    return "$ " + Number(valor || 0).toLocaleString("es-CO");
}

function obtenerParametroURL(nombre) {
    return new URLSearchParams(window.location.search).get(nombre);
}

function mostrarCargando(el, mensaje) {
    if (el) el.innerHTML = `<tr><td colspan="10">${mensaje}</td></tr>`;
}

// Evita inyección de HTML al pintar datos escritos por usuarios
function esc(texto) {
    return String(texto == null ? "" : texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Fecha local en formato YYYY-MM-DD (sin desfase por zona horaria)
function fechaLocalISO(fecha) {
    const d = fecha || new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
}

function traducirErrorFirebase(codigo) {
    const mensajes = {
        "auth/invalid-email": "Correo inválido.",
        "auth/user-not-found": "Usuario no encontrado.",
        "auth/wrong-password": "Contraseña incorrecta.",
        "auth/invalid-credential": "Usuario o contraseña incorrectos.",
        "auth/too-many-requests": "Demasiados intentos. Intenta más tarde.",
        "auth/network-request-failed": "Error de conexión. Revisa tu internet."
    };
    return mensajes[codigo] || "No se pudo iniciar sesión.";
}

// --- Cálculo de cobro ------------------------------------------

// Aniversario número m de la fecha de inicio (si el día no existe en ese mes, usa el último día)
function fechaAniversario(inicio, m) {
    const mes = inicio.getMonth() + m;
    const ultimoDia = new Date(inicio.getFullYear(), mes + 1, 0).getDate();
    return new Date(inicio.getFullYear(), mes, Math.min(inicio.getDate(), ultimoDia));
}

// Meses cumplidos desde fechaInicio: 0 el día de inicio, 1 al mes exacto, etc.
function mesesFacturados(c) {
    let inicio = null;
    if (c.fechaInicio) {
        const p = c.fechaInicio.split("-");
        inicio = new Date(+p[0], +p[1] - 1, +p[2]);
    } else if (c.creadoEn && c.creadoEn.toDate) {
        const t = c.creadoEn.toDate();
        inicio = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    }
    if (!inicio || isNaN(inicio.getTime())) return 0;

    const ahora = new Date();
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    if (hoy < inicio) return 0;

    let meses = (hoy.getFullYear() - inicio.getFullYear()) * 12 + (hoy.getMonth() - inicio.getMonth());
    while (meses > 0 && fechaAniversario(inicio, meses) > hoy) meses--;
    return meses;
}

// Cuenta corriente única: deuda = cuota × meses − todo lo abonado
function calcularEstadoFinanciero(c) {
    const cuota = Number(c.valorMensual) || 0;
    const meses = mesesFacturados(c);
    const totalFacturado = cuota * meses;
    const totalPagado = Number(c.totalPagado) || 0;
    return {
        meses: meses,
        totalFacturado: totalFacturado,
        totalPagado: totalPagado,
        saldoPendiente: Math.max(0, totalFacturado - totalPagado),
        saldoAFavor: Math.max(0, totalPagado - totalFacturado),
        pendiente: totalFacturado - totalPagado > 0
    };
}

// 3) LOGIN (index.html) ----------------------------------------
function inicializarLogin() {
    const form = document.getElementById("formLogin");
    if (!form) return;

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        const email = document.getElementById("loginUsuario").value.trim();
        const password = document.getElementById("loginPassword").value;
        const errorEl = document.getElementById("loginError");
        const btn = document.getElementById("btnLogin");

        errorEl.textContent = "";
        btn.disabled = true;
        btn.textContent = "Ingresando...";

        auth.signInWithEmailAndPassword(email, password)
            .then(function () {
                window.location.href = "incio.html";
            })
            .catch(function (err) {
                errorEl.textContent = traducirErrorFirebase(err.code);
                btn.disabled = false;
                btn.textContent = "Ingresar";
            });
    });
}

// 4) CERRAR SESIÓN (sidebar, todas las páginas internas) --------
function inicializarLogout() {
    document.querySelectorAll(".sidebar-footer").forEach(function (el) {
        el.addEventListener("click", function () {
            auth.signOut().then(function () {
                window.location.href = "index.html";
            });
        });
    });
}

// 5) REGISTRAR CLIENTE (registrocliente.html) --------------------
function inicializarFormularioRegistro() {
    const form = document.getElementById("formRegistro");
    if (!form) return;

    const btnLimpiar = document.getElementById("btnLimpiar");
    if (btnLimpiar) btnLimpiar.addEventListener("click", function () { form.reset(); });

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        const datos = {
            nombre: document.getElementById("nombre").value.trim(),
            direccion: document.getElementById("direccion").value.trim(),
            telefono: document.getElementById("telefono").value.trim(),
            tipoServicio: document.getElementById("tipoServicio").value,
            plan: document.getElementById("plan").value.trim(),
            valorMensual: Number(document.getElementById("valorMensual").value) || 0,
            fechaInicio: document.getElementById("fechaInicio").value,
            duracionContrato: document.getElementById("duracionContrato").value,
            documento: document.getElementById("documento").value.trim(),
            observaciones: document.getElementById("observaciones").value.trim(),
            totalPagado: 0,
            creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        };

        // La fecha de inicio es obligatoria: de ahí se cuentan los meses de cobro
        if (!datos.nombre || !datos.direccion || !datos.telefono || !datos.tipoServicio || !datos.fechaInicio) {
            alert("Completa los campos obligatorios (*), incluida la fecha de inicio");
            return;
        }

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Guardando...";

        db.collection("clientes").add(datos)
            .then(function () {
                alert("Cliente registrado correctamente");
                window.location.href = "listacliente.html";
            })
            .catch(function (err) {
                alert("Error al guardar: " + err.message);
                btn.disabled = false;
                btn.textContent = "Guardar Cliente";
            });
    });
}

// 6) LISTA DE CLIENTES (listacliente.html) -----------------------
let cacheClientes = [];

function cargarListaClientes() {
    const tbody = document.getElementById("tablaClientesBody");
    if (!tbody) return;

    mostrarCargando(tbody, "Cargando clientes...");

    db.collection("clientes").orderBy("nombre").get()
        .then(function (snapshot) {
            cacheClientes = [];
            snapshot.forEach(function (doc) {
                cacheClientes.push(Object.assign({ id: doc.id }, doc.data()));
            });
            renderizarClientes(cacheClientes);
        })
        .catch(function (err) {
            mostrarCargando(tbody, "Error al cargar clientes: " + esc(err.message));
        });

    const buscador = document.getElementById("buscarCliente");
    if (buscador) buscador.addEventListener("input", filtrarClientes);
}

function renderizarClientes(lista) {
    const tbody = document.getElementById("tablaClientesBody");
    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="7">No hay clientes registrados</td></tr>';
        return;
    }
    tbody.innerHTML = lista.map(function (c) {
        const esPendiente = calcularEstadoFinanciero(c).pendiente;
        return `<tr>
            <td>${esc(c.nombre)}</td>
            <td>${esc(c.direccion)}</td>
            <td>${esc(c.telefono)}</td>
            <td>${esc(c.tipoServicio)}</td>
            <td>${formatearMoneda(c.valorMensual)}</td>
            <td><span class="status-badge ${esPendiente ? "pending" : "active"}">${esPendiente ? "Pendiente" : "Al día"}</span></td>
            <td><button class="btn-action-sm" onclick="location.href='perfilciente.html?id=${esc(c.id)}'">Ver perfil</button></td>
        </tr>`;
    }).join("");
}

function filtrarClientes() {
    const texto = document.getElementById("buscarCliente").value.toLowerCase();
    const filtrados = cacheClientes.filter(function (c) {
        return (c.nombre || "").toLowerCase().includes(texto) ||
               (c.documento || "").toLowerCase().includes(texto) ||
               (c.telefono || "").toLowerCase().includes(texto);
    });
    renderizarClientes(filtrados);
}

// 7) DETALLE DE CLIENTE (perfilciente.html) -----------------------
function cargarDetalleCliente() {
    const el = document.getElementById("detalleNombre");
    if (!el) return;

    const id = obtenerParametroURL("id");
    if (!id) {
        alert("No se especificó ningún cliente");
        window.location.href = "listacliente.html";
        return;
    }

    db.collection("clientes").doc(id).get().then(function (doc) {
        if (!doc.exists) {
            alert("Cliente no encontrado");
            window.location.href = "listacliente.html";
            return;
        }
        const c = doc.data();
        const fin = calcularEstadoFinanciero(c);
        const esPendiente = fin.pendiente;

        document.getElementById("detalleNombre").textContent = c.nombre;
        const estadoEl = document.getElementById("detalleEstado");
        estadoEl.textContent = esPendiente ? "Pendiente" : "Al día";
        estadoEl.className = "status-badge " + (esPendiente ? "pending" : "active");
        document.getElementById("detalleDocumento").textContent = c.documento || "N/A";
        document.getElementById("detalleTelefono").textContent = c.telefono || "N/A";
        document.getElementById("detalleDireccion").textContent = c.direccion || "N/A";
        document.getElementById("detalleServicio").textContent = c.tipoServicio || "N/A";
        document.getElementById("detalleValorMensual").textContent = formatearMoneda(c.valorMensual);
        document.getElementById("resumenTotalFacturado").textContent = formatearMoneda(fin.totalFacturado);
        document.getElementById("resumenTotalPagado").textContent = formatearMoneda(fin.totalPagado);
        document.getElementById("resumenSaldoPendiente").textContent =
            fin.saldoAFavor > 0 ? "A favor: " + formatearMoneda(fin.saldoAFavor) : formatearMoneda(fin.saldoPendiente);

        const btnPago = document.getElementById("btnActualizarPago");
        if (btnPago) btnPago.onclick = function () { location.href = "actualizarpago.html?id=" + id; };
    });

    cargarHistorialPagos(id);
}

function cargarHistorialPagos(id) {
    const tbody = document.getElementById("tablaPagosBody");
    if (!tbody) return;

    db.collection("clientes").doc(id).collection("pagos").orderBy("fechaPago", "desc").get()
        .then(function (snapshot) {
            if (snapshot.empty) {
                tbody.innerHTML = '<tr><td colspan="4">Sin pagos registrados</td></tr>';
                return;
            }
            tbody.innerHTML = snapshot.docs.map(function (doc) {
                const p = doc.data();
                return `<tr>
                    <td>${esc(p.mes)}</td>
                    <td>${formatearMoneda(p.valorPagado)}</td>
                    <td>${esc(p.fechaPago)}</td>
                    <td><span class="status-badge active">Pagado</span></td>
                </tr>`;
            }).join("");
        })
        .catch(function (err) {
            tbody.innerHTML = '<tr><td colspan="4">Error al cargar pagos: ' + esc(err.message) + "</td></tr>";
        });
}

// 8) ACTUALIZAR PAGO (actualizarpago.html) -----------------------------
function inicializarFormularioPago() {
    const form = document.getElementById("formPago");
    if (!form) return;

    const id = obtenerParametroURL("id");
    if (!id) {
        alert("No se especificó ningún cliente");
        window.location.href = "listacliente.html";
        return;
    }

    const btnCancelar = document.getElementById("btnCancelarPago");
    if (btnCancelar) btnCancelar.onclick = function () { location.href = "perfilciente.html?id=" + id; };

    let nombreClienteActual = "";
    db.collection("clientes").doc(id).get().then(function (doc) {
        if (doc.exists) {
            nombreClienteActual = doc.data().nombre || "";
            const elNombre = document.getElementById("pagoClienteNombre");
            if (elNombre) elNombre.textContent = nombreClienteActual;
        }
    });

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        const pago = {
            clienteId: id,
            clienteNombre: nombreClienteActual,
            mes: document.getElementById("pagoMes").value.trim(),
            fechaPago: document.getElementById("pagoFecha").value,
            valorPagado: Number(document.getElementById("pagoValor").value) || 0,
            metodoPago: document.getElementById("pagoMetodo").value,
            observaciones: document.getElementById("pagoObservaciones").value.trim(),
            registradoEn: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!pago.mes || !pago.fechaPago || pago.valorPagado <= 0) {
            alert("Completa los campos obligatorios (*) con un valor mayor a 0");
            return;
        }

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Guardando...";

        const clienteRef = db.collection("clientes").doc(id);

        // Se guarda el pago y se suma al total abonado (increment evita condiciones de carrera).
        // El saldo pendiente NO se toca: se calcula solo (cuota × meses − totalPagado).
        clienteRef.collection("pagos").add(pago)
            .then(function () {
                return clienteRef.update({
                    totalPagado: firebase.firestore.FieldValue.increment(pago.valorPagado)
                });
            })
            .then(function () {
                if (document.getElementById("comprobanteOverlay")) {
                    mostrarComprobantePago(pago, id);
                } else {
                    alert("Pago registrado correctamente");
                    window.location.href = "perfilciente.html?id=" + id;
                }
            })
            .catch(function (err) {
                alert("Error al guardar el pago: " + err.message);
                btn.disabled = false;
                btn.textContent = "Guardar Pago";
            });
    });
}

// 9) DASHBOARD (incio.html) -----------------------------------------
function cargarMetricasDashboard() {
    const el = document.getElementById("metricTotalClientes");
    if (!el) return;

    db.collection("clientes").get().then(function (snapshot) {
        let pendientes = 0, activos = 0;
        snapshot.forEach(function (doc) {
            if (calcularEstadoFinanciero(doc.data()).pendiente) pendientes++; else activos++;
        });
        document.getElementById("metricTotalClientes").textContent = snapshot.size;
        document.getElementById("metricPendientes").textContent = pendientes;
        document.getElementById("metricActivos").textContent = activos;
    });

    db.collectionGroup("pagos").get().then(function (snapshot) {
        // Corregido: mes actual en hora local (toISOString usaba UTC y fallaba de noche)
        const mesActual = fechaLocalISO().slice(0, 7);
        let total = 0;
        snapshot.forEach(function (doc) {
            const p = doc.data();
            if (p.fechaPago && p.fechaPago.startsWith(mesActual)) total += (p.valorPagado || 0);
        });
        document.getElementById("metricPagosMes").textContent = formatearMoneda(total);
    }).catch(function () {
        document.getElementById("metricPagosMes").textContent = formatearMoneda(0);
    });

    const tbody = document.getElementById("tablaRecientes");
    if (tbody) {
        db.collection("clientes").orderBy("creadoEn", "desc").limit(5).get()
            .then(function (snapshot) {
                if (snapshot.empty) {
                    tbody.innerHTML = '<tr><td colspan="3">Sin registros</td></tr>';
                    return;
                }
                tbody.innerHTML = snapshot.docs.map(function (doc) {
                    const c = doc.data();
                    return `<tr><td>${esc(c.nombre)}</td><td>${esc(c.tipoServicio)}</td><td>${formatearMoneda(c.valorMensual)}</td></tr>`;
                }).join("");
            });
    }
}

// 9b) HISTORIAL GENERAL DE PAGOS (pagos.html) ------------------------
function cargarListaPagos() {
    const tbody = document.getElementById("tablaPagosGeneral");
    if (!tbody) return;

    mostrarCargando(tbody, "Cargando pagos...");

    db.collectionGroup("pagos").get().then(function (snapshot) {
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="6">Sin pagos registrados</td></tr>';
            return;
        }
        const pagos = [];
        snapshot.forEach(function (doc) {
            const p = doc.data();
            pagos.push({
                clienteId: p.clienteId || doc.ref.parent.parent.id,
                clienteNombre: p.clienteNombre || "N/A",
                mes: p.mes || "",
                valorPagado: p.valorPagado || 0,
                fechaPago: p.fechaPago || "",
                metodoPago: p.metodoPago || ""
            });
        });
        pagos.sort(function (a, b) { return (b.fechaPago || "").localeCompare(a.fechaPago || ""); });

        tbody.innerHTML = pagos.map(function (p) {
            return `<tr>
                <td>${esc(p.clienteNombre)}</td>
                <td>${esc(p.mes)}</td>
                <td>${formatearMoneda(p.valorPagado)}</td>
                <td>${esc(p.fechaPago)}</td>
                <td>${esc(p.metodoPago)}</td>
                <td><button class="btn-action-sm" onclick="location.href='perfilciente.html?id=${esc(p.clienteId)}'">👁️</button></td>
            </tr>`;
        }).join("");
    }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="6">Error al cargar pagos: ' + esc(err.message) + "</td></tr>";
    });
}

// 9c) REPORTES (reportes.html) ---------------------------------------
function cargarReportes() {
    const tabla = document.getElementById("tablaReportesMeses");
    const elPendientes = document.getElementById("reportePendientes");
    if (!tabla && !elPendientes) return;

    if (elPendientes) {
        db.collection("clientes").get().then(function (snapshot) {
            let pendientes = 0;
            snapshot.forEach(function (doc) {
                if (calcularEstadoFinanciero(doc.data()).pendiente) pendientes++;
            });
            elPendientes.textContent = pendientes;
        });
    }

    if (tabla) {
        mostrarCargando(tabla, "Calculando...");
        db.collectionGroup("pagos").get().then(function (snapshot) {
            const porMes = {};
            let totalGeneral = 0;
            snapshot.forEach(function (doc) {
                const p = doc.data();
                const clave = (p.fechaPago || "").slice(0, 7) || "Sin fecha";
                porMes[clave] = (porMes[clave] || 0) + (p.valorPagado || 0);
                totalGeneral += (p.valorPagado || 0);
            });

            const elTotal = document.getElementById("reporteTotalIngresos");
            if (elTotal) elTotal.textContent = formatearMoneda(totalGeneral);

            const meses = Object.keys(porMes).sort().reverse();
            if (!meses.length) {
                tabla.innerHTML = '<tr><td colspan="2">Sin pagos registrados</td></tr>';
                return;
            }
            tabla.innerHTML = meses.map(function (m) {
                return `<tr><td>${esc(m)}</td><td>${formatearMoneda(porMes[m])}</td></tr>`;
            }).join("");
        }).catch(function (err) {
            tabla.innerHTML = '<tr><td colspan="2">Error: ' + esc(err.message) + "</td></tr>";
        });
    }
}

// 9d) EXPORTAR A EXCEL Y PDF (reportes.html) --------------------------
function inicializarExportaciones() {
    const select = document.getElementById("exportClienteSelect");
    if (!select) return;

    db.collection("clientes").orderBy("nombre").get().then(function (snapshot) {
        select.innerHTML = '<option value="">Selecciona un cliente</option>' +
            snapshot.docs.map(function (doc) {
                return `<option value="${esc(doc.id)}">${esc(doc.data().nombre)}</option>`;
            }).join("");
    });

    const btnTodosExcel = document.getElementById("btnExportarTodosExcel");
    if (btnTodosExcel) btnTodosExcel.addEventListener("click", exportarTodosClientesExcel);

    const btnTodosPDF = document.getElementById("btnExportarTodosPDF");
    if (btnTodosPDF) btnTodosPDF.addEventListener("click", exportarTodosClientesPDF);

    const btnClienteExcel = document.getElementById("btnExportarClienteExcel");
    if (btnClienteExcel) btnClienteExcel.addEventListener("click", exportarClienteExcel);

    const btnClientePDF = document.getElementById("btnExportarClientePDF");
    if (btnClientePDF) btnClientePDF.addEventListener("click", exportarClientePDF);
}

function filaClienteParaExportar(c) {
    const fin = calcularEstadoFinanciero(c);
    return {
        Nombre: c.nombre || "",
        Documento: c.documento || "",
        Direccion: c.direccion || "",
        Telefono: c.telefono || "",
        Servicio: c.tipoServicio || "",
        Plan: c.plan || "",
        ValorMensual: c.valorMensual || 0,
        Estado: fin.pendiente ? "Pendiente" : "Al día",
        MesesFacturados: fin.meses,
        TotalFacturado: fin.totalFacturado,
        TotalPagado: fin.totalPagado,
        SaldoPendiente: fin.saldoPendiente,
        FechaInicio: c.fechaInicio || "",
        DuracionContrato: c.duracionContrato || ""
    };
}

function exportarTodosClientesExcel() {
    db.collection("clientes").orderBy("nombre").get().then(function (snapshot) {
        const filas = [];
        snapshot.forEach(function (doc) { filas.push(filaClienteParaExportar(doc.data())); });

        const hoja = XLSX.utils.json_to_sheet(filas);
        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hoja, "Clientes");
        XLSX.writeFile(libro, "clientes_DMR.xlsx");
    }).catch(function (err) { alert("Error al exportar: " + err.message); });
}

function exportarTodosClientesPDF() {
    db.collection("clientes").orderBy("nombre").get().then(function (snapshot) {
        const filas = [];
        snapshot.forEach(function (doc) {
            const c = doc.data();
            filas.push([
                c.nombre || "", c.telefono || "", c.direccion || "",
                c.tipoServicio || "", formatearMoneda(c.valorMensual),
                calcularEstadoFinanciero(c).pendiente ? "Pendiente" : "Al día"
            ]);
        });

        const jsPDFClase = window.jspdf.jsPDF;
        const doc = new jsPDFClase();
        doc.setFontSize(14);
        doc.text("DMR Comunicaciones - Listado de Clientes", 14, 15);
        doc.setFontSize(9);
        doc.text("Generado: " + new Date().toLocaleString("es-CO"), 14, 21);
        doc.autoTable({
            startY: 26,
            head: [["Nombre", "Teléfono", "Dirección", "Servicio", "Valor mes", "Estado"]],
            body: filas,
            styles: { fontSize: 8 }
        });
        doc.save("clientes_DMR.pdf");
    }).catch(function (err) { alert("Error al exportar: " + err.message); });
}

function obtenerClienteYPagosParaExportar(id) {
    const clienteRef = db.collection("clientes").doc(id);
    return Promise.all([
        clienteRef.get(),
        clienteRef.collection("pagos").orderBy("fechaPago", "desc").get()
    ]);
}

function exportarClienteExcel() {
    const id = document.getElementById("exportClienteSelect").value;
    if (!id) { alert("Selecciona un cliente"); return; }

    obtenerClienteYPagosParaExportar(id).then(function (resultados) {
        const c = resultados[0].data();
        const pagosSnap = resultados[1];

        const hojaInfo = XLSX.utils.json_to_sheet([filaClienteParaExportar(c)]);

        const filasPagos = [];
        pagosSnap.forEach(function (doc) {
            const p = doc.data();
            filasPagos.push({ Mes: p.mes || "", Valor: p.valorPagado || 0, FechaPago: p.fechaPago || "", Metodo: p.metodoPago || "" });
        });
        const hojaPagos = XLSX.utils.json_to_sheet(filasPagos.length ? filasPagos : [{ Mes: "", Valor: "", FechaPago: "", Metodo: "" }]);

        const libro = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(libro, hojaInfo, "Cliente");
        XLSX.utils.book_append_sheet(libro, hojaPagos, "Pagos");
        XLSX.writeFile(libro, "cliente_" + (c.nombre || "cliente").replace(/\s+/g, "_") + ".xlsx");
    }).catch(function (err) { alert("Error al exportar: " + err.message); });
}

function exportarClientePDF() {
    const id = document.getElementById("exportClienteSelect").value;
    if (!id) { alert("Selecciona un cliente"); return; }

    obtenerClienteYPagosParaExportar(id).then(function (resultados) {
        const c = resultados[0].data();
        const pagosSnap = resultados[1];
        const fin = calcularEstadoFinanciero(c);

        const jsPDFClase = window.jspdf.jsPDF;
        const doc = new jsPDFClase();
        doc.setFontSize(14);
        doc.text("DMR Comunicaciones - Ficha de Cliente", 14, 15);
        doc.setFontSize(11);

        let y = 25;
        const lineas = [
            "Nombre: " + (c.nombre || ""),
            "Documento: " + (c.documento || "N/A"),
            "Teléfono: " + (c.telefono || ""),
            "Dirección: " + (c.direccion || ""),
            "Servicio: " + (c.tipoServicio || "") + (c.plan ? " - " + c.plan : ""),
            "Valor mensual: " + formatearMoneda(c.valorMensual),
            "Estado: " + (fin.pendiente ? "Pendiente" : "Al día"),
            "Meses facturados: " + fin.meses,
            "Total facturado: " + formatearMoneda(fin.totalFacturado),
            "Total pagado: " + formatearMoneda(fin.totalPagado),
            "Saldo pendiente: " + formatearMoneda(fin.saldoPendiente)
        ];
        lineas.forEach(function (linea) { doc.text(linea, 14, y); y += 7; });

        const filasPagos = [];
        pagosSnap.forEach(function (pDoc) {
            const p = pDoc.data();
            filasPagos.push([p.mes || "", formatearMoneda(p.valorPagado), p.fechaPago || "", p.metodoPago || ""]);
        });

        doc.autoTable({
            startY: y + 5,
            head: [["Mes", "Valor", "Fecha de pago", "Método"]],
            body: filasPagos.length ? filasPagos : [["Sin pagos registrados", "", "", ""]],
            styles: { fontSize: 9 }
        });
        doc.save("cliente_" + (c.nombre || "cliente").replace(/\s+/g, "_") + ".pdf");
    }).catch(function (err) { alert("Error al exportar: " + err.message); });
}

// 9e) ELIMINAR CLIENTE (perfilciente.html) -----------------------------
function inicializarEliminarCliente() {
    const btn = document.getElementById("btnEliminarCliente");
    if (!btn) return;

    const id = obtenerParametroURL("id");
    if (!id) return;

    btn.addEventListener("click", function () {
        const confirmar = confirm("¿Seguro que deseas eliminar este cliente? Esta acción también borrará todo su historial de pagos y no se puede deshacer.");
        if (!confirmar) return;

        btn.disabled = true;
        btn.textContent = "Eliminando...";

        const clienteRef = db.collection("clientes").doc(id);

        clienteRef.collection("pagos").get()
            .then(function (snapshot) {
                const eliminaciones = [];
                snapshot.forEach(function (doc) { eliminaciones.push(doc.ref.delete()); });
                return Promise.all(eliminaciones);
            })
            .then(function () { return clienteRef.delete(); })
            .then(function () {
                alert("Cliente eliminado correctamente");
                window.location.href = "listacliente.html";
            })
            .catch(function (err) {
                alert("Error al eliminar: " + err.message);
                btn.disabled = false;
                btn.textContent = "🗑 Eliminar Cliente";
            });
    });
}

// 10) COMPROBANTE DE PAGO ---------------------------------------------

// Guarda a dónde redirigir después de que el usuario cierre el comprobante
var comprobanteRedireccion = null;

function formatearValorComprobante(valor) {
    var num = Number(valor) || 0;
    return num.toLocaleString("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 });
}

function formatearFechaComprobante(fechaISO) {
    if (!fechaISO) return "";
    var partes = fechaISO.split("-");
    return partes[2] + "/" + partes[1] + "/" + partes[0];
}

function generarNumeroComprobante() {
    return "CMP-" + Date.now();
}

function enviarComprobantePorCorreo(d) {
    var estadoDiv = document.getElementById("comprobanteEstado");
    if (!d.correo) {
        if (estadoDiv) {
            estadoDiv.textContent = "No se envió el correo: falta la dirección de correo del cliente.";
            estadoDiv.className = "comprobante-estado error";
        }
        return;
    }

    if (typeof emailjs === "undefined") {
        if (estadoDiv) {
            estadoDiv.textContent = "No se pudo enviar el correo: EmailJS no está cargado en esta página.";
            estadoDiv.className = "comprobante-estado error";
        }
        return;
    }

    var parametros = {
        to_email: d.correo,
        numero: d.numero,
        cliente: d.cliente,
        mes: d.mes,
        fecha: d.fechaTexto,
        metodo: d.metodo,
        valor: d.valorTexto,
        observaciones: d.observaciones || "N/A"
    };

    emailjs.send("service_ip7z7bm", "template_6qy7dlv", parametros)
        .then(function () {
            if (estadoDiv) {
                estadoDiv.textContent = "Comprobante enviado al correo del cliente.";
                estadoDiv.className = "comprobante-estado ok";
            }
        })
        .catch(function (err) {
            console.error("Error enviando comprobante:", err);
            if (estadoDiv) {
                estadoDiv.textContent = "No se pudo enviar el correo automáticamente. Puedes descargar el PDF y enviarlo manualmente.";
                estadoDiv.className = "comprobante-estado error";
            }
        });
}

// Llamada desde inicializarFormularioPago() cuando el pago YA se guardó con éxito
function mostrarComprobantePago(pago, idCliente) {
    var overlayComprobante = document.getElementById("comprobanteOverlay");
    var estadoDiv = document.getElementById("comprobanteEstado");
    if (!overlayComprobante) return;

    var inputCorreo = document.getElementById("pagoCorreo");
    var correo = inputCorreo ? inputCorreo.value.trim() : "";

    var d = {
        numero: generarNumeroComprobante(),
        cliente: pago.clienteNombre || "",
        correo: correo,
        mes: pago.mes || "",
        fechaTexto: formatearFechaComprobante(pago.fechaPago),
        valorTexto: formatearValorComprobante(pago.valorPagado),
        metodo: pago.metodoPago || "",
        observaciones: pago.observaciones || ""
    };

    comprobanteRedireccion = "perfilciente.html?id=" + idCliente;

    document.getElementById("cpNumero").textContent = d.numero;
    document.getElementById("cpCliente").textContent = d.cliente || "-";
    document.getElementById("cpCorreo").textContent = d.correo || "-";
    document.getElementById("cpMes").textContent = d.mes || "-";
    document.getElementById("cpFecha").textContent = d.fechaTexto || "-";
    document.getElementById("cpMetodo").textContent = d.metodo || "-";
    document.getElementById("cpValor").textContent = d.valorTexto || "-";

    var obsWrap = document.getElementById("cpObsWrap");
    if (d.observaciones) {
        document.getElementById("cpObs").textContent = d.observaciones;
        obsWrap.style.display = "";
    } else {
        obsWrap.style.display = "none";
    }

    if (estadoDiv) {
        estadoDiv.textContent = "Enviando comprobante al correo...";
        estadoDiv.className = "comprobante-estado enviando";
    }
    overlayComprobante.style.display = "flex";

    enviarComprobantePorCorreo(d);
}

// Se llama una vez al cargar cualquier página que tenga el formulario de pago
function inicializarComprobantePago() {

    if (typeof emailjs !== "undefined") {
        emailjs.init("xRU1qjbLTZ678BVsg");
    }

    var inputFecha = document.getElementById("pagoFecha");
    if (inputFecha && !inputFecha.value) {
        inputFecha.value = fechaLocalISO();
    }

    var btnCerrar = document.getElementById("btnCerrarComprobante");
    if (btnCerrar) {
        btnCerrar.addEventListener("click", function () {
            document.getElementById("comprobanteOverlay").style.display = "none";
            if (comprobanteRedireccion) window.location.href = comprobanteRedireccion;
        });
    }

    var btnImprimir = document.getElementById("btnImprimirComprobante");
    if (btnImprimir) {
        btnImprimir.addEventListener("click", function () {
            var contenido = document.getElementById("comprobanteContenido").innerHTML;
            var ventana = window.open("", "_blank", "width=480,height=640");
            if (!ventana) { alert("Permite las ventanas emergentes para imprimir."); return; }
            ventana.document.write(
                "<html><head><title>Comprobante de Pago</title><style>" +
                "body{font-family:Arial,sans-serif;padding:24px;color:#222;}" +
                "h2{margin-bottom:0;} .comprobante-subtitulo{color:#888;margin-top:4px;}" +
                ".comprobante-fila{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;}" +
                ".comprobante-footer{color:#888;font-size:12px;margin-top:16px;text-align:center;}" +
                "</style></head><body>" + contenido + "</body></html>"
            );
            ventana.document.close();
            ventana.focus();
            setTimeout(function () { ventana.print(); }, 300);
        });
    }

    var btnDescargar = document.getElementById("btnDescargarComprobante");
    if (btnDescargar) {
        btnDescargar.addEventListener("click", function () {
            var jsPDF = window.jspdf.jsPDF;
            var doc = new jsPDF();
            var y = 20;

            doc.setFontSize(16);
            doc.text("DMR Comunicaciones", 20, y); y += 7;
            doc.setFontSize(11);
            doc.setTextColor(120);
            doc.text("Comprobante de Pago", 20, y); y += 10;
            doc.setTextColor(30);
            doc.setLineWidth(0.2);
            doc.line(20, y, 190, y); y += 10;

            var filas = [
                ["N° Comprobante", document.getElementById("cpNumero").textContent],
                ["Cliente", document.getElementById("cpCliente").textContent],
                ["Correo", document.getElementById("cpCorreo").textContent],
                ["Mes correspondiente", document.getElementById("cpMes").textContent],
                ["Fecha de pago", document.getElementById("cpFecha").textContent],
                ["Método de pago", document.getElementById("cpMetodo").textContent],
                ["Valor pagado", document.getElementById("cpValor").textContent]
            ];

            if (document.getElementById("cpObsWrap").style.display !== "none") {
                filas.push(["Observaciones", document.getElementById("cpObs").textContent]);
            }

            doc.setFontSize(11);
            filas.forEach(function (fila) {
                doc.setFont(undefined, "bold");
                doc.text(fila[0] + ":", 20, y);
                doc.setFont(undefined, "normal");
                doc.text(String(fila[1] || "-"), 90, y);
                y += 9;
            });

            y += 5;
            doc.setLineWidth(0.2);
            doc.line(20, y, 190, y); y += 8;
            doc.setFontSize(9);
            doc.setTextColor(140);
            doc.text("Gracias por su pago. Comprobante generado automáticamente.", 20, y);

            doc.save("comprobante_" + document.getElementById("cpNumero").textContent + ".pdf");
        });
    }
}

// 11) RESPONSIVE (sidebar móvil + tablas con scroll) -------------------
function inicializarResponsive() {
    var sidebar = document.querySelector(".sidebar");
    var header = document.querySelector(".main-header");

    if (sidebar && header) {
        var overlay = document.createElement("div");
        overlay.className = "sidebar-overlay";
        document.body.appendChild(overlay);

        var btnMenu = document.createElement("button");
        btnMenu.className = "btn-menu-movil";
        btnMenu.type = "button";
        btnMenu.innerHTML = "☰";
        header.insertBefore(btnMenu, header.firstChild);

        function abrirSidebar() {
            sidebar.classList.add("abierto");
            overlay.classList.add("visible");
        }
        function cerrarSidebar() {
            sidebar.classList.remove("abierto");
            overlay.classList.remove("visible");
        }

        btnMenu.addEventListener("click", function () {
            if (sidebar.classList.contains("abierto")) cerrarSidebar();
            else abrirSidebar();
        });

        overlay.addEventListener("click", cerrarSidebar);

        sidebar.querySelectorAll("a").forEach(function (link) {
            link.addEventListener("click", cerrarSidebar);
        });
    }

    document.querySelectorAll(".custom-table").forEach(function (tabla) {
        if (tabla.parentElement.classList.contains("tabla-scroll")) return;
        var envoltura = document.createElement("div");
        envoltura.className = "tabla-scroll";
        tabla.parentNode.insertBefore(envoltura, tabla);
        envoltura.appendChild(tabla);
    });
}

// 12) ARRANQUE DE CADA PÁGINA -----------------------------------------
function inicializarPagina() {
    inicializarResponsive();
    inicializarLogout();
    cargarMetricasDashboard();
    inicializarFormularioRegistro();
    cargarListaClientes();
    cargarDetalleCliente();
    inicializarEliminarCliente();   // Corregido: antes nunca se llamaba
    inicializarFormularioPago();
    inicializarComprobantePago();
    cargarListaPagos();
    cargarReportes();
    inicializarExportaciones();
}

auth.onAuthStateChanged(function (user) {
    const pagina = window.location.pathname.split("/").pop() || "index.html";
    const esLogin = pagina === "index.html" || pagina === "";

    if (user) {
        if (esLogin) {
            window.location.href = "incio.html";
        } else {
            inicializarPagina();
            document.body.classList.remove("cargando-auth");
        }
    } else {
        if (esLogin) {
            inicializarLogin();
            document.body.classList.remove("cargando-auth");
        } else {
            window.location.href = "index.html";
        }
    }
});