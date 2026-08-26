/**
 * 表格列宽拖拽调整 — 为所有 .data-table 的 <th> 添加拖拽手柄。
 * 调用 TableResize.init(table) 或 TableResize.initAll() 来启用。
 */
const TableResize = {
    /**
     * 为指定表格的所有列添加拖拽调整手柄。
     */
    init(table) {
        if (!table || table.dataset.resizeReady) return;
        table.dataset.resizeReady = '1';

        const headers = table.querySelectorAll('th');
        let ghostLine = null;

        headers.forEach(th => {
            if (th.querySelector('.resize-handle')) return;
            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            th.appendChild(handle);

            let startX, startWidth, nextTh, nextWidth;
            const onDown = (e) => {
                e.preventDefault(); e.stopPropagation();
                headers.forEach(h => { h.style.width = h.offsetWidth + 'px'; });
                startX = e.clientX; startWidth = th.offsetWidth;
                nextTh = th.nextElementSibling;
                if (nextTh && nextTh.tagName === 'TH') nextWidth = nextTh.offsetWidth;
                handle.classList.add('active');
                // Create ghost line
                if (!ghostLine) {
                    ghostLine = document.createElement('div');
                    ghostLine.style.cssText = 'position:fixed;top:0;width:2px;background:#4361ee;z-index:99999;pointer-events:none;display:none;';
                    document.body.appendChild(ghostLine);
                }
                ghostLine.style.height = table.offsetHeight + 'px';
                const rect = th.getBoundingClientRect();
                ghostLine.style.left = (rect.right) + 'px';
                ghostLine.style.top = rect.top + 'px';
                ghostLine.style.display = '';
                table.classList.add('resizing');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            };
            const onMove = (e) => {
                const diff = e.clientX - startX;
                const newLeft = th.getBoundingClientRect().right + diff;
                ghostLine.style.left = newLeft + 'px';
            };
            const onUp = (e) => {
                const diff = e.clientX - startX;
                const newW = Math.max(30, startWidth + diff);
                th.style.width = newW + 'px';
                if (nextWidth !== undefined && nextTh) {
                    const nextNewW = Math.max(30, nextWidth - diff);
                    nextTh.style.width = nextNewW + 'px';
                }
                handle.classList.remove('active');
                table.classList.remove('resizing');
                if (ghostLine) ghostLine.style.display = 'none';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            handle.addEventListener('mousedown', onDown);
        });
    },

    /**
     * 为页面上所有 .data-table 和 .oid-picker-table 启用列宽调整。
     */
    initAll() {
        document.querySelectorAll('.data-table, .oid-picker-table').forEach(t => this.init(t));
    }
};
