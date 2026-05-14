export class TopologyEngine {
    static analyze(doc) {
        let poles = {};
        doc.cells.forEach(c => { poles[`${c.id}_+`] = []; poles[`${c.id}_-`] = []; });
        let shortedBusbars = []; let isShorted = false;
        let adj = {}; Object.keys(poles).forEach(k => adj[k] = []);

        const getPole = (cell, side) => {
            if (side === 'front') return cell.polarity === 'positive' ? '+' : '-';
            return cell.polarity === 'positive' ? '-' : '+';
        };

        doc.busbars.forEach(b => {
            let c1 = doc.cells.find(c => c.id === b.from); let c2 = doc.cells.find(c => c.id === b.to);
            if (!c1 || !c2) return;
            let side1 = b.side || 'front';
            let p1 = `${c1.id}_${getPole(c1, side1)}`; let p2 = `${c2.id}_${getPole(c2, side1)}`;
            adj[p1].push({ to: p2, id: b.id }); adj[p2].push({ to: p1, id: b.id });
        });

        // 1. 寻找等电位面 (SuperNodes)
        let visited = new Set(); let superNodes = [];
        Object.keys(adj).forEach(startNode => {
            if (!visited.has(startNode)) {
                let comp = new Set(); let q = [startNode]; visited.add(startNode); let busbarsInComp = new Set();
                while (q.length > 0) {
                    let curr = q.shift(); comp.add(curr);
                    adj[curr].forEach(edge => {
                        busbarsInComp.add(edge.id);
                        if (!visited.has(edge.to)) { visited.add(edge.to); q.push(edge.to); }
                    });
                }
                superNodes.push({ nodes: comp, busbars: Array.from(busbarsInComp) });
            }
        });

        // 2. 短路检测
        doc.cells.forEach(c => {
            let pPos = `${c.id}_+`; let pNeg = `${c.id}_-`;
            superNodes.forEach(sn => {
                if (sn.nodes.has(pPos) && sn.nodes.has(pNeg)) {
                    isShorted = true; shortedBusbars.push(...sn.busbars);
                }
            });
        });
        shortedBusbars = [...new Set(shortedBusbars)];

        let s = 0, p = 0, v = 0, r = 0;
        let connectedCells = new Set();
        doc.busbars.forEach(b => { connectedCells.add(b.from); connectedCells.add(b.to); });
        let orphanCount = doc.cells.length - connectedCells.size;

        let bmsError = null;

        if (!isShorted && connectedCells.size > 0) {
            p = Math.max(...superNodes.map(sn => Array.from(sn.nodes).filter(n => n.endsWith('_+')).length));
            s = Math.ceil(connectedCells.size / (p || 1));
            let avgV = doc.cells.reduce((sum, c) => sum + (parseFloat(c.voltage) || 3.7), 0) / doc.cells.length;
            let avgR = doc.cells.reduce((sum, c) => sum + (parseFloat(c.resistance) || 20), 0) / doc.cells.length;
            v = (s * avgV).toFixed(2); r = ((s / p) * avgR).toFixed(2);

            // 🌟 3. BMS 灵魂引擎：构建串联有向图，计算每个节点的电位等级 (Rank)
            let snGraph = {}; let snInDegree = {};
            superNodes.forEach((_, idx) => { snGraph[idx] = new Set(); snInDegree[idx] = 0; });

            doc.cells.forEach(c => {
                let negSn = superNodes.findIndex(sn => sn.nodes.has(`${c.id}_-`));
                let posSn = superNodes.findIndex(sn => sn.nodes.has(`${c.id}_+`));
                if (negSn !== -1 && posSn !== -1 && negSn !== posSn) {
                    if (!snGraph[negSn].has(posSn)) { snGraph[negSn].add(posSn); snInDegree[posSn]++; }
                }
            });

            let snRank = {}; let q = [];
            Object.keys(snInDegree).forEach(snIdx => {
                if (snInDegree[snIdx] === 0) { q.push(Number(snIdx)); snRank[snIdx] = 0; }
            });

            let maxRank = 0;
            while (q.length > 0) {
                let curr = q.shift();
                snGraph[curr].forEach(neighbor => {
                    snRank[neighbor] = Math.max(snRank[neighbor] || 0, snRank[curr] + 1);
                    maxRank = Math.max(maxRank, snRank[neighbor]);
                    snInDegree[neighbor]--;
                    if (snInDegree[neighbor] === 0) q.push(neighbor);
                });
            }

            // 🌟 4. BMS 时序与跨级校验
            if (doc.bmsWires && doc.bmsWires.length > 0) {
                for (let i = 0; i < doc.bmsWires.length; i++) {
                    let bw = doc.bmsWires[i];
                    let cell = doc.cells.find(c => c.id === bw.cellId);
                    if (!cell) continue;

                    let expectedRank = i; // B- = 0级电位, B1 = 1级电位, B2 = 2级电位...
                    let actualRank = -1;

                    // B-接总负，其他接正
                    let snIdx = superNodes.findIndex(sn => sn.nodes.has(i === 0 ? `${cell.id}_-` : `${cell.id}_+`));
                    if (snIdx !== -1) actualRank = snRank[snIdx];

                    if (actualRank !== expectedRank) {
                        let name = i === 0 ? 'B-' : `B${i}`;
                        bmsError = `${name} 采样点连接到了错误的电位级！\n(要求在第 ${expectedRank} 级，实际却在第 ${actualRank} 级)`;
                        break; // 只要有一根线错位，直接抛出致命错误
                    }
                }
            }
        }

        return { isShorted, shortedBusbars, s, p, v, r, connectedCount: connectedCells.size, orphanCount, bmsError };
    }
}