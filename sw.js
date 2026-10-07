importScripts('js/db.js', 'js/sync.js');

const CACHE_NAME = 'archivos-v3';
const ICONO_DEFAULT = './img/icons/default.png';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/db.js',
    './js/sync.js',
    './js/app.js',
    ICONO_DEFAULT,
    './img/icons/icon.svg',
    './img/icons/icon-72x72.png',
    './img/icons/icon-96x96.png',
    './img/icons/icon-128x128.png',
    './img/icons/icon-144x144.png',
    './img/icons/icon-152x152.png',
    './img/icons/icon-192x192.png',
    './img/icons/icon-384x384.png',
    './img/icons/icon-512x512.png',
    './img/icons/maskable-512x512.png'
];

self.addEventListener('install', (e) => {
    // allSettled: si falta algún icono la instalación no se cae
    const cache = caches.open(CACHE_NAME).then((c) => {
        return Promise.allSettled(APP_SHELL.map((asset) => c.add(asset)));
    });
    e.waitUntil(cache);
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    const activate = caches.keys().then((keys) => {
        return Promise.all(keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)));
    });
    e.waitUntil(activate);
    self.clients.claim();
});

// Estrategia: Network first con respaldo en cache.
async function redPrimero(request) {
    const cache = await caches.open(CACHE_NAME);
    const esImagen = request.destination === 'image';

    try {
        const netResp = await fetch(request);
        if (netResp.ok) {
            cache.put(request, netResp.clone());
            return netResp;
        }
        // La red respondió pero el recurso no existe (ej. icono faltante)
        if (esImagen) {
            return (await cache.match(request)) || (await cache.match(ICONO_DEFAULT)) || netResp;
        }
        return netResp;
    } catch (error) {
        const cacheResp = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
        if (cacheResp) return cacheResp;
        if (request.mode === 'navigate') return cache.match('./index.html');
        if (esImagen) return cache.match(ICONO_DEFAULT);
        return Response.error();
    }
}

self.addEventListener('fetch', (e) => {
    const requestUrl = new URL(e.request.url);

    // La API de GitHub y las extensiones no pasan por el cache de la app
    if (e.request.method !== 'GET' || requestUrl.origin !== self.location.origin) {
        return;
    }

    e.respondWith(redPrimero(e.request));
});

// Background Sync: el navegador lo dispara cuando vuelve la red,
// aunque la página ya esté cerrada.
self.addEventListener('sync', (e) => {
    if (e.tag !== SYNC_TAG) return;

    const tarea = sincronizar().then(async (resultado) => {
        await notificar(resultado);
        const clientes = await self.clients.matchAll({ type: 'window' });
        clientes.forEach((cliente) => cliente.postMessage({ tipo: 'sync', resultado }));
    });
    e.waitUntil(tarea);
});

self.addEventListener('push', (e) => {
    let datos = { title: 'Mis Archivos', body: 'Hay novedades en tus archivos' };

    if (e.data) {
        datos = e.data.json();
    }

    const opciones = {
        body: datos.body,
        icon: './img/icons/icon-192x192.png',
        badge: './img/icons/icon-72x72.png'
    };

    e.waitUntil(self.registration.showNotification(datos.title, opciones));
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();

    const abrir = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
        if (clientes.length > 0) return clientes[0].focus();
        return self.clients.openWindow('./');
    });
    e.waitUntil(abrir);
});
