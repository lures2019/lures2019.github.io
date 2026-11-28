let database;
let lastSaved = new Map();

function openDatabase() {
  if (database) return database;
  database = new Promise((resolve,reject) => {
    const request = indexedDB.open('treehouse-scanner-v1',1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings');
      request.result.createObjectStore('pages',{keyPath:'id'});
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = null; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('草稿数据库被其它页面占用。'));
  }).catch(error => { database = null; throw error; });
  return database;
}

function completed(tx) {
  return new Promise((resolve,reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('保存已中断。'));
  });
}

export async function readDraft() {
  const db = await openDatabase();
  const tx = db.transaction(['settings','pages']);
  const state = tx.objectStore('settings').get('draft');
  const pages = tx.objectStore('pages').getAll();
  await completed(tx);
  lastSaved = new Map(pages.result.map(p => [p.id,p]));
  if (!state.result) return null;
  for (const project of Object.values(state.result.projects)) {
    project.pages = project.pageIds.map(id => lastSaved.get(id)).filter(Boolean);
    delete project.pageIds;
  }
  return state.result;
}

export async function saveDraft(state) {
  const db = await openDatabase();
  const tx = db.transaction(['settings','pages'],'readwrite');
  const settings = tx.objectStore('settings'), pages = tx.objectStore('pages');
  const next = new Map();
  if (!state) {
    settings.clear(); pages.clear();
  } else {
    const {mode, projects} = state;
    const metadata = {};
    for (const [key,project] of Object.entries(projects)) {
      const {pages: list, ...options} = project;
      metadata[key] = {...options,pageIds:list.map(p=>p.id)};
      for (const page of list) {
        next.set(page.id,page);
        if (lastSaved.get(page.id) !== page) pages.put(page);
      }
    }
    for (const id of lastSaved.keys()) if (!next.has(id)) pages.delete(id);
    settings.put({mode,projects:metadata},'draft');
  }
  await completed(tx);
  lastSaved = next;
}
