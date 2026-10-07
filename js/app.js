const ICONO_DEFAULT = 'img/icons/default.png';

const entrada = document.getElementById('entrada');
const lista = document.getElementById('lista');
const vacio = document.getElementById('vacio');
const mensaje = document.getElementById('mensaje');
const estadoRed = document.getElementById('estado-red');
const syncBtn = document.getElementById('sync-btn');
const notifBtn = document.getElementById('notif-btn');
const configForm = document.getElementById('config-form');

const ETIQUETAS = {
    pendiente: 'Pendiente de subir',
    sincronizado: 'Sincronizado',
    borrar: 'Pendiente de borrar'
};

let miniaturas = [];

function formatoTamano(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function boton(texto, accion) {
    const btn = document.createElement('button');
    btn.className = 'boton';
    btn.textContent = texto;
    btn.addEventListener('click', accion);
    return btn;
}

function crearFila(registro) {
    const li = document.createElement('li');

    const img = document.createElement('img');
    img.alt = '';
    // Si la miniatura no carga se muestra el icono por defecto
    img.onerror = () => { img.onerror = null; img.src = ICONO_DEFAULT; };
    if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(registro.nombre)) {
        const url = URL.createObjectURL(registro.blob);
        miniaturas.push(url);
        img.src = url;
    } else {
        img.src = ICONO_DEFAULT;
    }

    const info = document.createElement('div');
    info.className = 'info';
    const nombre = document.createElement('div');
    nombre.className = 'nombre';
    nombre.textContent = registro.nombre;
    const detalle = document.createElement('div');
    detalle.className = 'detalle';
    const estado = document.createElement('span');
    estado.className = 'estado-' + registro.estado;
    estado.textContent = ETIQUETAS[registro.estado];
    detalle.append(formatoTamano(registro.tamano) + ' · ', estado);
    info.append(nombre, detalle);

    li.append(img, info);
    if (registro.estado !== 'borrar') {
        li.append(
            boton('Guardar', () => guardarEnDispositivo(registro)),
            boton('Borrar', () => borrarArchivo(registro))
        );
    }
    return li;
}

async function pintar() {
    const archivos = await dbTodos();
    archivos.sort((a, b) => b.fecha - a.fecha);

    miniaturas.forEach((url) => URL.revokeObjectURL(url));
    miniaturas = [];

    lista.replaceChildren(...archivos.map(crearFila));
    vacio.classList.toggle('oculto', archivos.length > 0);
}

function guardarEnDispositivo(registro) {
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(registro.blob);
    enlace.download = registro.nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 10000);
}

async function borrarArchivo(registro) {
    if (registro.sha) {
        // Ya existe en remoto: se marca y se borra allá al sincronizar
        await dbGuardar({ ...registro, estado: 'borrar' });
    } else {
        await dbBorrar(registro.nombre);
    }
    await pintar();
    if (registro.sha) pedirSync();
}

async function agregarArchivos(files) {
    const rechazados = [];

    for (const file of files) {
        if (file.size > MAX_BYTES) {
            rechazados.push(file.name);
            continue;
        }
        const anterior = await dbObtener(file.name);
        await dbGuardar({
            nombre: file.name,
            tamano: file.size,
            tipo: file.type,
            blob: file,
            estado: 'pendiente',
            sha: anterior && anterior.sha,
            fecha: Date.now()
        });
    }

    await pintar();
    await pedirSync();
    if (rechazados.length) {
        mensaje.textContent = `Superan ${formatoTamano(MAX_BYTES)}: ${rechazados.join(', ')}`;
    }
}

function mostrarResultado(resultado) {
    if (resultado.errores.length) {
        mensaje.textContent = 'Error: ' + resultado.errores.join(' | ');
    } else if (resultado.sinToken) {
        mensaje.textContent = 'Falta el token de GitHub para subir o borrar (ver Configuración).';
    } else {
        mensaje.textContent = resumen(resultado) || 'Todo está al día.';
    }
}

