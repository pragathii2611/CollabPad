const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

// --- 1. STATIC FILE SERVER (Serves the HTML/CSS/JS) ---
const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? 'index.html' : req.url;
    if (filePath.startsWith('/')) filePath = filePath.slice(1);
    
    const ext = path.extname(filePath);
    let contentType = 'text/html';
    switch (ext) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
    }

    fs.readFile(path.join(__dirname, filePath), (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404); res.end('404 File Not Found');
            } else {
                res.writeHead(500); res.end('500 Internal Error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// --- 2. WEBSOCKET LOGIC (RAM ONLY - NO SAVING) ---
const wss = new WebSocket.Server({ server });

// DATA STORED IN RAM ONLY
// When you restart the server, this resets to []
let operationHistory = [];
let crdtState = [];
let docTitle = "Untitled.txt"; 
let clients = new Map(); 

console.log("⚡ Server running in RAM-ONLY mode (Restart to clear data)");

wss.on('connection', (ws) => {
    const userId = Math.floor(Math.random() * 1000000);
    const color = '#' + Math.floor(Math.random()*16777215).toString(16);
    clients.set(ws, { userId, color });

    // Send current RAM state to the new user
    ws.send(JSON.stringify({ 
        type: 'init', 
        snapshot: crdtState, 
        history: [], // We don't need history replay if we send snapshot
        title: docTitle,
        self: { userId, color } 
    }));

    ws.on('message', (message) => {
        const msgString = message.toString();
        let msg;
        try { msg = JSON.parse(msgString); } catch (e) { return; }

        if (msg.type === 'operation') {
            // Apply to RAM state
            applyServerSideOp(msg.data);
            
            // Broadcast to others
            broadcast(msgString, ws);
        } 
        else if (msg.type === 'cursor' || msg.type === 'title') {
            if(msg.type === 'title') docTitle = msg.title;
            if(msg.type === 'cursor') {
                const info = clients.get(ws);
                msg.userId = info.userId;
                msg.color = info.color;
                broadcast(JSON.stringify(msg), ws);
            } else {
                broadcast(msgString, ws); 
            }
        }
    });

    ws.on('close', () => { clients.delete(ws); });
});

function broadcast(data, sender) {
    wss.clients.forEach(c => { if (c!==sender && c.readyState === WebSocket.OPEN) c.send(data); });
}

// Server Logic to keep RAM state in sync
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

server.listen(PORT, () => console.log(`🚀 Server ready at http://localhost:${PORT}`));