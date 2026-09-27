
/* ============================================================
   DMR COMUNICACIONES - funciones.js
   Script único compartido por todas las ventanas (index.html,
   incio.html, registrocliente.html, listacliente.html,
   perfilciente.html, pagocliente.html).

   Requiere que cada HTML incluya, ANTES de este archivo:
     <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"></script>

   Reglas de Firestore sugeridas (solo usuarios autenticados,
   es decir, el personal de DMR, puede leer/escribir):

     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /{document=**} {
           allow read, write: if request.auth != null;
         }
       }
     }
   ============================================================ */

// 1) CONFIGURACIÓN DE FIREBASE -------------------------------
// Reemplaza estos valores por los de tu proyecto en
// https://console.firebase.google.com  →  Configuración del proyecto
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
            estado: "activo",
            totalFacturado: 0,
            totalPagado: 0,
            saldoPendiente: 0,
            creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (!datos.nombre || !datos.direccion || !datos.telefono || !datos.tipoServicio) {
            alert("Completa los campos obligatorios (*)");
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
            mostrarCargando(tbody, "Error al cargar clientes: " + err.message);
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
        const esPendiente = c.estado === "pendiente";
        return `<tr>
            <td>${c.nombre}</td>
            <td>${c.direccion || ""}</td>
            <td>${c.telefono || ""}</td>
            <td>${c.tipoServicio || ""}</td>
            <td>${formatearMoneda(c.valorMensual)}</td>
            <td><span class="status-badge ${esPendiente ? "pending" : "active"}">${esPendiente ? "Pendiente" : "Al día"}</span></td>
            <td><button class="btn-action-sm" onclick="location.href='perfilciente.html?id=${c.id}'">👁️</button></td>
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
        const esPendiente = c.estado === "pendiente";

        document.getElementById("detalleNombre").textContent = c.nombre;
        const estadoEl = document.getElementById("detalleEstado");
        estadoEl.textContent = esPendiente ? "Pendiente" : "Al día";
        estadoEl.className = "status-badge " + (esPendiente ? "pending" : "active");
        document.getElementById("detalleDocumento").textContent = c.documento || "N/A";
        document.getElementById("detalleTelefono").textContent = c.telefono || "N/A";
        document.getElementById("detalleDireccion").textContent = c.direccion || "N/A";
        document.getElementById("detalleServicio").textContent = c.tipoServicio || "N/A";
        document.getElementById("detalleValorMensual").textContent = formatearMoneda(c.valorMensual);
        document.getElementById("resumenTotalFacturado").textContent = formatearMoneda(c.totalFacturado);
        document.getElementById("resumenTotalPagado").textContent = formatearMoneda(c.totalPagado);
        document.getElementById("resumenSaldoPendiente").textContent = formatearMoneda(c.saldoPendiente);

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
            tbody.innerHTML = "";
            snapshot.forEach(function (doc) {
                const p = doc.data();
                tbody.innerHTML += `<tr>
                    <td>${p.mes}</td>
                    <td>${formatearMoneda(p.valorPagado)}</td>
                    <td>${p.fechaPago}</td>
                    <td><span class="status-badge active">Pagado</span></td>
                </tr>`;
            });
        });
}

// 8) ACTUALIZAR PAGO (pagocliente.html) -----------------------------
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
    const clienteRefInicial = db.collection("clientes").doc(id);
    clienteRefInicial.get().then(function (doc) {
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

        if (!pago.mes || !pago.fechaPago || !pago.valorPagado) {
            alert("Completa los campos obligatorios (*)");
            return;
        }

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Guardando...";

        const clienteRef = db.collection("clientes").doc(id);

        clienteRef.collection("pagos").add(pago)
            .then(function () { return clienteRef.get(); })
            .then(function (doc) {
                const c = doc.data();
                return clienteRef.update({
                    totalPagado: (c.totalPagado || 0) + pago.valorPagado,
                    totalFacturado: (c.totalFacturado || 0) + pago.valorPagado,
                    saldoPendiente: 0,
                    estado: "activo"
                });
            })
            .then(function () {
                if (document.getElementById('comprobanteOverlay')) {
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
            const c = doc.data();
            if (c.estado === "pendiente") pendientes++; else activos++;
        });
        document.getElementById("metricTotalClientes").textContent = snapshot.size;
        document.getElementById("metricPendientes").textContent = pendientes;
        document.getElementById("metricActivos").textContent = activos;
    });

    db.collectionGroup("pagos").get().then(function (snapshot) {
        const mesActual = new Date().toISOString().slice(0, 7);
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
                tbody.innerHTML = "";
                snapshot.forEach(function (doc) {
                    const c = doc.data();
                    tbody.innerHTML += `<tr><td>${c.nombre}</td><td>${c.tipoServicio || ""}</td><td>${formatearMoneda(c.valorMensual)}</td></tr>`;
                });
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
                <td>${p.clienteNombre}</td>
                <td>${p.mes}</td>
                <td>${formatearMoneda(p.valorPagado)}</td>
                <td>${p.fechaPago}</td>
                <td>${p.metodoPago}</td>
                <td><button class="btn-action-sm" onclick="location.href='perfilciente.html?id=${p.clienteId}'">👁️</button></td>
            </tr>`;
        }).join("");
    }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="6">Error al cargar pagos: ' + err.message + "</td></tr>";
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
            snapshot.forEach(function (doc) { if (doc.data().estado === "pendiente") pendientes++; });
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
                return `<tr><td>${m}</td><td>${formatearMoneda(porMes[m])}</td></tr>`;
            }).join("");
        }).catch(function (err) {
            tabla.innerHTML = '<tr><td colspan="2">Error: ' + err.message + "</td></tr>";
        });
    }
}

