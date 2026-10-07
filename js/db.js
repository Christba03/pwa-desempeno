// IndexedDB compartido entre la página y el Service Worker.
// archivos: { nombre, tamano, tipo, blob, estado, sha, fecha }
//   estado: 'pendiente' (falta subir) | 'sincronizado' | 'borrar' (falta borrar en remoto)

const DB_NAME = 'archivos-db';
const DB_VERSION = 1;

function abrirDB() {
    return new Promise((resolve, reject) => {
        const peticion = indexedDB.open(DB_NAME, DB_VERSION);
        peticion.onupgradeneeded = () => {
            const db = peticion.result;
            db.createObjectStore('archivos', { keyPath: 'nombre' });
            db.createObjectStore('config');
        };
        peticion.onsuccess = () => resolve(peticion.result);
        peticion.onerror = () => reject(peticion.error);
    });
}

async function operacion(almacen, modo, accion) {
    const db = await abrirDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(almacen, modo);
        const peticion = accion(tx.objectStore(almacen));
        tx.oncomplete = () => { db.close(); resolve(peticion.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
    });
}

const dbTodos = () => operacion('archivos', 'readonly', (s) => s.getAll());
const dbObtener = (nombre) => operacion('archivos', 'readonly', (s) => s.get(nombre));
const dbGuardar = (registro) => operacion('archivos', 'readwrite', (s) => s.put(registro));
const dbBorrar = (nombre) => operacion('archivos', 'readwrite', (s) => s.delete(nombre));

const dbGetConfig = () => operacion('config', 'readonly', (s) => s.get('config'));
const dbSetConfig = (config) => operacion('config', 'readwrite', (s) => s.put(config, 'config'));
