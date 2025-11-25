const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

// --- STATIC SERVER ---
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? 'index.html' : req.url;
    if (filePath.startsWith('/')) filePath = filePath.slice(1);
    const ext = path.extname(filePath);
    let contentType = 'text/html';
    switch (ext) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
    }
    fs.readFile(path.join(__dirname, filePath), (err, content) => {
        if (err) { res.writeHead(404); res.end(); }
        else { res.writeHead(200, { 'Content-Type': contentType }); res.end(content, 'utf-8'); }
    });
});

// --- WEBSOCKET SERVER ---
const wss = new WebSocket.Server({ server });

let crdtState = [];
let docTitle = "Untitled.txt"; 
let clients = new Map(); 

console.log("⚡ Server Ready (RAM Mode)");

wss.on('connection', (ws) => {
    const userId = Math.floor(Math.random() * 1000000);
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
    // Default name is "Guest" until they log in
    clients.set(ws, { userId, color, name: "Guest" });

    ws.send(JSON.stringify({ 
        type: 'init', 
        snapshot: crdtState, 
        history: [], 
        title: docTitle,
        self: { userId, color } 
    }));

    ws.on('message', (message) => {
        const msgString = message.toString();
        let msg;
        try { msg = JSON.parse(msgString); } catch (e) { return; }

        // 1. HANDLE LOGIN
        if (msg.type === 'join') {
            const client = clients.get(ws);
            client.name = msg.name.substring(0, 15); // Limit length
            clients.set(ws, client);
        }
        // 2. HANDLE CURSORS (Attach Name)
        else if (msg.type === 'cursor') {
            const info = clients.get(ws);
            msg.userId = info.userId;
            msg.color = info.color;
            msg.username = info.name; // <--- SEND NAME TO EVERYONE
            broadcast(JSON.stringify(msg), ws);
        }
        // 3. HANDLE OPERATIONS
        else if (msg.type === 'operation') {
            applyServerSideOp(msg.data);
            broadcast(msgString, ws);
        } 
        // 4. HANDLE TITLE
        else if (msg.type === 'title') {
            docTitle = msg.title;
            broadcast(msgString, ws); 
        }
    });

    ws.on('close', () => { clients.delete(ws); });
});

function broadcast(data, sender) {
    wss.clients.forEach(c => { if (c!==sender && c.readyState === WebSocket.OPEN) c.send(data); });
}

function applyServerSideOp(data) {
    if (data.op === 'insert') {
        const charObj = data.charObj;
        let destIdx = -1;
        if (charObj.origin) destIdx = crdtState.findIndex(c => c.id === charObj.origin);
        let finalIdx = destIdx + 1;
        while (finalIdx < crdtState.length) {
            const next = crdtState[finalIdx];
            if (next.origin !== charObj.origin) break;
            if (next.id < charObj.id) break;
            finalIdx++;
        }
        crdtState.splice(finalIdx, 0, charObj);
    } else if (data.op === 'delete') {
        const target = crdtState.find(c => c.id === data.id);
        if (target) target.tombstone = true;
    }
}

server.listen(PORT, () => console.log(`🚀 Server ready at port ${PORT}`));
