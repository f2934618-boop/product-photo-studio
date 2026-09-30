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
