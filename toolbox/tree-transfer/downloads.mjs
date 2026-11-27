const FOLDER_NAME = 'tree-transfer-downloads-v1';
const ENTRY = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const LOCK_PREFIX = 'tree-transfer-download:';

export function supportsLocalDownloads() {
  return typeof navigator.storage?.getDirectory === 'function' &&
    typeof globalThis.FileSystemFileHandle?.prototype.createWritable === 'function';
}

async function root() {
  if (!supportsLocalDownloads()) {
    throw new Error('当前浏览器无法暂存下载。请选择保存目录，或用新版 Chrome、Edge、Firefox 或 Safari 接收。');
  }
  const storage = await navigator.storage.getDirectory();
  return storage.getDirectoryHandle(FOLDER_NAME, {create:true});
}

// The lock protects incomplete entries from cleanup by other open tabs.
function hold(id) {
  if (!navigator.locks) return Promise.resolve(() => {});
  return new Promise((resolve,reject) => {
    navigator.locks.request(LOCK_PREFIX + id, () => new Promise(release => {
      resolve(release);
    })).catch(reject);
  });
}

async function remove(folder,id) {
  try { await folder.removeEntry(id,{recursive:true}); }
  catch (error) { if (error.name !== 'NotFoundError') throw error; }
}

function entry(folder,id,name,file) {
  return {id,name,file,remove:() => remove(folder,id)};
}

async function readEntry(folder,id,item) {
  const manifest = await (await item.getFileHandle('verified.json')).getFile();
  const {name,size} = JSON.parse(await manifest.text());
  const file = await (await item.getFileHandle('data')).getFile();
  if (typeof name !== 'string' || !name || file.size !== size) {
    throw new DOMException('Invalid download record','DataError');
  }
  return entry(folder,id,name,file);
}

function incomplete(error) {
  return ['SyntaxError','NotFoundError','DataError','TypeMismatchError'].includes(error.name);
}

export async function listDownloads() {
  const folder = await root();
  const entries = [];
  for await (const [id,item] of folder.entries()) {
    if (!ENTRY.test(id) || item.kind !== 'directory') continue;
    try {
      entries.push(await readEntry(folder,id,item));
    } catch (error) {
      if (incomplete(error) && navigator.locks) {
        await navigator.locks.request(LOCK_PREFIX + id,{ifAvailable:true},async lock => {
          if (!lock) return;
          // The writer may have finished between the read above and lock acquisition.
          try { entries.push(await readEntry(folder,id,item)); }
          catch (retryError) { if (incomplete(retryError)) await remove(folder,id).catch(() => {}); }
        });
      }
    }
  }
  return entries;
}

export async function openDownloadFolder() {
  return root();
}

export async function stageDownload(folder,meta,ready) {
  const id = crypto.randomUUID();
  const release = await hold(id);
  let fileHandle, writer, item;
  try {
    item = await folder.getDirectoryHandle(id,{create:true});
    fileHandle = await item.getFileHandle('data',{create:true});
    writer = await fileHandle.createWritable();
  } catch (error) {
    try { if (item) await remove(folder,id); } finally { release(); }
    throw error;
  }

  let state = 'open';
  return {
    write: chunk => writer.write(chunk),
    async commit() {
      state = 'committing';
      try {
        await writer.close();
        const file = await fileHandle.getFile();
        if (file.size !== meta.size) throw new Error('暂存文件的长度不匹配。');
        const info = await item.getFileHandle('verified.json',{create:true});
        const record = await info.createWritable();
        try {
          await record.write(JSON.stringify({name:meta.name,size:meta.size}));
          await record.close();
        } catch (error) {
          await record.abort().catch(() => {});
          throw error;
        }
        state = 'saved';
        ready(entry(folder,id,meta.name,file));
      } catch (error) {
        state = 'aborted';
        await writer.abort().catch(() => {});
        await remove(folder,id).catch(() => {});
        throw error;
      } finally { release(); }
    },
    async abort() {
      if (state !== 'open') return;
      state = 'aborted';
      try {
        await writer.abort().catch(() => {});
        await remove(folder,id);
      } finally { release(); }
    },
  };
}
