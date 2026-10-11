/* ============================================================
   DMR COMUNICACIONES - funciones.js
   Script único compartido por todas las ventanas.

   ------------------------------------------------------------
   FACTURACIÓN: cada cliente tiene una cuota mensual fija
   (valorMensual) y una fecha de inicio (fechaInicio). Se factura
   automáticamente una cuota por cada mes-calendario transcurrido
   desde esa fecha, así no se haya registrado ningún pago. La
   deuda (saldoPendiente) se calcula EN VIVO cada vez que se
   muestra un cliente: totalFacturado - totalPagado.

   ROLES: cada usuario tiene un documento en la colección
   "usuarios" (id = su UID de Firebase Auth) con un campo "rol":
   "administrador" o "empleado". El rol se usa para ocultar
   botones que ese usuario no puede usar (aplicarPermisosPorRol),
   pero la protección REAL está en las Firestore Security Rules
   (ver el bloque de reglas que se entrega aparte).

   VALIDACIÓN: antes de guardar cualquier formulario, se revisan
   los campos con expresiones regulares (nombre, documento,
   teléfono, correo, valores numéricos, fechas) para rechazar
   datos claramente inválidos o con caracteres peligrosos (< >)
   antes de que lleguen a Firestore.

   REGISTRO DE ACTIVIDADES: cada vez que se crea un cliente, se
   registra un pago o se elimina un cliente, se guarda un
   documento en la colección "actividad" con quién lo hizo, qué
   hizo y cuándo.

   PROTECCIÓN XSS: todo texto que viene de Firestore y se inserta
   con innerHTML pasa primero por escaparHTML().
   ============================================================ */

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
    const overlay = document.createElement("div");
    overlay.className = "spinner-global-overlay";
    overlay.innerHTML = '<div class="spinner-global-circulo"></div><div class="spinner-global-texto" id="spinnerGlobalTexto">Cargando...</div>';
    document.body.appendChild(overlay);

    let contadorProcesos = 0;

    window.mostrarCargandoGlobal = function (mensaje) {
        contadorProcesos++;
        document.getElementById("spinnerGlobalTexto").textContent = mensaje || "Cargando...";
        overlay.classList.add("visible");
    };

    window.ocultarCargandoGlobal = function () {
        contadorProcesos = Math.max(0, contadorProcesos - 1);
        if (contadorProcesos === 0) overlay.classList.remove("visible");
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

// ============================================================
// 2) UTILIDADES
// ============================================================
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

// Convierte cualquier texto a una versión segura para insertar con
// innerHTML, neutralizando etiquetas HTML que pudiera contener.
// Úsalo SIEMPRE que insertes con innerHTML un dato que venga de
// Firestore (nombre, dirección, mes, observaciones, etc.).
function escaparHTML(texto) {
    const div = document.createElement("div");
    div.textContent = String(texto == null ? "" : texto);
    return div.innerHTML;
}

// ============================================================
// FACTURACIÓN AUTOMÁTICA
// ============================================================
function calcularMesesTranscurridos(fechaInicioStr) {
    if (!fechaInicioStr) return 0;
    const inicio = new Date(fechaInicioStr + "T00:00:00");
    if (isNaN(inicio.getTime())) return 0;
    const hoy = new Date();
    const meses = (hoy.getFullYear() - inicio.getFullYear()) * 12 + (hoy.getMonth() - inicio.getMonth()) + 1;
    return Math.max(1, meses);
}
function calcularFacturacionCliente(c) {
    const cuota = Number(c.valorMensual) || 0;
    const mesesTranscurridos = calcularMesesTranscurridos(c.fechaInicio);
    const totalFacturado = cuota * mesesTranscurridos;
    const totalPagado = Number(c.totalPagado) || 0;
    const saldoPendiente = Math.max(0, totalFacturado - totalPagado);
    const estado = saldoPendiente > 0 ? "pendiente" : "activo";
    return { mesesTranscurridos, totalFacturado, totalPagado, saldoPendiente, estado };
}

// ============================================================
// ROLES Y PERMISOS EN LA INTERFAZ
// ------------------------------------------------------------
// cargarRolUsuarioActual: busca en "usuarios/{uid}" el rol del
// usuario logueado. Si no existe el documento, asume "empleado"
// (el rol con MENOS permisos) por seguridad.
// aplicarPermisosPorRol: oculta cualquier elemento con el
// atributo data-solo-admin si el usuario no es administrador.
// Esto es solo cosmético/UX; la protección real está en las
// Firestore Security Rules.
// ============================================================


let rolUsuarioActual = null;
let nombreUsuarioActual = "";

function cargarRolUsuarioActual() {
    if (!auth.currentUser) return Promise.resolve(null);
    return db.collection("usuarios").doc(auth.currentUser.uid).get()
        .then(function (doc) {
            const d = doc.exists ? doc.data() : {};
            rolUsuarioActual = d.rol || "empleado";
            nombreUsuarioActual = d.nombre || "";
            return rolUsuarioActual;
        })
        .catch(function () {
            rolUsuarioActual = "empleado";
            return rolUsuarioActual;
        });
}

function mostrarSaludo() {
    const h = document.getElementById("saludoUsuario");
    if (!h) return;
    h.textContent = (rolUsuarioActual === "administrador" && nombreUsuarioActual)
        ? "Bienvenido, " + nombreUsuarioActual
        : "Bienvenido";
}

function aplicarPermisosPorRol() {
    const esAdmin = rolUsuarioActual === "administrador";
    document.querySelectorAll("[data-solo-admin]").forEach(function (el) {
        el.style.display = esAdmin ? "" : "none";
    });
}

// ============================================================
// VALIDACIÓN DE FORMULARIOS
// ------------------------------------------------------------
// Cada función revisa un tipo de dato y devuelve true/false.
// Se usan antes de guardar en Firestore, tanto para evitar datos
// mal formados como para bloquear caracteres "< >" que podrían
// usarse para intentar inyectar HTML/scripts.
// ============================================================
function validarTexto(valor, minLen, maxLen) {
    const t = (valor || "").trim();
    return t.length >= minLen && t.length <= maxLen && !/[<>]/.test(t);
}
function validarNombre(valor) {
    return /^[A-Za-zÁÉÍÓÚáéíóúÑñ .'-]{3,80}$/.test((valor || "").trim());
}
function validarDocumento(valor) {
    const t = (valor || "").trim();
    if (t === "") return true; // documento es opcional
    return /^[0-9]{5,15}$/.test(t);
}
function validarTelefono(valor) {
    return /^[0-9+()\s-]{7,15}$/.test((valor || "").trim());
}
function validarCorreo(valor) {
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test((valor || "").trim());
}
function validarValorMonetario(valor) {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0 && n <= 50000000; // tope de seguridad razonable
}
function validarFecha(valor) {
    if (!valor) return false;
    const f = new Date(valor + "T00:00:00");
    return !isNaN(f.getTime());
}

// ============================================================
// REGISTRO DE ACTIVIDADES
// ------------------------------------------------------------
// Guarda en la colección "actividad" quién hizo qué y cuándo.
// No detiene el flujo si falla (solo lo avisa en consola), para
// que un problema de permisos en el log no bloquee la operación
// principal (guardar el cliente/pago sí es lo importante).
// ============================================================
function registrarActividad(accion, detalle) {
    try {
        return db.collection("actividad").add({
            usuario: (auth.currentUser && auth.currentUser.email) || "desconocido",
            uid: (auth.currentUser && auth.currentUser.uid) || "",
            accion: accion,
            detalle: detalle || "",
            fecha: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function (err) { console.error("No se pudo registrar la actividad:", err); });
    } catch (err) {
        console.error("No se pudo registrar la actividad:", err);
        return Promise.resolve();
    }
}

// Pinta la tabla de actividad reciente, si la página tiene un
// elemento con id="tablaActividad" (por ahora ninguna página lo
// tiene todavía; ver instrucciones aparte para agregarlo).
let cacheActividad = [];

function cargarRegistroActividades() {
    const tbody = document.getElementById("tablaActividad");
    if (!tbody || rolUsuarioActual !== "administrador") return;
    mostrarCargando(tbody, "Cargando actividad...");
    const filtro = document.getElementById("filtroActividadUsuario");

    db.collection("actividad").orderBy("fecha", "desc").limit(500).get()
        .then(function (snapshot) {
            cacheActividad = [];
            snapshot.forEach(function (doc) { cacheActividad.push(doc.data()); });
            if (filtro) {
                const usuarios = Array.from(new Set(cacheActividad.map(function (a) { return a.usuario || "desconocido"; }))).sort();
                filtro.innerHTML = '<option value="">Todos los usuarios</option>' +
                    usuarios.map(function (u) { return '<option value="' + escaparHTML(u) + '">' + escaparHTML(u) + "</option>"; }).join("");
                filtro.onchange = pintarActividad;
            }
            pintarActividad();
        })
        .catch(function (err) {
            tbody.innerHTML = '<tr><td colspan="4">Error al cargar actividad: ' + escaparHTML(err.message) + "</td></tr>";
        });
}

function pintarActividad() {
    const tbody = document.getElementById("tablaActividad");
    const filtro = document.getElementById("filtroActividadUsuario");
    if (!tbody) return;
    const usuario = filtro ? filtro.value : "";
    const lista = cacheActividad.filter(function (a) { return !usuario || (a.usuario || "desconocido") === usuario; });
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="4">Sin actividad registrada</td></tr>'; return; }
    tbody.innerHTML = lista.map(function (a) {
        const fechaTexto = a.fecha && a.fecha.toDate ? a.fecha.toDate().toLocaleString("es-CO") : "-";
        return `<tr>
            <td>${escaparHTML(a.usuario)}</td>
            <td>${escaparHTML(a.accion)}</td>
            <td>${escaparHTML(a.detalle)}</td>
            <td>${escaparHTML(fechaTexto)}</td>
        </tr>`;
    }).join("");
}

// ============================================================
// 3) LOGIN
// ============================================================
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

        if (!validarCorreo(email)) {
            errorEl.textContent = "Ingresa un correo válido.";
            return;
        }

        btn.disabled = true;
        btn.textContent = "Ingresando...";
        auth.signInWithEmailAndPassword(email, password)
        .then(function () {
            sessionStorage.setItem("registrarLogin", "1");
            window.location.href = "incio.html";
        })
            .catch(function (err) {
                errorEl.textContent = traducirErrorFirebase(err.code);
                btn.disabled = false;
                btn.textContent = "Ingresar";
            });
    });
}

