export function runWorker(operation, payload, signal, onProgress) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-writer.mjs', import.meta.url), { type: 'module' });
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      callback(value);
    };
    const abort = () => finish(reject, signal.reason);
    const wait = () => { timer = setTimeout(() => finish(reject, new Error('处理超时')), 120_000); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) {
        clearTimeout(timer);
        onProgress(data.progress);
        wait();
      } else if (data.error) {
        finish(reject, new Error(data.error));
      } else {
        finish(resolve, data.output);
      }
    };
    worker.onerror = () => finish(reject, new Error('无法启动 PDF 处理组件，请更新浏览器后重试'));
    wait();
    try {
      worker.postMessage({ operation, ...payload });
    } catch (error) {
      finish(reject, error);
    }
  });
}