// 9d) EXPORTAR A EXCEL Y PDF (reportes.html) --------------------------
function inicializarExportaciones() {
    const select = document.getElementById("exportClienteSelect");
    if (!select) return;

    db.collection("clientes").orderBy("nombre").get().then(function (snapshot) {
        select.innerHTML = '<option value="">Selecciona un cliente</option>';
        snapshot.forEach(function (doc) {
            const c = doc.data();
            select.innerHTML += `<option value="${doc.id}">${c.nombre}</option>`;
        });
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
    return {
        Nombre: c.nombre || "",
        Documento: c.documento || "",
        Direccion: c.direccion || "",
        Telefono: c.telefono || "",
        Servicio: c.tipoServicio || "",
        Plan: c.plan || "",
        ValorMensual: c.valorMensual || 0,
        Estado: c.estado === "pendiente" ? "Pendiente" : "Al día",
        TotalFacturado: c.totalFacturado || 0,
        TotalPagado: c.totalPagado || 0,
        SaldoPendiente: c.saldoPendiente || 0,
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
                c.estado === "pendiente" ? "Pendiente" : "Al día"
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
            "Estado: " + (c.estado === "pendiente" ? "Pendiente" : "Al día"),
            "Total facturado: " + formatearMoneda(c.totalFacturado),
            "Total pagado: " + formatearMoneda(c.totalPagado),
            "Saldo pendiente: " + formatearMoneda(c.saldoPendiente)
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

// 10) ARRANQUE DE CADA PÁGINA -----------------------------------------
function inicializarPagina() {
    inicializarLogout();
    cargarMetricasDashboard();
    inicializarFormularioRegistro();
    cargarListaClientes();
    cargarDetalleCliente();
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




/* ===== INICIO BLOQUE NUEVO ===== */

// Guarda a dónde redirigir después de que el usuario cierre el comprobante
var comprobanteRedireccion = null;

function formatearValorComprobante(valor) {
    var num = Number(valor) || 0;
    return num.toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
}

function formatearFechaComprobante(fechaISO) {
    if (!fechaISO) return '';
    var partes = fechaISO.split('-');
    return partes[2] + '/' + partes[1] + '/' + partes[0];
}

function generarNumeroComprobante() {
    return 'CMP-' + Date.now();
}

function construirHtmlCorreoComprobante(d) {
    return ''
        + '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #eee;padding:24px;">'
        + '<h2 style="color:#222;margin-bottom:0;">DMR Comunicaciones</h2>'
        + '<p style="color:#888;margin-top:4px;">Comprobante de Pago</p>'
        + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">'
        + '<p><strong>N° Comprobante:</strong> ' + d.numero + '</p>'
        + '<p><strong>Cliente:</strong> ' + d.cliente + '</p>'
        + '<p><strong>Mes correspondiente:</strong> ' + d.mes + '</p>'
        + '<p><strong>Fecha de pago:</strong> ' + d.fechaTexto + '</p>'
        + '<p><strong>Método de pago:</strong> ' + d.metodo + '</p>'
        + '<p><strong>Valor pagado:</strong> ' + d.valorTexto + '</p>'
        + (d.observaciones ? '<p><strong>Observaciones:</strong> ' + d.observaciones + '</p>' : '')
        + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">'
        + '<p style="color:#888;font-size:12px;">Gracias por su pago. Este comprobante fue generado automáticamente, por favor no responda a este correo.</p>'
        + '</div>';
}

function enviarComprobantePorCorreo(d) {
    var estadoDiv = document.getElementById('comprobanteEstado');
    if (!d.correo) {
        if (estadoDiv) {
            estadoDiv.textContent = 'No se envió el correo: falta la dirección de correo del cliente.';
            estadoDiv.className = 'comprobante-estado error';
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
        observaciones: d.observaciones || 'N/A'
    };

    emailjs.send('service_ip7z7bm', 'template_6qy7dlv', parametros)
        .then(function () {
            if (estadoDiv) {
                estadoDiv.textContent = 'Comprobante enviado al correo del cliente.';
                estadoDiv.className = 'comprobante-estado ok';
            }
        })
        .catch(function (err) {
            console.error('Error enviando comprobante:', err);
            if (estadoDiv) {
                estadoDiv.textContent = 'No se pudo enviar el correo automáticamente. Puedes descargar el PDF y enviarlo manualmente.';
                estadoDiv.className = 'comprobante-estado error';
            }
        });
}

// Llamada desde inicializarFormularioPago() cuando el pago YA se guardó con éxito
function mostrarComprobantePago(pago, idCliente) {
    var overlayComprobante = document.getElementById('comprobanteOverlay');
    var estadoDiv = document.getElementById('comprobanteEstado');
    if (!overlayComprobante) return;

    var inputCorreo = document.getElementById('pagoCorreo');
    var correo = inputCorreo ? inputCorreo.value : '';

    var d = {
        numero: generarNumeroComprobante(),
        cliente: pago.clienteNombre || '',
        correo: correo,
        mes: pago.mes || '',
        fechaTexto: formatearFechaComprobante(pago.fechaPago),
        valorTexto: formatearValorComprobante(pago.valorPagado),
        metodo: pago.metodoPago || '',
        observaciones: pago.observaciones || ''
    };

    comprobanteRedireccion = 'perfilciente.html?id=' + idCliente;

    document.getElementById('cpNumero').textContent = d.numero;
    document.getElementById('cpCliente').textContent = d.cliente || '-';
    document.getElementById('cpCorreo').textContent = d.correo || '-';
    document.getElementById('cpMes').textContent = d.mes || '-';
    document.getElementById('cpFecha').textContent = d.fechaTexto || '-';
    document.getElementById('cpMetodo').textContent = d.metodo || '-';
    document.getElementById('cpValor').textContent = d.valorTexto || '-';

    var obsWrap = document.getElementById('cpObsWrap');
    if (d.observaciones) {
        document.getElementById('cpObs').textContent = d.observaciones;
        obsWrap.style.display = '';
    } else {
        obsWrap.style.display = 'none';
    }

    if (estadoDiv) {
        estadoDiv.textContent = 'Enviando comprobante al correo...';
        estadoDiv.className = 'comprobante-estado enviando';
    }
    overlayComprobante.style.display = 'flex';

    enviarComprobantePorCorreo(d);
}

// Se llama una vez al cargar cualquier página que tenga el formulario de pago
function inicializarComprobantePago() {

    if (typeof emailjs !== 'undefined') {
        emailjs.init('xRU1qjbLTZ678BVsg');
    }

    var inputFecha = document.getElementById('pagoFecha');
    if (inputFecha && !inputFecha.value) {
        inputFecha.valueAsDate = new Date();
    }

    var btnCerrar = document.getElementById('btnCerrarComprobante');
    if (btnCerrar) {
        btnCerrar.addEventListener('click', function () {
            document.getElementById('comprobanteOverlay').style.display = 'none';
            if (comprobanteRedireccion) window.location.href = comprobanteRedireccion;
        });
    }
    

    var btnImprimir = document.getElementById('btnImprimirComprobante');
    if (btnImprimir) {
        btnImprimir.addEventListener('click', function () {
            var contenido = document.getElementById('comprobanteContenido').innerHTML;
            var ventana = window.open('', '_blank', 'width=480,height=640');
            ventana.document.write(
                '<html><head><title>Comprobante de Pago</title><style>' +
                'body{font-family:Arial,sans-serif;padding:24px;color:#222;}' +
                'h2{margin-bottom:0;} .comprobante-subtitulo{color:#888;margin-top:4px;}' +
                '.comprobante-fila{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;}' +
                '.comprobante-footer{color:#888;font-size:12px;margin-top:16px;text-align:center;}' +
                '</style></head><body>' + contenido + '</body></html>'
            );
            ventana.document.close();
            ventana.focus();
            setTimeout(function () { ventana.print(); }, 300);
        });
    }

    var btnDescargar = document.getElementById('btnDescargarComprobante');
    if (btnDescargar) {
        btnDescargar.addEventListener('click', function () {
            var jsPDF = window.jspdf.jsPDF;
            var doc = new jsPDF();
            var y = 20;

            doc.setFontSize(16);
            doc.text('DMR Comunicaciones', 20, y); y += 7;
            doc.setFontSize(11);
            doc.setTextColor(120);
            doc.text('Comprobante de Pago', 20, y); y += 10;
            doc.setTextColor(30);
            doc.setLineWidth(0.2);
            doc.line(20, y, 190, y); y += 10;

            var filas = [
                ['N° Comprobante', document.getElementById('cpNumero').textContent],
                ['Cliente', document.getElementById('cpCliente').textContent],
                ['Correo', document.getElementById('cpCorreo').textContent],
                ['Mes correspondiente', document.getElementById('cpMes').textContent],
                ['Fecha de pago', document.getElementById('cpFecha').textContent],
                ['Método de pago', document.getElementById('cpMetodo').textContent],
                ['Valor pagado', document.getElementById('cpValor').textContent]
            ];

            if (document.getElementById('cpObsWrap').style.display !== 'none') {
                filas.push(['Observaciones', document.getElementById('cpObs').textContent]);
            }

            doc.setFontSize(11);
            filas.forEach(function (fila) {
                doc.setFont(undefined, 'bold');
                doc.text(fila[0] + ':', 20, y);
                doc.setFont(undefined, 'normal');
                doc.text(String(fila[1] || '-'), 90, y);
                y += 9;
            });

            y += 5;
            doc.setLineWidth(0.2);
            doc.line(20, y, 190, y); y += 8;
            doc.setFontSize(9);
            doc.setTextColor(140);
            doc.text('Gracias por su pago. Comprobante generado automáticamente.', 20, y);

            var nombreArchivo = 'comprobante_' + document.getElementById('cpNumero').textContent + '.pdf';
            doc.save(nombreArchivo);
        });
    }
}

/* ===== FIN BLOQUE NUEVO ===== */