// ============================================================
// 4) CERRAR SESIÓN
// ============================================================
function inicializarLogout() {
    document.querySelectorAll(".sidebar-footer").forEach(function (el) {
        el.addEventListener("click", function () {
            registrarActividad("Cerró sesión", "")
                .then(function () { return auth.signOut(); })
                .then(function () { window.location.href = "index.html"; });
        });
    });
}

// ============================================================
// 5) REGISTRAR CLIENTE
// ------------------------------------------------------------
// Antes de guardar, valida cada campo. Si algo no pasa, muestra
// un mensaje específico (no un genérico "completa los campos")
// y no continúa. Al guardar con éxito, registra la actividad.
// ============================================================
function inicializarFormularioRegistro() {
    const form = document.getElementById("formRegistro");
    if (!form) return;
    const btnLimpiar = document.getElementById("btnLimpiar");
    if (btnLimpiar) btnLimpiar.addEventListener("click", function () { form.reset(); });

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        const correo = document.getElementById("correo").value.trim();
        const nombre = document.getElementById("nombre").value.trim();
        const direccion = document.getElementById("direccion").value.trim();
        const telefono = document.getElementById("telefono").value.trim();
        const tipoServicio = document.getElementById("tipoServicio").value;
        const plan = document.getElementById("plan").value.trim();
        const valorMensual = document.getElementById("valorMensual").value;
        const fechaInicio = document.getElementById("fechaInicio").value;
        const duracionContrato = document.getElementById("duracionContrato").value;
        const documento = document.getElementById("documento").value.trim();
        const observaciones = document.getElementById("observaciones").value.trim();

        if (!validarNombre(nombre)) { alert("El nombre debe tener entre 3 y 80 letras (sin números ni símbolos raros)."); return; }
        if (!validarTexto(direccion, 4, 120)) { alert("La dirección debe tener entre 4 y 120 caracteres, sin los símbolos < >."); return; }
        if (!validarTelefono(telefono)) { alert("El teléfono debe tener entre 7 y 15 dígitos (puede incluir +, espacios o guiones)."); return; }
        if (!validarCorreo(correo)) { alert("Ingresa un correo electrónico válido para el cliente."); return; }
        if (!tipoServicio) { alert("Selecciona un tipo de servicio."); return; }
        if (!validarValorMonetario(valorMensual)) { alert("El valor mensual debe ser un número mayor a 0."); return; }
        if (!validarFecha(fechaInicio)) { alert("La fecha de inicio no es válida."); return; }
        if (!validarDocumento(documento)) { alert("El documento debe tener entre 5 y 15 dígitos (solo números)."); return; }
        if (plan && !validarTexto(plan, 0, 80)) { alert("El plan no puede contener los símbolos < >."); return; }
        if (observaciones && !validarTexto(observaciones, 0, 500)) { alert("Las observaciones no pueden superar 500 caracteres ni contener los símbolos < >."); return; }

        const datos = {
            nombre: nombre,
            direccion: direccion,
            telefono: telefono,
            correo: correo,
            tipoServicio: tipoServicio,
            plan: plan,
            valorMensual: Number(valorMensual) || 0,
            fechaInicio: fechaInicio,
            duracionContrato: duracionContrato,
            documento: documento,
            observaciones: observaciones,
            estado: "activo",
            totalFacturado: 0,
            totalPagado: 0,
            saldoPendiente: 0,
            creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        };

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Guardando...";

        db.collection("clientes").add(datos)
            .then(function (ref) {
                registrarActividad("Registró cliente", nombre + " (id: " + ref.id + ")");
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

// ============================================================
// 6) LISTA DE CLIENTES
// ============================================================
let cacheClientes = [];
function cargarListaClientes() {
    const tbody = document.getElementById("tablaClientesBody");
    if (!tbody) return;
    mostrarCargando(tbody, "Cargando clientes...");
    db.collection("clientes").orderBy("nombre").get()
        .then(function (snapshot) {
            cacheClientes = [];
            snapshot.forEach(function (doc) { cacheClientes.push(Object.assign({ id: doc.id }, doc.data())); });
            renderizarClientes(cacheClientes);
        })
        .catch(function (err) { mostrarCargando(tbody, "Error al cargar clientes: " + err.message); });
    const buscador = document.getElementById("buscarCliente");
    if (buscador) buscador.addEventListener("input", filtrarClientes);
}
function renderizarClientes(lista) {
    const tbody = document.getElementById("tablaClientesBody");
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="7">No hay clientes registrados</td></tr>'; return; }
    tbody.innerHTML = lista.map(function (c) {
        const factura = calcularFacturacionCliente(c);
        const esPendiente = factura.estado === "pendiente";
        return `<tr>
            <td>${escaparHTML(c.nombre)}</td>
            <td>${escaparHTML(c.direccion || "")}</td>
            <td>${escaparHTML(c.telefono || "")}</td>
            <td>${escaparHTML(c.tipoServicio || "")}</td>
            <td>${formatearMoneda(c.valorMensual)}</td>
            <td><span class="status-badge ${esPendiente ? "pending" : "active"}">${esPendiente ? "Pendiente" : "Al día"}</span></td>
            <td><button class="btn-action-sm" onclick="location.href='perfilciente.html?id=${c.id}'">Ver perfil</button></td>
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

// ============================================================
// 7) DETALLE DE CLIENTE
// ============================================================
function cargarDetalleCliente() {
    const el = document.getElementById("detalleNombre");
    if (!el) return;
    const id = obtenerParametroURL("id");
    if (!id) { alert("No se especificó ningún cliente"); window.location.href = "listacliente.html"; return; }
    db.collection("clientes").doc(id).get().then(function (doc) {
        if (!doc.exists) { alert("Cliente no encontrado"); window.location.href = "listacliente.html"; return; }
        const c = doc.data();
        const factura = calcularFacturacionCliente(c);
        const esPendiente = factura.estado === "pendiente";
        document.getElementById("detalleNombre").textContent = c.nombre;
        const estadoEl = document.getElementById("detalleEstado");
        estadoEl.textContent = esPendiente ? "Pendiente" : "Al día";
        estadoEl.className = "status-badge " + (esPendiente ? "pending" : "active");
        document.getElementById("detalleDocumento").textContent = c.documento || "N/A";
        document.getElementById("detalleTelefono").textContent = c.telefono || "N/A";
        document.getElementById("detalleDireccion").textContent = c.direccion || "N/A";
        document.getElementById("detalleServicio").textContent = c.tipoServicio || "N/A";
        document.getElementById("detalleValorMensual").textContent = formatearMoneda(c.valorMensual);
        document.getElementById("resumenTotalFacturado").textContent = formatearMoneda(factura.totalFacturado);
        document.getElementById("resumenTotalPagado").textContent = formatearMoneda(factura.totalPagado);
        document.getElementById("resumenSaldoPendiente").textContent = formatearMoneda(factura.saldoPendiente);
        document.querySelectorAll('[id="btnActualizarPago"]').forEach(function (btnPago) {
            btnPago.onclick = function () { location.href = "actualizarpago.html?id=" + id; };
        });
        cargarHistorialPagos(id);
    });
}
function cargarHistorialPagos(id) {
    const tbody = document.getElementById("tablaPagosBody");
    if (!tbody) return;
    db.collection("clientes").doc(id).collection("pagos").orderBy("fechaPago", "desc").get()
        .then(function (snapshot) {
            if (snapshot.empty) { tbody.innerHTML = '<tr><td colspan="4">Sin pagos registrados</td></tr>'; return; }
            tbody.innerHTML = "";
            snapshot.forEach(function (doc) {
                const p = doc.data();
                tbody.innerHTML += `<tr>
                    <td>${escaparHTML(p.mes)}</td>
                    <td>${formatearMoneda(p.valorPagado)}</td>
                    <td>${escaparHTML(p.fechaPago)}</td>
                    <td><span class="status-badge active">Abono registrado</span></td>
                </tr>`;
            });
        });
}

// ============================================================
// 8) ACTUALIZAR PAGO
// ============================================================
function inicializarFormularioPago() {
    const form = document.getElementById("formPago");
    if (!form) return;
    const id = obtenerParametroURL("id");
    if (!id) { alert("No se especificó ningún cliente"); window.location.href = "listacliente.html"; return; }
    const btnCancelar = document.getElementById("btnCancelarPago");
    if (btnCancelar) btnCancelar.onclick = function () { location.href = "perfilciente.html?id=" + id; };

    let nombreClienteActual = "";
    let cuotaMensualActual = 0;
    let fechaInicioActual = "";
    let correoClienteActual = "";
    let pagoGuardadoId = null; // si no es null, el próximo guardado EDITA ese pago (solo admin)
    const clienteRef = db.collection("clientes").doc(id);
    clienteRef.get().then(function (doc) {
        if (doc.exists) {
            const c = doc.data();
            nombreClienteActual = c.nombre || "";
            cuotaMensualActual = Number(c.valorMensual) || 0;
            fechaInicioActual = c.fechaInicio || "";
            correoClienteActual = c.correo || "";
            const elNombre = document.getElementById("pagoClienteNombre");
            if (elNombre) elNombre.textContent = nombreClienteActual;
        }
    });

    // Botón "Editar pago" del comprobante (solo administrador)
    const btnEditarRecibo = document.getElementById("btnEditarComprobante");
    if (btnEditarRecibo) btnEditarRecibo.addEventListener("click", function () {
        if (rolUsuarioActual !== "administrador") return;
        document.getElementById("comprobanteOverlay").style.display = "none";
        const btnGuardar = form.querySelector("button[type=submit]");
        btnGuardar.disabled = false;
        btnGuardar.textContent = "Actualizar Pago y Recibo";
    });

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        const mes = document.getElementById("pagoMes").value.trim();
        const fechaPago = document.getElementById("pagoFecha").value;
        const valorPagado = document.getElementById("pagoValor").value;
        const metodoPago = document.getElementById("pagoMetodo").value;
        const observaciones = document.getElementById("pagoObservaciones").value.trim();

        if (!validarTexto(mes, 3, 30)) { alert("El campo Mes debe tener entre 3 y 30 caracteres, sin los símbolos < >."); return; }
        if (!validarFecha(fechaPago)) { alert("La fecha de pago no es válida."); return; }
        if (!validarValorMonetario(valorPagado)) { alert("El valor pagado debe ser un número mayor a 0."); return; }
        if (observaciones && !validarTexto(observaciones, 0, 500)) { alert("Las observaciones no pueden superar 500 caracteres ni contener los símbolos < >."); return; }

        const esEdicion = !!pagoGuardadoId;
        if (esEdicion && rolUsuarioActual !== "administrador") { alert("Solo el administrador puede editar un pago."); return; }

        const abono = {
            clienteId: id,
            clienteNombre: nombreClienteActual,
            mes: mes,
            fechaPago: fechaPago,
            valorPagado: Number(valorPagado) || 0,
            metodoPago: metodoPago,
            observaciones: observaciones,
            registradoEn: firebase.firestore.FieldValue.serverTimestamp()
        };

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Guardando...";

        let saldoTotalDespuesDelPago = 0;
        const pagosRef = clienteRef.collection("pagos");

        const operacion = esEdicion
            ? pagosRef.doc(pagoGuardadoId).update({
                mes: mes,
                fechaPago: fechaPago,
                valorPagado: Number(valorPagado) || 0,
                metodoPago: metodoPago,
                observaciones: observaciones,
                editadoEn: firebase.firestore.FieldValue.serverTimestamp(),
                editadoPor: (auth.currentUser && auth.currentUser.email) || ""
            })
            : pagosRef.add(abono);

        operacion
            .then(function (res) {
                if (!esEdicion && res) pagoGuardadoId = res.id;
                return pagosRef.get();
            })
            .then(function (snapshotPagos) {
                let totalPagadoGeneral = 0;
                snapshotPagos.forEach(function (docPago) { totalPagadoGeneral += Number(docPago.data().valorPagado) || 0; });
                const factura = calcularFacturacionCliente({ valorMensual: cuotaMensualActual, fechaInicio: fechaInicioActual, totalPagado: totalPagadoGeneral });
                saldoTotalDespuesDelPago = factura.saldoPendiente;
                return clienteRef.update({
                    totalFacturado: factura.totalFacturado,
                    totalPagado: factura.totalPagado,
                    saldoPendiente: factura.saldoPendiente,
                    estado: factura.estado
                });
            })
            .then(function () {
                registrarActividad(
                    esEdicion ? "Editó pago" : "Registró pago",
                    nombreClienteActual + " - " + mes + " - " + formatearMoneda(valorPagado)
                );
                if (document.getElementById('comprobanteOverlay')) {
                    mostrarComprobantePago(abono, id, cuotaMensualActual, saldoTotalDespuesDelPago, correoClienteActual);
                } else {
                    alert("Pago registrado correctamente");
                    window.location.href = "perfilciente.html?id=" + id;
                }
            })
            .catch(function (err) {
                alert("Error al guardar el pago: " + err.message);
                btn.disabled = false;
                btn.textContent = esEdicion ? "Actualizar Pago y Recibo" : "Guardar Pago";
            });
    });
}
// ============================================================
// 9) DASHBOARD
// ============================================================
function cargarMetricasDashboard() {
    const el = document.getElementById("metricTotalClientes");
    if (!el) return;
    db.collection("clientes").get().then(function (snapshot) {
        let pendientes = 0, activos = 0;
        snapshot.forEach(function (doc) {
            const factura = calcularFacturacionCliente(doc.data());
            if (factura.estado === "pendiente") pendientes++; else activos++;
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
    }).catch(function () { document.getElementById("metricPagosMes").textContent = formatearMoneda(0); });
    const tbody = document.getElementById("tablaRecientes");
    if (tbody) {
        db.collection("clientes").orderBy("creadoEn", "desc").limit(5).get().then(function (snapshot) {
            if (snapshot.empty) { tbody.innerHTML = '<tr><td colspan="3">Sin registros</td></tr>'; return; }
            tbody.innerHTML = "";
            snapshot.forEach(function (doc) {
                const c = doc.data();
                tbody.innerHTML += `<tr><td>${escaparHTML(c.nombre)}</td><td>${escaparHTML(c.tipoServicio || "")}</td><td>${formatearMoneda(c.valorMensual)}</td></tr>`;
            });
        });
    }
}

// ============================================================
// 9b) HISTORIAL GENERAL DE PAGOS
// ============================================================
function cargarListaPagos() {
    const tbody = document.getElementById("tablaPagosGeneral");
    if (!tbody) return;
    mostrarCargando(tbody, "Cargando pagos...");
    db.collectionGroup("pagos").get().then(function (snapshot) {
        if (snapshot.empty) { tbody.innerHTML = '<tr><td colspan="6">Sin pagos registrados</td></tr>'; return; }
        const pagos = [];
        snapshot.forEach(function (doc) {
            const p = doc.data();
            pagos.push({ clienteId: p.clienteId || doc.ref.parent.parent.id, clienteNombre: p.clienteNombre || "N/A", mes: p.mes || "", valorPagado: p.valorPagado || 0, fechaPago: p.fechaPago || "", metodoPago: p.metodoPago || "" });
        });
        pagos.sort(function (a, b) { return (b.fechaPago || "").localeCompare(a.fechaPago || ""); });
        tbody.innerHTML = pagos.map(function (p) {
            return `<tr>
                <td>${escaparHTML(p.clienteNombre)}</td>
                <td>${escaparHTML(p.mes)}</td>
                <td>${formatearMoneda(p.valorPagado)}</td>
                <td>${escaparHTML(p.fechaPago)}</td>
                <td>${escaparHTML(p.metodoPago)}</td>
                <td><button class="btn-action-sm" onclick="location.href='perfilciente.html?id=${p.clienteId}'">👁️</button></td>
            </tr>`;
        }).join("");
    }).catch(function (err) { tbody.innerHTML = '<tr><td colspan="6">Error al cargar pagos: ' + err.message + "</td></tr>"; });
}

// ============================================================
// 9c) REPORTES
// ============================================================
function cargarReportes() {
    const tabla = document.getElementById("tablaReportesMeses");
    const elPendientes = document.getElementById("reportePendientes");
    if (!tabla && !elPendientes) return;
    if (elPendientes) {
        db.collection("clientes").get().then(function (snapshot) {
            let pendientes = 0;
            snapshot.forEach(function (doc) { if (calcularFacturacionCliente(doc.data()).estado === "pendiente") pendientes++; });
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
            if (!meses.length) { tabla.innerHTML = '<tr><td colspan="2">Sin pagos registrados</td></tr>'; return; }
            tabla.innerHTML = meses.map(function (m) { return `<tr><td>${escaparHTML(m)}</td><td>${formatearMoneda(porMes[m])}</td></tr>`; }).join("");
        }).catch(function (err) { tabla.innerHTML = '<tr><td colspan="2">Error: ' + err.message + "</td></tr>"; });
    }
}

// ============================================================
// 9d) EXPORTAR A EXCEL Y PDF
// ============================================================
function inicializarExportaciones() {
    const select = document.getElementById("exportClienteSelect");
    if (!select) return;
    db.collection("clientes").orderBy("nombre").get().then(function (snapshot) {
        select.innerHTML = '<option value="">Selecciona un cliente</option>';
        snapshot.forEach(function (doc) { select.innerHTML += `<option value="${doc.id}">${escaparHTML(doc.data().nombre)}</option>`; });
    });
    const btnTodosExcel = document.getElementById("btnExportarTodosExcel");
    if (btnTodosExcel) btnTodosExcel.addEventListener("click", exportarTodosClientesExcel);
    const btnTodosPDF = document.getElementById("btnExportarTodosPDF");
    if (btnTodosPDF) btnTodosPDF.addEventListener("click", exportarTodosClientesPDF);
    const btnClienteExcel = document.getElementById("btnExportarClienteExcel");
    if (btnClienteExcel) btnClienteExcel.addEventListener("click", exportarClienteExcel);
    const btnClientePDF = document.getElementById("btnExportarClientePDF");
    if (btnClientePDF) btnClientePDF.addEventListener("click", exportarClientePDF);
    ["btnExportarTodosExcel", "btnExportarTodosPDF", "btnExportarClienteExcel", "btnExportarClientePDF"].forEach(function (idBtn) {
        const b = document.getElementById(idBtn);
        if (b) b.addEventListener("click", function () { registrarActividad("Exportó datos", idBtn); });
    });
}
function filaClienteParaExportar(c) {
    const factura = calcularFacturacionCliente(c);
    return {
        Nombre: c.nombre || "", Documento: c.documento || "", Direccion: c.direccion || "", Telefono: c.telefono || "",
        Servicio: c.tipoServicio || "", Plan: c.plan || "", ValorMensual: c.valorMensual || 0,
        Estado: factura.estado === "pendiente" ? "Pendiente" : "Al día",
        TotalFacturado: factura.totalFacturado, TotalPagado: factura.totalPagado, SaldoPendiente: factura.saldoPendiente,
        FechaInicio: c.fechaInicio || "", DuracionContrato: c.duracionContrato || ""
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
            const factura = calcularFacturacionCliente(c);
            filas.push([c.nombre || "", c.telefono || "", c.direccion || "", c.tipoServicio || "", formatearMoneda(c.valorMensual), factura.estado === "pendiente" ? "Pendiente" : "Al día"]);
        });
        const doc = new window.jspdf.jsPDF();
        doc.setFontSize(14);
        doc.text("DMR Comunicaciones - Listado de Clientes", 14, 15);
        doc.setFontSize(9);
        doc.text("Generado: " + new Date().toLocaleString("es-CO"), 14, 21);
        doc.autoTable({ startY: 26, head: [["Nombre", "Teléfono", "Dirección", "Servicio", "Valor mes", "Estado"]], body: filas, styles: { fontSize: 8 } });
        doc.save("clientes_DMR.pdf");
    }).catch(function (err) { alert("Error al exportar: " + err.message); });
}
function obtenerClienteYPagosParaExportar(id) {
    const clienteRef = db.collection("clientes").doc(id);
    return Promise.all([clienteRef.get(), clienteRef.collection("pagos").orderBy("fechaPago", "desc").get()]);
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
        const factura = calcularFacturacionCliente(c);
        const doc = new window.jspdf.jsPDF();
        doc.setFontSize(14);
        doc.text("DMR Comunicaciones - Ficha de Cliente", 14, 15);
        doc.setFontSize(11);
        let y = 25;
        [
            "Nombre: " + (c.nombre || ""), "Documento: " + (c.documento || "N/A"), "Teléfono: " + (c.telefono || ""),
            "Dirección: " + (c.direccion || ""), "Servicio: " + (c.tipoServicio || "") + (c.plan ? " - " + c.plan : ""),
            "Valor mensual: " + formatearMoneda(c.valorMensual), "Estado: " + (factura.estado === "pendiente" ? "Pendiente" : "Al día"),
            "Total facturado: " + formatearMoneda(factura.totalFacturado), "Total pagado: " + formatearMoneda(factura.totalPagado),
            "Saldo pendiente: " + formatearMoneda(factura.saldoPendiente)
        ].forEach(function (linea) { doc.text(linea, 14, y); y += 7; });
        const filasPagos = [];
        pagosSnap.forEach(function (pDoc) {
            const p = pDoc.data();
            filasPagos.push([p.mes || "", formatearMoneda(p.valorPagado), p.fechaPago || "", p.metodoPago || ""]);
        });
        doc.autoTable({ startY: y + 5, head: [["Mes", "Valor", "Fecha de pago", "Método"]], body: filasPagos.length ? filasPagos : [["Sin pagos registrados", "", "", ""]], styles: { fontSize: 9 } });
        doc.save("cliente_" + (c.nombre || "cliente").replace(/\s+/g, "_") + ".pdf");
    }).catch(function (err) { alert("Error al exportar: " + err.message); });
}

// ============================================================
// COMPROBANTE DE PAGO
// ============================================================
var comprobanteRedireccion = null;
var comprobanteNumeroActual = null; // se conserva el N° al editar el recibo
function formatearValorComprobante(valor) {
    return (Number(valor) || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 });
}
function formatearFechaComprobante(fechaISO) {
    if (!fechaISO) return '';
    const partes = fechaISO.split('-');
    return partes[2] + '/' + partes[1] + '/' + partes[0];
}
function generarNumeroComprobante() { return 'CMP-' + Date.now(); }
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
        + '<p><strong>Cuota mensual:</strong> ' + d.cuotaTexto + '</p>'
        + '<p><strong>Abono recibido:</strong> ' + d.abonoTexto + '</p>'
        + '<p><strong>Saldo pendiente total:</strong> ' + d.saldoTexto + '</p>'
        + (d.observaciones ? '<p><strong>Observaciones:</strong> ' + d.observaciones + '</p>' : '')
        + '<hr style="border:none;border-top:1px solid #eee;margin:16px 0;">'
        + '<p style="color:#888;font-size:12px;">Gracias por su pago. Este comprobante fue generado automáticamente, por favor no responda a este correo.</p>'
        + '</div>';
}
function enviarComprobantePorCorreo(d) {
    var estadoDiv = document.getElementById('comprobanteEstado');
    if (!d.correo) {
        if (estadoDiv) { estadoDiv.textContent = 'No se envió el correo: este cliente no tiene correo registrado. El administrador puede agregarlo en "Editar datos del cliente".'; estadoDiv.className = 'comprobante-estado error'; }
        return;
    }
    var parametros = { to_email: d.correo, numero: d.numero, cliente: d.cliente, mes: d.mes, fecha: d.fechaTexto, metodo: d.metodo, cuota: d.cuotaTexto, valor: d.abonoTexto, saldo: d.saldoTexto, observaciones: d.observaciones || 'N/A' };
    emailjs.send('service_ip7z7bm', 'template_6qy7dlv', parametros)
        .then(function () { if (estadoDiv) { estadoDiv.textContent = 'Comprobante enviado al correo del cliente.'; estadoDiv.className = 'comprobante-estado ok'; } })
        .catch(function (err) {
            console.error('Error enviando comprobante:', err);
            if (estadoDiv) { estadoDiv.textContent = 'No se pudo enviar el correo automáticamente. Puedes descargar el PDF y enviarlo manualmente.'; estadoDiv.className = 'comprobante-estado error'; }
        });
}
function mostrarComprobantePago(pago, idCliente, cuotaMensual, saldoTotal, correoCliente) {
    var overlayComprobante = document.getElementById('comprobanteOverlay');
    var estadoDiv = document.getElementById('comprobanteEstado');
    if (!overlayComprobante) return;
    if (!comprobanteNumeroActual) comprobanteNumeroActual = generarNumeroComprobante();
    var d = {
        numero: comprobanteNumeroActual, cliente: pago.clienteNombre || '', correo: correoCliente || '', mes: pago.mes || '',
        fechaTexto: formatearFechaComprobante(pago.fechaPago), abonoTexto: formatearValorComprobante(pago.valorPagado),
        cuotaTexto: formatearValorComprobante(cuotaMensual), saldoTexto: formatearValorComprobante(saldoTotal),
        metodo: pago.metodoPago || '', observaciones: pago.observaciones || ''
    };
    comprobanteRedireccion = 'perfilciente.html?id=' + idCliente;
    document.getElementById('cpNumero').textContent = d.numero;
    document.getElementById('cpCliente').textContent = d.cliente || '-';
    document.getElementById('cpCorreo').textContent = d.correo || '-';
    document.getElementById('cpMes').textContent = d.mes || '-';
    document.getElementById('cpFecha').textContent = d.fechaTexto || '-';
    document.getElementById('cpMetodo').textContent = d.metodo || '-';
    var elCuota = document.getElementById('cpCuota'); if (elCuota) elCuota.textContent = d.cuotaTexto;
    document.getElementById('cpValor').textContent = d.abonoTexto;
    var elSaldo = document.getElementById('cpSaldo'); if (elSaldo) elSaldo.textContent = d.saldoTexto;
    var obsWrap = document.getElementById('cpObsWrap');
    if (d.observaciones) { document.getElementById('cpObs').textContent = d.observaciones; obsWrap.style.display = ''; }
    else { obsWrap.style.display = 'none'; }
    if (estadoDiv) { estadoDiv.textContent = 'Enviando comprobante al correo...'; estadoDiv.className = 'comprobante-estado enviando'; }
    overlayComprobante.style.display = 'flex';
    enviarComprobantePorCorreo(d);
}
function inicializarComprobantePago() {
    if (typeof emailjs !== 'undefined') emailjs.init('xRU1qjbLTZ678BVsg');
    var inputFecha = document.getElementById('pagoFecha');
    if (inputFecha && !inputFecha.value) inputFecha.valueAsDate = new Date();
    var btnCerrar = document.getElementById('btnCerrarComprobante');
    if (btnCerrar) btnCerrar.addEventListener('click', function () {
        document.getElementById('comprobanteOverlay').style.display = 'none';
        if (comprobanteRedireccion) window.location.href = comprobanteRedireccion;
    });
    var btnVolver = document.getElementById('btnVolverComprobante');
    if (btnVolver) btnVolver.addEventListener('click', function () {
        document.getElementById('comprobanteOverlay').style.display = 'none';
        window.history.back();
    });
    var btnImprimir = document.getElementById('btnImprimirComprobante');
    if (btnImprimir) btnImprimir.addEventListener('click', function () {
        var contenido = document.getElementById('comprobanteContenido').innerHTML;
        var ventana = window.open('', '_blank', 'width=480,height=640');
        ventana.document.write('<html><head><title>Comprobante de Pago</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#222;}h2{margin-bottom:0;} .comprobante-subtitulo{color:#888;margin-top:4px;}.comprobante-fila{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;}.comprobante-footer{color:#888;font-size:12px;margin-top:16px;text-align:center;}</style></head><body>' + contenido + '</body></html>');
        ventana.document.close();
        ventana.focus();
        setTimeout(function () { ventana.print(); }, 300);
    });
    var btnDescargar = document.getElementById('btnDescargarComprobante');
    if (btnDescargar) btnDescargar.addEventListener('click', function () {
        var doc = new window.jspdf.jsPDF();
        var y = 20;
        doc.setFontSize(16); doc.text('DMR Comunicaciones', 20, y); y += 7;
        doc.setFontSize(11); doc.setTextColor(120); doc.text('Comprobante de Pago', 20, y); y += 10;
        doc.setTextColor(30); doc.setLineWidth(0.2); doc.line(20, y, 190, y); y += 10;
        var filas = [
            ['N° Comprobante', document.getElementById('cpNumero').textContent],
            ['Cliente', document.getElementById('cpCliente').textContent],
            ['Correo', document.getElementById('cpCorreo').textContent],
            ['Mes correspondiente', document.getElementById('cpMes').textContent],
            ['Fecha de pago', document.getElementById('cpFecha').textContent],
            ['Método de pago', document.getElementById('cpMetodo').textContent]
        ];
        var elCuotaPdf = document.getElementById('cpCuota'); if (elCuotaPdf) filas.push(['Cuota mensual', elCuotaPdf.textContent]);
        filas.push(['Abono recibido', document.getElementById('cpValor').textContent]);
        var elSaldoPdf = document.getElementById('cpSaldo'); if (elSaldoPdf) filas.push(['Saldo pendiente total', elSaldoPdf.textContent]);
        if (document.getElementById('cpObsWrap').style.display !== 'none') filas.push(['Observaciones', document.getElementById('cpObs').textContent]);
        doc.setFontSize(11);
        filas.forEach(function (fila) {
            doc.setFont(undefined, 'bold'); doc.text(fila[0] + ':', 20, y);
            doc.setFont(undefined, 'normal'); doc.text(String(fila[1] || '-'), 90, y);
            y += 9;
        });
        y += 5; doc.setLineWidth(0.2); doc.line(20, y, 190, y); y += 8;
        doc.setFontSize(9); doc.setTextColor(140);
        doc.text('Gracias por su pago. Comprobante generado automáticamente.', 20, y);
        doc.save('comprobante_' + document.getElementById('cpNumero').textContent + '.pdf');
    });
}

// ============================================================
// RESPONSIVE
// ============================================================
function inicializarResponsive() {
    var sidebar = document.querySelector('.sidebar');
    var header = document.querySelector('.main-header');
    if (sidebar && header) {
        var overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        var btnMenu = document.createElement('button');
        btnMenu.className = 'btn-menu-movil';
        btnMenu.type = 'button';
        btnMenu.innerHTML = '☰';
        header.insertBefore(btnMenu, header.firstChild);
        function abrirSidebar() { sidebar.classList.add('abierto'); overlay.classList.add('visible'); }
        function cerrarSidebar() { sidebar.classList.remove('abierto'); overlay.classList.remove('visible'); }
        btnMenu.addEventListener('click', function () { sidebar.classList.contains('abierto') ? cerrarSidebar() : abrirSidebar(); });
        overlay.addEventListener('click', cerrarSidebar);
        sidebar.querySelectorAll('a').forEach(function (link) { link.addEventListener('click', cerrarSidebar); });
    }
    document.querySelectorAll('.custom-table').forEach(function (tabla) {
        if (tabla.parentElement.classList.contains('tabla-scroll')) return;
        var envoltura = document.createElement('div');
        envoltura.className = 'tabla-scroll';
        tabla.parentNode.insertBefore(envoltura, tabla);
        envoltura.appendChild(tabla);
    });
}

// ============================================================
// ELIMINAR CLIENTE
// ============================================================
function inicializarEliminarCliente() {
    const btn = document.getElementById("btnEliminarCliente");
    if (!btn) return;
    const id = obtenerParametroURL("id");
    if (!id) return;
    btn.addEventListener("click", function () {
        if (!confirm("¿Seguro que deseas eliminar este cliente? Esta acción también borrará todo su historial de pagos y no se puede deshacer.")) return;
        btn.disabled = true;
        btn.textContent = "Eliminando...";
        const clienteRef = db.collection("clientes").doc(id);
        let nombreParaLog = id;
        clienteRef.get().then(function (doc) {
            if (doc.exists) nombreParaLog = doc.data().nombre || id;
        }).then(function () {
            return clienteRef.collection("pagos").get();
        }).then(function (snapshot) {
            const eliminaciones = [];
            snapshot.forEach(function (doc) { eliminaciones.push(doc.ref.delete()); });
            return Promise.all(eliminaciones);
        }).then(function () {
            return clienteRef.delete();
        }).then(function () {
            registrarActividad("Eliminó cliente", nombreParaLog + " (id: " + id + ")");
            alert("Cliente eliminado correctamente");
            window.location.href = "listacliente.html";
        }).catch(function (err) {
            alert("Error al eliminar: " + err.message);
            btn.disabled = false;
            btn.textContent = "🗑 Eliminar Cliente";
        });
    });
}

// ============================================================
// EDITAR DATOS DEL CLIENTE (solo administrador)
// ============================================================
function inicializarEditarCliente() {
    const btnAbrir = document.getElementById("btnEditarCliente");
    const overlay = document.getElementById("editarClienteOverlay");
    const form = document.getElementById("formEditarCliente");
    if (!btnAbrir || !overlay || !form) return;
    if (rolUsuarioActual !== "administrador") return;
    const id = obtenerParametroURL("id");
    if (!id) return;
    const clienteRef = db.collection("clientes").doc(id);
    let datosActuales = null;

    btnAbrir.addEventListener("click", function () {
        clienteRef.get().then(function (doc) {
            if (!doc.exists) { alert("Cliente no encontrado"); return; }
            datosActuales = doc.data();
            const c = datosActuales;
            document.getElementById("editNombre").value = c.nombre || "";
            document.getElementById("editDocumento").value = c.documento || "";
            document.getElementById("editTelefono").value = c.telefono || "";
            document.getElementById("editCorreo").value = c.correo || "";
            document.getElementById("editDireccion").value = c.direccion || "";
            document.getElementById("editTipoServicio").value = c.tipoServicio || "Internet";
            document.getElementById("editPlan").value = c.plan || "";
            document.getElementById("editValorMensual").value = c.valorMensual || "";
            document.getElementById("editFechaInicio").value = c.fechaInicio || "";
            document.getElementById("editDuracion").value = c.duracionContrato || "";
            document.getElementById("editObservaciones").value = c.observaciones || "";
            overlay.style.display = "flex";
        });
    });

    document.getElementById("btnCancelarEdicion").addEventListener("click", function () {
        overlay.style.display = "none";
    });

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!datosActuales) return;

        const nombre = document.getElementById("editNombre").value.trim();
        const documento = document.getElementById("editDocumento").value.trim();
        const telefono = document.getElementById("editTelefono").value.trim();
        const correo = document.getElementById("editCorreo").value.trim();
        const direccion = document.getElementById("editDireccion").value.trim();
        const tipoServicio = document.getElementById("editTipoServicio").value;
        const plan = document.getElementById("editPlan").value.trim();
        const valorMensual = document.getElementById("editValorMensual").value;
        const fechaInicio = document.getElementById("editFechaInicio").value;
        const duracionContrato = document.getElementById("editDuracion").value;
        const observaciones = document.getElementById("editObservaciones").value.trim();

        if (!validarNombre(nombre)) { alert("El nombre debe tener entre 3 y 80 letras (sin números ni símbolos raros)."); return; }
        if (!validarDocumento(documento)) { alert("El documento debe tener entre 5 y 15 dígitos (solo números)."); return; }
        if (!validarTelefono(telefono)) { alert("El teléfono debe tener entre 7 y 15 dígitos."); return; }
        if (!validarCorreo(correo)) { alert("Ingresa un correo electrónico válido."); return; }
        if (!validarTexto(direccion, 4, 120)) { alert("La dirección debe tener entre 4 y 120 caracteres, sin los símbolos < >."); return; }
        if (plan && !validarTexto(plan, 0, 80)) { alert("El plan no puede contener los símbolos < >."); return; }
        if (!validarValorMonetario(valorMensual)) { alert("El valor mensual debe ser un número mayor a 0."); return; }
        if (!validarFecha(fechaInicio)) { alert("La fecha de inicio no es válida."); return; }
        if (observaciones && !validarTexto(observaciones, 0, 500)) { alert("Las observaciones no pueden superar 500 caracteres ni contener los símbolos < >."); return; }

        const factura = calcularFacturacionCliente({
            valorMensual: Number(valorMensual),
            fechaInicio: fechaInicio,
            totalPagado: datosActuales.totalPagado
        });

        const btn = form.querySelector("button[type=submit]");
        btn.disabled = true;
        btn.textContent = "Guardando...";

        clienteRef.update({
            nombre: nombre, documento: documento, telefono: telefono, correo: correo,
            direccion: direccion, tipoServicio: tipoServicio, plan: plan,
            valorMensual: Number(valorMensual), fechaInicio: fechaInicio,
            duracionContrato: duracionContrato, observaciones: observaciones,
            totalFacturado: factura.totalFacturado,
            totalPagado: factura.totalPagado,
            saldoPendiente: factura.saldoPendiente,
            estado: factura.estado
        }).then(function () {
            // Si cambió el nombre, se actualiza también en los pagos ya guardados
            if (nombre === datosActuales.nombre) return null;
            return clienteRef.collection("pagos").get().then(function (snap) {
                const ps = [];
                snap.forEach(function (d) { ps.push(d.ref.update({ clienteNombre: nombre })); });
                return Promise.all(ps);
            });
        }).then(function () {
            registrarActividad("Editó cliente", nombre + " (id: " + id + ")");
            alert("Datos del cliente actualizados");
            window.location.reload();
        }).catch(function (err) {
            alert("Error al actualizar: " + err.message);
            btn.disabled = false;
            btn.textContent = "Guardar cambios";
        });
    });
}

// ============================================================
// 10) ARRANQUE DE CADA PÁGINA
// ============================================================
function inicializarPagina() {
    inicializarResponsive();
    inicializarLogout();
    if (sessionStorage.getItem("registrarLogin")) {
        sessionStorage.removeItem("registrarLogin");
        registrarActividad("Inició sesión", "");
    }
    mostrarSaludo();
    cargarMetricasDashboard();
    inicializarFormularioRegistro();
    cargarListaClientes();
    cargarDetalleCliente();
    inicializarFormularioPago();
    inicializarComprobantePago();
    inicializarEliminarCliente();
    inicializarEditarCliente();
    cargarListaPagos();
    cargarReportes();
    cargarRegistroActividades();
    inicializarExportaciones();
    aplicarPermisosPorRol();
}

auth.onAuthStateChanged(function (user) {
    const pagina = window.location.pathname.split("/").pop() || "index.html";
    const esLogin = pagina === "index.html" || pagina === "";

    if (user) {
        if (esLogin) {
            window.location.href = "incio.html";
        } else {
            cargarRolUsuarioActual().then(function () {
                inicializarPagina();
                document.body.classList.remove("cargando-auth");
            });
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