let syncEnCurso = null;
let repetirSync = false;

// Si llega otra petición mientras se sincroniza, se repite al terminar
// y se muestra un solo resultado con la suma.
function ejecutarSync() {
    if (syncEnCurso) {
        repetirSync = true;
        return syncEnCurso;
    }

    syncEnCurso = (async () => {
        const total = { subidos: 0, descargados: 0, borrados: 0, sinToken: false, errores: [] };
        syncBtn.disabled = true;
        mensaje.textContent = 'Sincronizando…';
        try {
            do {
                repetirSync = false;
                const resultado = await sincronizar();
                total.subidos += resultado.subidos;
                total.descargados += resultado.descargados;
                total.borrados += resultado.borrados;
                total.sinToken = resultado.sinToken;
                total.errores = resultado.errores;
            } while (repetirSync);
            mostrarResultado(total);
            await notificar(total);
        } catch (error) {
            mensaje.textContent = 'No se pudo conectar. Se reintentará cuando haya red.';
        }
        syncBtn.disabled = false;
        syncEnCurso = null;
        await pintar();
    })();
    return syncEnCurso;
}

// Con red se sincroniza ya; sin red se deja encargado al Service Worker.
async function pedirSync() {
    if (navigator.onLine) return ejecutarSync();

    mensaje.textContent = 'Sin conexión: los cambios se enviarán cuando vuelva la red.';
    if ('serviceWorker' in navigator) {
        const registro = await navigator.serviceWorker.ready;
        if ('sync' in registro) {
            registro.sync.register(SYNC_TAG).catch(() => {});
        }
    }
}

function pintarRed() {
    estadoRed.textContent = navigator.onLine ? 'En línea' : 'Sin conexión';
    estadoRed.classList.toggle('offline', !navigator.onLine);
}

function pintarNotificaciones() {
    if (!('Notification' in window)) {
        notifBtn.classList.add('oculto');
    } else if (Notification.permission === 'granted') {
        notifBtn.textContent = 'Notificaciones activas';
        notifBtn.disabled = true;
    } else if (Notification.permission === 'denied') {
        notifBtn.textContent = 'Notificaciones bloqueadas';
        notifBtn.disabled = true;
    }
}

// ===== Eventos

entrada.addEventListener('change', async () => {
    await agregarArchivos([...entrada.files]);
    entrada.value = '';
});

syncBtn.addEventListener('click', pedirSync);

notifBtn.addEventListener('click', async () => {
    const permiso = await Notification.requestPermission();
    pintarNotificaciones();
    if (permiso !== 'granted') return;

    const registro = await navigator.serviceWorker.ready;
    registro.showNotification('Notificaciones activadas', {
        body: 'Te avisaremos cuando tus archivos se sincronicen.',
        icon: './img/icons/icon-192x192.png',
        badge: './img/icons/icon-72x72.png'
    });
});

configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = new FormData(configForm);
    await dbSetConfig({
        repo: datos.get('repo').trim(),
        rama: datos.get('rama').trim(),
        token: datos.get('token').trim()
    });
    document.getElementById('config').open = false;
    pedirSync();
});

window.addEventListener('online', () => {
    pintarRed();
    ejecutarSync();
});
window.addEventListener('offline', pintarRed);

// Registro del Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.log('Error al registrar el SW:', err);
        });
    });

    // El SW avisa cuando terminó un Background Sync
    navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.tipo === 'sync') {
            const resultado = e.data.resultado;
            if (resumen(resultado) || resultado.errores.length) mostrarResultado(resultado);
            pintar();
        }
    });
}

// ===== Inicio

(async () => {
    pintarRed();
    pintarNotificaciones();

    const config = await cargarConfig();
    configForm.repo.value = config.repo;
    configForm.rama.value = config.rama;
    configForm.token.value = config.token;

    await pintar();
    if (navigator.onLine) ejecutarSync();
})();
