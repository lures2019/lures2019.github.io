/** Builds a PDF with one JPEG per page. The JPEGs are embedded as-is (no re-encoding). */
export function createPdf(pages, opts = {}) {
    const { pageSize = 'a4' } = opts;
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let length = 0;
    const push = (b) => {
        const u = typeof b === 'string' ? enc.encode(b) : b;
        chunks.push(u);
        length += u.length;
    };
    const obj = (id, body, stream) => {
        offsets[id] = length;
        push(`${id} 0 obj\n${body}\n`);
        if (stream) {
            push('stream\n');
            push(stream);
            push('\nendstream\n');
        }
        push('endobj\n');
    };
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    // ids: 1 catalog, 2 pages, then per page: page, image, content
    const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
    pages.forEach((p, i) => {
        const pageId = 3 + i * 3, imgId = pageId + 1, contentId = pageId + 2;
        let pw, ph, dw, dh, dx, dy;
        if (pageSize === 'fit') {
            // 150 dpi-ish so the page has a sane physical size
            pw = dw = (p.width * 72) / 150;
            ph = dh = (p.height * 72) / 150;
            dx = dy = 0;
        }
        else {
            [pw, ph] = p.width > p.height ? [841.89, 595.28] : [595.28, 841.89];
            const k = Math.min(pw / p.width, ph / p.height);
            dw = p.width * k;
            dh = p.height * k;
            dx = (pw - dw) / 2;
            dy = (ph - dh) / 2;
        }
        const f = (n) => n.toFixed(2);
        const content = enc.encode(`q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(dy)} cm /Im0 Do Q`);
        obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        obj(imgId, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
        obj(contentId, `<< /Length ${content.length} >>`, content);
    });
    const count = 3 + pages.length * 3;
    const xref = length;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let id = 1; id < count; id++)
        table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let o = 0;
    for (const c of chunks)
        out.set(c, o), (o += c.length);
    return out;
}
