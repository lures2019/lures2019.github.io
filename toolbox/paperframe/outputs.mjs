const rootName = '论文页面';
const reserved = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/iu;

export function safeTitle(title) {
  let name = title.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/gu, '');
  let bytes = 0;
  const encoder = new TextEncoder();
  name = Array.from(name).filter((character) => (bytes += encoder.encode(character).length) <= 185)
    .join('').replace(/[. ]+$/gu, '');
  if (reserved.test(name)) name = `_${name}`;
  return name || '未命名论文';
}

function nextName(title, used) {
  const base = safeTitle(title);
  let name = base;
  for (let index = 2; used.has(name.toLowerCase()); index++) name = `${base} (${index})`;
  used.add(name.toLowerCase());
  return name;
}

export async function archivePDFs(entries) {
  const { ZipWriter, BlobWriter, BlobReader } = globalThis.zip;
  const zip = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  const used = new Set();
  for (const { name, output } of entries) {
    await zip.add(`${nextName(name, used)}.pdf`, new BlobReader(output), { level: 0 });
  }
  return zip.close();
}

export async function makeDestination(directory) {
  if (directory) {
    const used = new Set();
    for await (const name of directory.keys()) used.add(name.toLowerCase());
    return {
      begin: async (title) => {
        const name = nextName(title, used);
        const folder = await directory.getDirectoryHandle(name, { create: true });
        const written = [];
        return {
          write: async (page) => {
            const handle = await folder.getFileHandle(page.name, { create: true });
            written.push(page.name);
            const stream = await handle.createWritable();
            try {
              await stream.write(page.image);
              await stream.close();
            } catch (error) {
              await stream.abort().catch(() => {});
              throw error;
            }
          },
          commit: async () => {},
          discard: async () => {
            await Promise.allSettled(written.map((pageName) => folder.removeEntry(pageName)));
            await directory.removeEntry(name).catch(() => {});
            used.delete(name.toLowerCase());
          },
        };
      },
      finish: async () => null,
    };
  }

  const { ZipWriter, BlobWriter, BlobReader } = globalThis.zip;
  const zip = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  const used = new Set();
  return {
    begin: async (title) => {
      const name = nextName(title, used);
      const pages = [];
      return {
        write: async (page) => { pages.push(page); },
        commit: async () => {
          for (const { name: pageName, image } of pages) {
            await zip.add(`${rootName}/${name}/${pageName}`, new BlobReader(image), { level: 0 });
          }
          pages.length = 0;
        },
        discard: async () => { pages.length = 0; },
      };
    },
    finish: async () => zip.close(),
  };
}
