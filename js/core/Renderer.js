import { eventBus } from './EventBus.js';
import { state } from './State.js';

// ✅ 核心修复 1：移动端防抖阈值。滑动必须超过 10px 才能算拖拽，彻底解决“点不中”的世纪难题！
Konva.dragDistance = 10;

export class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.stage = new Konva.Stage({ container: containerId, width: this.container.clientWidth, height: this.container.clientHeight });
        this.layers = { busbar: new Konva.Layer(), bms: new Konva.Layer(), cell: new Konva.Layer(), ui: new Konva.Layer() };
        this.stage.add(this.layers.busbar, this.layers.bms, this.layers.cell, this.layers.ui);

        this.selectionRect = new Konva.Rect({ fill: 'rgba(56, 189, 248, 0.2)', stroke: '#38bdf8', strokeWidth: 1, visible: false });
        this.lassoLine = new Konva.Line({ stroke: '#38bdf8', strokeWidth: 2, fill: 'rgba(56, 189, 248, 0.2)', closed: true, visible: false, tension: 0 });
        this.measureLine = new Konva.Line({ stroke: '#10b981', strokeWidth: 2, dash: [4, 4], visible: false });
        this.measureText = new Konva.Text({ text: '', fontSize: 14, fill: '#10b981', backgroundColor: '#0f172a', padding: 4, cornerRadius: 4, visible: false, fontStyle: 'bold' });

        this.dragTrailGroup = new Konva.Group();
        this.remoteGhostsGroup = new Konva.Group();
        this.layers.ui.add(this.selectionRect, this.lassoLine, this.measureLine, this.measureText, this.dragTrailGroup, this.remoteGhostsGroup);

        this.isSelecting = false; this.selectionStartPos = { x: 0, y: 0 }; this.lassoPoints = [];
        this.isMeasuring = false;
        this.remoteCursors = {};

        this.bindSystemEvents();
        eventBus.on('state:changed', ({ doc, ui }) => this.renderAll(doc, ui));
        eventBus.on('network:cursor', ({ peer, pos }) => this.renderRemoteCursor(peer, pos));
        eventBus.on('network:ghost_move', ({ peer, cells }) => this.renderRemoteGhost(peer, cells));
        eventBus.on('network:ghost_end', ({ peer }) => this.clearRemoteGhost(peer));
    }

    bindSystemEvents() {
        // ================= PC 端滚轮缩放 =================
        this.stage.on('wheel', (e) => {
            e.evt.preventDefault();
            const oldScale = this.stage.scaleX(); const pointer = this.stage.getPointerPosition();
            const mousePointTo = { x: (pointer.x - this.stage.x()) / oldScale, y: (pointer.y - this.stage.y()) / oldScale };
            let newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
            this.stage.scale({ x: newScale, y: newScale });
            this.stage.position({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
        });

        // ================= ✅ 修复 2：完美移动端双指触控引擎 =================
        let lastCenter = null;
        let lastDist = 0;

        this.stage.on('touchmove', (e) => {
            // 阻止原生滚动，极其关键
            e.evt.preventDefault();
            const touches = e.evt.touches;

            // 只有当有两根手指按在屏幕上时才处理
            if (touches && touches.length >= 2) {
                // 强制中止因为第一根手指接触引发的单指拖拽错误
                if (this.stage.isDragging()) this.stage.stopDrag();

                const p1 = { x: touches[0].clientX, y: touches[0].clientY };
                const p2 = { x: touches[1].clientX, y: touches[1].clientY };

                const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
                const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                if (!lastCenter) { lastCenter = center; lastDist = dist; return; }
                if (!lastDist) { lastDist = dist; return; }

                // 计算平移
                const dx = center.x - lastCenter.x;
                const dy = center.y - lastCenter.y;

                // 计算缩放
                const scaleBy = dist / lastDist;
                const oldScale = this.stage.scaleX();
                let newScale = oldScale * scaleBy;

                // 限制缩放防溢出
                if (newScale < 0.1) newScale = 0.1;
                if (newScale > 10) newScale = 10;

                const pointTo = {
                    x: (center.x - this.stage.x() - dx) / oldScale,
                    y: (center.y - this.stage.y() - dy) / oldScale,
                };

                this.stage.scale({ x: newScale, y: newScale });
                this.stage.position({
                    x: center.x - pointTo.x * newScale,
                    y: center.y - pointTo.y * newScale,
                });

                lastDist = dist;
                lastCenter = center;
                this.layers.ui.batchDraw();
            }
        });

        this.stage.on('touchend', (e) => {
            if (!e.evt.touches || e.evt.touches.length < 2) {
                lastDist = 0; lastCenter = null;
            }
        });

        // ================= 工具交互逻辑 =================
        this.stage.on('mousedown touchstart', (e) => {
            if (e.evt && e.evt.touches && e.evt.touches.length > 1) return; // 双指时不触发任何画笔/框选工具

            const tool = state.ui.currentTool;
            if (e.evt.button === 1 || e.evt.button === 2 || tool === 'pan' || (tool === 'pointer' && e.target === this.stage)) { this.stage.draggable(true); return; }

            // 🌟 新增：触发滑动连焊的初始点
            if (tool === 'wire') {
                const pointer = this.stage.getRelativePointerPosition();
                let absoluteX = state.ui.viewMode === 'back' ? this.stage.width() - pointer.x : pointer.x;

                // 查找按下的位置是否落在某个电芯上
                const clickedCell = state.doc.cells.find(c => {
                    return Math.sqrt(Math.pow(c.cx - absoluteX, 2) + Math.pow(c.cy - pointer.y, 2)) <= state.ui.cellRadius;
                });

                if (clickedCell && !clickedCell.isLocked) {
                    this.isWiring = true;
                    state.ui.wireStartCell = clickedCell.id;
                    state.notify(); // 触发高亮
                }
                return;
            }

            this.selectionStartPos = this.stage.getRelativePointerPosition();

            if (tool === 'measure') {
                this.isMeasuring = true;
                this.measureLine.points([this.selectionStartPos.x, this.selectionStartPos.y, this.selectionStartPos.x, this.selectionStartPos.y]);
                this.measureLine.visible(true); this.measureText.visible(true); return;
            }

            if ((tool !== 'select-box' && tool !== 'select-lasso') || e.target !== this.stage) return;
            this.isSelecting = true;
            if (tool === 'select-box') { this.selectionRect.position(this.selectionStartPos); this.selectionRect.width(0); this.selectionRect.height(0); this.selectionRect.visible(true); }
            else if (tool === 'select-lasso') { this.lassoPoints = [this.selectionStartPos.x, this.selectionStartPos.y]; this.lassoLine.points(this.lassoPoints); this.lassoLine.visible(true); }
            if (!e.evt.ctrlKey && !e.evt.metaKey && !e.evt.shiftKey) state.clearSelection();
        });

        // ✅ 核心修复 3：完美兼容触屏的 Tap 事件清空背景
        this.stage.on('click tap', (e) => {
            if (state.ui.currentTool === 'pointer' && e.target === this.stage) state.clearSelection();
        });

        let lastCursorTime = 0;
        this.stage.on('pointermove', (e) => {
            if (e.evt && e.evt.touches && e.evt.touches.length > 1) return;

            const pos = this.stage.getRelativePointerPosition();
            if (!pos) return;

            let absoluteX = state.ui.viewMode === 'back' ? this.stage.width() - pos.x : pos.x;
            if (Date.now() - lastCursorTime > 30) {
                state.broadcastCursor({ x: absoluteX, y: pos.y });
                lastCursorTime = Date.now();
            }

            // 🌟 核心修复：把滑动连焊的检测放在真正的“滑动(pointermove)”事件里！
            if (this.isWiring && state.ui.wireStartCell) {
                const targetCell = state.doc.cells.find(c => {
                    // 增加 5 像素判定冗余，让手机端触控更容易吸附
                    return Math.sqrt(Math.pow(c.cx - absoluteX, 2) + Math.pow(c.cy - pos.y, 2)) <= state.ui.cellRadius + 5;
                });

                // 划过一个新的未锁定电芯时，瞬间触发点焊！
                if (targetCell && targetCell.id !== state.ui.wireStartCell && !targetCell.isLocked) {
                    state.quickConnect(targetCell.id);
                }
                return;
            }



            if (this.isMeasuring) {
                this.measureLine.points([this.selectionStartPos.x, this.selectionStartPos.y, pos.x, pos.y]);
                const dx = pos.x - this.selectionStartPos.x; const dy = pos.y - this.selectionStartPos.y;
                const distanceMM = (Math.sqrt(dx * dx + dy * dy) * 0.5).toFixed(1);
                this.measureText.text(`${distanceMM} mm`);
                this.measureText.position({ x: this.selectionStartPos.x + dx / 2 + 10, y: this.selectionStartPos.y + dy / 2 + 10 });
                return;
            }

            if (!this.isSelecting) return;
            if (state.ui.currentTool === 'select-box') { this.selectionRect.width(pos.x - this.selectionStartPos.x); this.selectionRect.height(pos.y - this.selectionStartPos.y); }
            else if (state.ui.currentTool === 'select-lasso') { this.lassoPoints.push(pos.x, pos.y); this.lassoLine.points(this.lassoPoints); }
        });

        this.stage.on('mouseup touchend', (e) => {
            // 🌟 抬手结束连焊
            if (this.isWiring) {
                this.isWiring = false;
                state.ui.wireStartCell = null;
                state.notify();
                return;
            }
            this.stage.draggable(false);



            if (this.isMeasuring) { this.isMeasuring = false; this.measureLine.visible(false); this.measureText.visible(false); return; }

            if (!this.isSelecting) return;
            this.isSelecting = false;
            let newlySelectedIds = [];
            const tool = state.ui.currentTool;

            if (tool === 'select-box') {
                this.selectionRect.visible(false); const box = this.selectionRect.getClientRect();
                state.doc.cells.forEach(cell => {
                    let renderX = state.ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
                    const absX = renderX * this.stage.scaleX() + this.stage.x(); const absY = cell.cy * this.stage.scaleY() + this.stage.y();
                    if (!cell.isLocked && Konva.Util.haveIntersection(box, { x: absX, y: absY, width: 1, height: 1 })) newlySelectedIds.push(cell.id);
                });
            } else if (tool === 'select-lasso') {
                this.lassoLine.visible(false);
                state.doc.cells.forEach(cell => {
                    let renderX = state.ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
                    if (!cell.isLocked && this.isPointInPolygon(renderX, cell.cy, this.lassoPoints)) newlySelectedIds.push(cell.id);
                });
            }
            if (e.evt && (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey)) state.selectCells(Array.from(new Set([...state.ui.selectedCells, ...newlySelectedIds])));
            else state.selectCells(newlySelectedIds);
        });

        this.container.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('resize', () => { this.stage.width(this.container.clientWidth); this.stage.height(this.container.clientHeight); state.notify(); });
    }

    getPeerColor(peerId) { let hash = 0; for (let i = 0; i < peerId.length; i++) hash = peerId.charCodeAt(i) + ((hash << 5) - hash); return `hsl(${Math.abs(hash % 360)}, 85%, 60%)`; }

    renderRemoteCursor(peerId, pos) {
        if (!state.ui.layerVisibility || !state.ui.layerVisibility.ui) return;
        let renderX = state.ui.viewMode === 'back' ? this.stage.width() - pos.x : pos.x;
        if (!this.remoteCursors[peerId]) {
            const group = new Konva.Group(); const color = this.getPeerColor(peerId);
            const arrow = new Konva.Path({ data: 'M0,0 L12,12 L5,14 L0,22 Z', fill: color, shadowColor: '#000', shadowBlur: 4, shadowOffset: { x: 2, y: 2 }, shadowOpacity: 0.5 });
            const tag = new Konva.Text({ text: peerId, x: 14, y: 14, fill: '#0f172a', backgroundColor: color, padding: 3, fontSize: 10, cornerRadius: 4, fontStyle: 'bold' });
            group.add(arrow, tag); this.layers.ui.add(group); this.remoteCursors[peerId] = group;
        }
        this.remoteCursors[peerId].position({ x: renderX, y: pos.y }); this.layers.ui.batchDraw();
    }

    renderRemoteGhost(peerId, cellsData) {
        let peerGroup = this.remoteGhostsGroup.findOne(`#ghost-${peerId}`);
        if (!peerGroup) { peerGroup = new Konva.Group({ id: `ghost-${peerId}` }); this.remoteGhostsGroup.add(peerGroup); }
        peerGroup.destroyChildren();

        const color = this.getPeerColor(peerId);
        cellsData.forEach((ghost, index) => {
            let renderX = state.ui.viewMode === 'back' ? this.stage.width() - ghost.cx : ghost.cx;
            peerGroup.add(new Konva.Circle({ x: renderX, y: ghost.cy, radius: state.ui.cellRadius, stroke: color, strokeWidth: 2, dash: [4, 4], opacity: 0.8 }));
            if (index === 0) peerGroup.add(new Konva.Text({ text: `${peerId} 拖拽中...`, x: renderX - 20, y: ghost.cy - 35, fill: color, fontSize: 11, fontStyle: 'bold' }));
        });
        this.layers.ui.batchDraw();
    }

    clearRemoteGhost(peerId) { const peerGroup = this.remoteGhostsGroup.findOne(`#ghost-${peerId}`); if (peerGroup) { peerGroup.destroy(); this.layers.ui.batchDraw(); } }
    isPointInPolygon(x, y, points) { let inside = false; for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) { let intersect = ((points[i + 1] > y) !== (points[j + 1] > y)) && (x < (points[j] - points[i]) * (y - points[i + 1]) / (points[j + 1] - points[i + 1]) + points[i]); if (intersect) inside = !inside; } return inside; }

    renderAll(doc, ui) {
        this.layers.busbar.visible(ui.layerVisibility.busbar); this.layers.bms.visible(ui.layerVisibility.bms); this.layers.cell.visible(ui.layerVisibility.cell); this.layers.ui.visible(ui.layerVisibility.ui);
        this.renderBusbars(doc, ui);
        this.renderCells(doc, ui);
        this.renderBms(doc, ui);


        const cellEl = document.getElementById('cell-count'); const wireEl = document.getElementById('wire-count');
        if (cellEl) cellEl.innerText = doc.cells.length; if (wireEl) wireEl.innerText = doc.busbars.length;
    }

    renderBusbars(doc, ui) {
        this.layers.busbar.destroyChildren();
        doc.busbars.forEach((bar, index) => {
            // 🌟 核心拦截：如果这条线不属于当前视角，直接跳过不渲染，实现正反面隔离！
            if (bar.side && bar.side !== ui.viewMode) return;

            const cell1 = doc.cells.find(c => c.id === bar.from);
            const cell2 = doc.cells.find(c => c.id === bar.to);
            if (!cell1 || !cell2) return;
            let x1 = ui.viewMode === 'back' ? this.stage.width() - cell1.cx : cell1.cx; let x2 = ui.viewMode === 'back' ? this.stage.width() - cell2.cx : cell2.cx;

            // 🌟 获取分析数据，判断当前这根线是否导致了短路
            const isShorted = state.analysis && state.analysis.shortedBusbars.includes(bar.id);
            const lineColor = isShorted ? '#ef4444' : '#fbbf24'; // 短路变血红色
            const glowColor = isShorted ? '#ef4444' : '#000';

            const line = new Konva.Line({
                points: [x1, cell1.cy, x2, cell2.cy],
                stroke: lineColor, strokeWidth: 12, lineCap: 'round', lineJoin: 'round',
                shadowColor: glowColor, shadowBlur: isShorted ? 15 : 4, shadowOffset: { x: 2, y: 2 }, shadowOpacity: 0.8
            });
            line.on('dblclick', () => state.removeBusbar(index)); this.layers.busbar.add(line);
        });
        this.layers.busbar.draw();
    }

    renderCells(doc, ui) {
        this.layers.cell.destroyChildren();
        doc.cells.forEach(cell => {
            let renderX = ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
            let displayPolarity = ui.viewMode === 'back' ? (cell.polarity === 'positive' ? 'negative' : 'positive') : cell.polarity;
            const isSelected = ui.selectedCells.includes(cell.id);

            const cellGroup = new Konva.Group({ x: renderX, y: cell.cy, id: cell.id, draggable: ui.currentTool === 'pointer' && !cell.isLocked });

            cellGroup.on('dragstart', (e) => {
                if (!ui.selectedCells.includes(cell.id)) { if (e.evt && (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey)) state.selectCells([...ui.selectedCells, cell.id]); else state.selectCells([cell.id]); }
                this.dragStartPositions = {};
                this.dragTrailGroup.destroyChildren();

                doc.cells.forEach(c => {
                    if (ui.selectedCells.includes(c.id)) {
                        this.dragStartPositions[c.id] = { cx: c.cx, cy: c.cy };
                        const trailLine = new Konva.Line({ id: `trail-${c.id}`, points: [], stroke: '#38bdf8', strokeWidth: 1.5, dash: [4, 4], opacity: 0.8 });
                        this.dragTrailGroup.add(trailLine);
                    }
                });
            });

            cellGroup.on('dragmove', (e) => {
                if (ui.isSnapping) { const snap = ui.gridSize / 2; e.target.x(Math.round(e.target.x() / snap) * snap); e.target.y(Math.round(e.target.y() / snap) * snap); }
                let newX = e.target.x(); let dx = (ui.viewMode === 'back' ? this.stage.width() - newX : newX) - this.dragStartPositions[cell.id].cx;
                let dy = e.target.y() - this.dragStartPositions[cell.id].cy;

                let ghostPayload = [];
                doc.cells.forEach(c => {
                    if (ui.selectedCells.includes(c.id) && !c.isLocked) {
                        c.cx = this.dragStartPositions[c.id].cx + dx; c.cy = this.dragStartPositions[c.id].cy + dy;
                        if (c.id !== cell.id) { let node = this.layers.cell.findOne(`#${c.id}`); if (node) { node.x(ui.viewMode === 'back' ? this.stage.width() - c.cx : c.cx); node.y(c.cy); } }

                        const trail = this.dragTrailGroup.findOne(`#trail-${c.id}`);
                        if (trail) {
                            let sX = ui.viewMode === 'back' ? this.stage.width() - this.dragStartPositions[c.id].cx : this.dragStartPositions[c.id].cx;
                            let cX = ui.viewMode === 'back' ? this.stage.width() - c.cx : c.cx;
                            trail.points([sX, this.dragStartPositions[c.id].cy, cX, c.cy]);
                        }
                        ghostPayload.push({ id: c.id, cx: c.cx, cy: c.cy });
                    }
                });
                this.renderBusbars(doc, ui);

                const pointerPos = this.stage.getRelativePointerPosition();
                if (pointerPos) {
                    let absoluteX = state.ui.viewMode === 'back' ? this.stage.width() - pointerPos.x : pointerPos.x;
                    state.broadcastCursor({ x: absoluteX, y: pointerPos.y });
                }
                state.broadcastGhostMove(ghostPayload);
            });

            cellGroup.on('dragend', () => { this.dragTrailGroup.destroyChildren(); state.broadcastGhostEnd(); state.commitAction(ui.selectedCells.length > 1 ? '批量移动' : '移动电芯'); });

            // ✅ 终极修复：使用 click tap 兼容手机。由于有 dragDistance 的护盾，这里绝对百发百中！
            cellGroup.on('click tap', (e) => {
                if (ui.currentTool !== 'pan') state.handleCellClick(cell.id, e.evt && (e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey));
            });

            if (isSelected) cellGroup.add(new Konva.Circle({ radius: ui.cellRadius + 6, fill: 'rgba(56, 189, 248, 0.3)', stroke: '#38bdf8', strokeWidth: 2 }));
            const strokeColor = cell.isLocked ? '#475569' : (ui.currentTool === 'wire' && ui.wireStartCell === cell.id ? '#fbbf24' : (displayPolarity === 'positive' ? '#ef4444' : '#3b82f6'));
            cellGroup.add(new Konva.Circle({ radius: ui.cellRadius, fill: displayPolarity === 'positive' ? '#1e293b' : '#334155', stroke: strokeColor, strokeWidth: cell.isLocked ? 2 : (ui.currentTool === 'wire' && ui.wireStartCell === cell.id ? 4 : 2), opacity: cell.isLocked ? 0.7 : 1 }));
            cellGroup.add(new Konva.Text({ text: displayPolarity === 'positive' ? '+' : '-', fontSize: 18, fontStyle: 'bold', fill: strokeColor, align: 'center', verticalAlign: 'middle', x: -ui.cellRadius, y: -ui.cellRadius - 2, width: ui.cellRadius * 2, height: ui.cellRadius * 2, opacity: cell.isLocked ? 0.5 : 1 }));

            const labelGroup = new Konva.Group({ visible: ui.layerVisibility.labels });
            let labelText = cell.id; if (cell.voltage || cell.resistance) { if (cell.voltage) labelText += `\n${cell.voltage}V`; if (cell.resistance) labelText += `\n${cell.resistance}mΩ`; }
            labelGroup.add(new Konva.Text({ text: labelText, fontSize: 9, fill: '#94a3b8', align: 'center', x: -ui.cellRadius * 2, y: ui.cellRadius + 2, width: ui.cellRadius * 4, lineHeight: 1.1 }));
            cellGroup.add(labelGroup);
            if (cell.isLocked) cellGroup.add(new Konva.Text({ text: '🔒', fontSize: 12, x: ui.cellRadius - 10, y: -ui.cellRadius }));
            this.layers.cell.add(cellGroup);
        });

        if (ui.currentTool === 'pan') this.container.style.cursor = 'grab'; else if (ui.currentTool === 'measure') this.container.style.cursor = 'crosshair'; else if (ui.currentTool === 'wire' || ui.currentTool.includes('select')) this.container.style.cursor = 'crosshair'; else this.container.style.cursor = 'default';
        this.layers.cell.draw();
    }
    renderBms(doc, ui) {
        this.layers.bms.destroyChildren();
        if (!doc.bmsWires || doc.bmsWires.length === 0) {
            this.layers.bms.draw();
            return;
        }

        const allX = doc.cells.map(c => c.cx);
        const minX = Math.min(...allX) - 50;
        const maxX = Math.max(...allX) + 50;
        const bmsX = this.stage.width() / 2;
        const bmsY = this.stage.height() - 30;

        doc.bmsWires.forEach((bw, index) => {
            const cell = doc.cells.find(c => c.id === bw.cellId);
            if (!cell) return;

            let renderX = ui.viewMode === 'back' ? this.stage.width() - cell.cx : cell.cx;
            let sideX = cell.cx < bmsX ? minX : maxX;
            let renderSideX = ui.viewMode === 'back' ? this.stage.width() - sideX : sideX;

            const colors = ['#ffffff', '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316'];
            const color = colors[index % colors.length];
            const label = index === 0 ? 'B-' : `B${index}`;

            const points = [
                renderX, cell.cy,
                renderSideX, cell.cy,
                renderSideX, bmsY - 60,
                bmsX, bmsY - 40,
                bmsX, bmsY
            ];

            const line = new Konva.Line({
                points: points, tension: 0.4,
                stroke: color, strokeWidth: 2.5, dash: [6, 3],
                shadowColor: color, shadowBlur: 5, opacity: 0.9
            });
            this.layers.bms.add(line);

            const tagGroup = new Konva.Group({ x: renderX + 15, y: cell.cy - 15 });
            tagGroup.add(new Konva.Rect({ fill: color, cornerRadius: 4, width: 30, height: 18 }));
            tagGroup.add(new Konva.Text({ text: label, fontSize: 11, fill: color === '#ffffff' ? '#000' : '#fff', fontStyle: 'bold', x: 4, y: 3 }));
            this.layers.bms.add(tagGroup);
        });
        this.layers.bms.draw();
    }
}