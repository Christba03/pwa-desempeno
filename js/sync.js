// Sincronización con el "servidor": una rama de un repo de GitHub (API de contenidos).
// Lo usan la página (js/app.js) y el Service Worker (Background Sync).

const SYNC_TAG = 'sync-archivos';
const MAX_BYTES = 25 * 1024 * 1024;

const CONFIG_DEFAULT = {
    repo: 'Christba03/pwa-desempeno',
    rama: 'archivos',
    carpeta: 'archivos',
    token: ''
};

async function cargarConfig() {
    return { ...CONFIG_DEFAULT, ...(await dbGetConfig()) };
}

function api(config, ruta, opciones = {}) {
    const headers = { Accept: 'application/vnd.github+json', ...opciones.headers };
    if (config.token) headers.Authorization = 'Bearer ' + config.token;

    return fetch(`https://api.github.com/repos/${config.repo}/${ruta}`, {
        ...opciones,
        headers,
        cache: 'no-store'
    });
}

function rutaArchivo(config, nombre) {
    return `contents/${config.carpeta}/${encodeURIComponent(nombre)}`;
}

async function aBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binario = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binario);
}

async function mensajeError(resp) {
    const cuerpo = await resp.json().catch(() => ({}));
    return `${resp.status} ${cuerpo.message || resp.statusText}`;
}

// Devuelve { nombre: { sha, tamano } } o null si no se pudo listar.
async function listarRemoto(config, resultado) {
    const resp = await api(config, `contents/${config.carpeta}?ref=${encodeURIComponent(config.rama)}`);
    if (!resp.ok) {
        resultado.errores.push('No se pudo leer el repositorio: ' + await mensajeError(resp));
        return null;
    }

    const remoto = {};
    for (const item of await resp.json()) {
        if (item.type === 'file' && !item.name.startsWith('.')) {
            remoto[item.name] = { sha: item.sha, tamano: item.size };
        }
    }
    return remoto;
}

async function sincronizarSinBloqueo() {
    const resultado = { subidos: 0, descargados: 0, borrados: 0, sinToken: false, errores: [] };
    const config = await cargarConfig();

    // Si no hay red, fetch lanza y Background Sync reintenta después
    const remoto = await listarRemoto(config, resultado);
    if (!remoto) return resultado;

    const locales = await dbTodos();

    // 1. Borrados pendientes
    for (const registro of locales.filter((r) => r.estado === 'borrar')) {
        if (remoto[registro.nombre]) {
            if (!config.token) { resultado.sinToken = true; continue; }

            const resp = await api(config, rutaArchivo(config, registro.nombre), {
                method: 'DELETE',
                body: JSON.stringify({
                    message: 'Borrar ' + registro.nombre,
                    sha: remoto[registro.nombre].sha,
                    branch: config.rama
                })
            });
            if (!resp.ok) {
                resultado.errores.push(`${registro.nombre}: ${await mensajeError(resp)}`);
                continue;
            }
            delete remoto[registro.nombre];
        }
        await dbBorrar(registro.nombre);
        resultado.borrados++;
    }

    // 2. Subidas pendientes
    for (const registro of locales.filter((r) => r.estado === 'pendiente')) {
        if (!config.token) { resultado.sinToken = true; continue; }

        const resp = await api(config, rutaArchivo(config, registro.nombre), {
            method: 'PUT',
            body: JSON.stringify({
                message: 'Subir ' + registro.nombre,
                content: await aBase64(registro.blob),
                sha: remoto[registro.nombre] && remoto[registro.nombre].sha,
                branch: config.rama
            })
        });
        if (!resp.ok) {
            resultado.errores.push(`${registro.nombre}: ${await mensajeError(resp)}`);
            continue;
        }

        const sha = (await resp.json()).content.sha;
        remoto[registro.nombre] = { sha, tamano: registro.tamano };
        await dbGuardar({ ...registro, estado: 'sincronizado', sha });
        resultado.subidos++;
    }

    // 3. Descargas: lo que hay en remoto y no tenemos (o cambió)
    const actuales = new Map((await dbTodos()).map((r) => [r.nombre, r]));
    for (const [nombre, info] of Object.entries(remoto)) {
        const local = actuales.get(nombre);
        if (local && (local.estado !== 'sincronizado' || local.sha === info.sha)) continue;

        const resp = await api(config, 'git/blobs/' + info.sha, {
            headers: { Accept: 'application/vnd.github.raw' }
        });
        if (!resp.ok) {
            resultado.errores.push(`${nombre}: ${await mensajeError(resp)}`);
            continue;
        }

        const blob = await resp.blob();
        await dbGuardar({
            nombre,
            tamano: blob.size,
            tipo: local ? local.tipo : '',
            blob,
            estado: 'sincronizado',
            sha: info.sha,
            fecha: Date.now()
        });
        resultado.descargados++;
    }

    // 4. Lo que ya no existe en remoto se quita de aquí también
    for (const [nombre, local] of actuales) {
        if (local.estado === 'sincronizado' && !remoto[nombre]) {
            await dbBorrar(nombre);
            resultado.borrados++;
        }
    }

    return resultado;
}

// La página y el SW pueden pedir sincronizar a la vez: se hace en fila.
function sincronizar() {
    if (self.navigator && navigator.locks) {
        return navigator.locks.request(SYNC_TAG, sincronizarSinBloqueo);
    }
    return sincronizarSinBloqueo();
}

function resumen(resultado) {
    const partes = [];
    if (resultado.subidos) partes.push(`${resultado.subidos} subido(s)`);
    if (resultado.descargados) partes.push(`${resultado.descargados} descargado(s)`);
    if (resultado.borrados) partes.push(`${resultado.borrados} borrado(s)`);
    return partes.join(', ');
}

async function notificar(resultado) {
    if (!('Notification' in self) || Notification.permission !== 'granted') return;

    const texto = resumen(resultado);
    if (!texto) return;

    const registro = self.registration || await navigator.serviceWorker.ready;
    return registro.showNotification('Archivos sincronizados', {
        body: texto,
        icon: './img/icons/icon-192x192.png',
        badge: './img/icons/icon-72x72.png',
        tag: SYNC_TAG
    });
}
