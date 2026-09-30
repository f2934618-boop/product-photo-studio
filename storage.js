let dbPromise;
function db() {
  return dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('product-studio-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function transaction(mode, action) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('images', mode);
    const request = action(tx.objectStore('images'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('本地存储写入中断'));
  });
}
export const saveItem = item => transaction('readwrite', store => store.put(item));
export const readItems = () => transaction('readonly', store => store.getAll());
export const deleteItem = id => transaction('readwrite', store => store.delete(id));

// Generated outputs have their own database so existing image-library tabs do not block upgrades.
let resultsDb;
async function resultTransaction(mode, action) {
  resultsDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('product-studio-results-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('results', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  const database = await resultsDb;
  return new Promise((resolve, reject) => {
    const tx = database.transaction('results', mode), request = action(tx.objectStore('results'));
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export const saveResult = result => resultTransaction('readwrite', store => store.put(result));
export const readResults = () => resultTransaction('readonly', store => store.getAll());
export const deleteResult = id => resultTransaction('readwrite', store => store.delete(id));
