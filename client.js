// Client Controller: Glues UI, Network, and CRDT together

const crdt = new CRDTManager();
let USER_COLOR;

// UI References
const editor = document.getElementById('editor');
const titleInput = document.getElementById('doc-title');
const statusBadge = document.getElementById('status-badge');
const charCountEl = document.getElementById('char-count');
const wordCountEl = document.getElementById('word-count');
const cursorLayer = document.getElementById('cursor-layer');

// --- 1. NETWORK SETUP ---
let wsUrl = 'ws://localhost:8080';
if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${protocol}//${window.location.host}`;
}
const ws = new WebSocket(wsUrl);

ws.onopen = () => { statusBadge.innerText = "Connected"; };
ws.onclose = () => { statusBadge.innerText = "Disconnected"; };

ws.onmessage = async (event) => {
    let textData = event.data instanceof Blob ? await event.data.text() : event.data;
    const msg = JSON.parse(textData);

    switch (msg.type) {
        case 'init':
            if (msg.self) { 
                crdt.init(msg.self.userId, []); // Set ID
                USER_COLOR = msg.self.color; 
            }
            if (msg.title) titleInput.value = msg.title;
            
            // Hydrate CRDT
            if (msg.snapshot) crdt.state = msg.snapshot;
            if (msg.history) msg.history.forEach(op => applyRemoteOp(op));
            
            render();
            break;

        case 'operation':
            applyRemoteOp(msg.data);
            render();
            break;

        case 'cursor':
            renderRemoteCursor(msg);
            break;
            
        case 'title':
            titleInput.value = msg.title;
            break;
    }
};

function applyRemoteOp(data) {
    if (data.op === 'insert') {
        if (!crdt.state.find(c => c.id === data.charObj.id)) {
            crdt.integrateInsert(data.charObj);
        }
    } else if (data.op === 'delete') {
        crdt.integrateDelete(data.id);
    }
}

// --- 2. INPUT HANDLING ---
let lastValue = "";

editor.addEventListener('input', (e) => {
    const newValue = e.target.value;
    
    // Naive Diffing (Good enough for MVP)
    if (newValue.length > lastValue.length) {
        // Insert
        let i = 0; while (i < lastValue.length && lastValue[i] === newValue[i]) i++;
        const char = newValue[i];
        const op = crdt.handleLocalInsert(char, i);
        ws.send(JSON.stringify({ type: 'operation', data: { op: 'insert', charObj: op } }));
    } else if (newValue.length < lastValue.length) {
        // Delete
        let i = 0; while (i < newValue.length && newValue[i] === lastValue[i]) i++;
        const id = crdt.handleLocalDelete(i);
        if (id) {
            ws.send(JSON.stringify({ type: 'operation', data: { op: 'delete', id: id } }));
        }
    }
    
    lastValue = newValue;
    updateStats(newValue);
});

// --- 3. UI RENDERING ---
function render() {
    const text = crdt.getText();
    if (editor.value !== text) {
        const saveCursor = editor.selectionStart;
        editor.value = text;
        editor.setSelectionRange(saveCursor, saveCursor);
        lastValue = text;
    }
    updateStats(text);
}

function updateStats(text) {
    charCountEl.innerText = `${text.length} chars`;
    wordCountEl.innerText = `${text.trim().split(/\s+/).filter(w=>w.length>0).length} words`;
}

// --- 4. EXTRAS (Cursors, Title, Buttons) ---
titleInput.addEventListener('input', () => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'title', title: titleInput.value }));
});

['keyup', 'click', 'input'].forEach(evt => {
    editor.addEventListener(evt, () => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'cursor', index: editor.selectionStart }));
        }
    });
});

// Font Math
let CHAR_WIDTH = 0;
const LINE_HEIGHT = 24; 
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
ctx.font = "16px 'Courier Prime'"; 
CHAR_WIDTH = ctx.measureText("M").width;

function renderRemoteCursor(msg) {
    const existing = document.getElementById(`cursor-${msg.userId}`);
    if (existing) existing.remove();
    
    const index = Math.min(msg.index, editor.value.length);
    const textUpToCursor = editor.value.substring(0, index);
    const lines = textUpToCursor.split('\n');
    const row = lines.length - 1;
    const col = lines[lines.length - 1].length;
    
    const top = row * LINE_HEIGHT;
    const left = col * CHAR_WIDTH;
    
    const cursor = document.createElement('div');
    cursor.id = `cursor-${msg.userId}`;
    cursor.className = 'remote-cursor';
    cursor.style.top = `${top}px`;
    cursor.style.left = `${left}px`;
    
    const flag = document.createElement('div');
    flag.className = 'flag';
    flag.innerText = `User ${msg.userId}`;
    cursor.appendChild(flag);
    cursorLayer.appendChild(cursor);
}

// Global functions for HTML buttons
window.downloadTxt = () => {
    const blob = new Blob([editor.value], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = titleInput.value + ".txt";
    a.click();
};
window.copyToClipboard = () => { editor.select(); document.execCommand('copy'); };
window.clearDoc = () => { if(confirm("Clear Document?")) location.reload(); };