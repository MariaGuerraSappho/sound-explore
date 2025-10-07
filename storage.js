export class Storage {
    constructor() {
        this.dbName = 'SoundExplorerDB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create recordings store
                if (!db.objectStoreNames.contains('recordings')) {
                    const recordingsStore = db.createObjectStore('recordings', { keyPath: 'id' });
                    recordingsStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // Create settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    async ensureDb() {
        if (!this.db) {
            await this.init();
        }
    }

    async saveRecording(recording) {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings'], 'readwrite');
            const store = transaction.objectStore('recordings');
            const request = store.put(recording);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAllRecordings() {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings'], 'readonly');
            const store = transaction.objectStore('recordings');
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getRecording(id) {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings'], 'readonly');
            const store = transaction.objectStore('recordings');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteRecording(id) {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings'], 'readwrite');
            const store = transaction.objectStore('recordings');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async set(key, value) {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readwrite');
            const store = transaction.objectStore('settings');
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async get(key) {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['settings'], 'readonly');
            const store = transaction.objectStore('settings');
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    }

    async clear() {
        await this.ensureDb();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings', 'settings'], 'readwrite');
            
            const recordingsStore = transaction.objectStore('recordings');
            const settingsStore = transaction.objectStore('settings');
            
            const req1 = recordingsStore.clear();
            const req2 = settingsStore.clear();

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

