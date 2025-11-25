// CRDT Manager: Handles the pure logic of LSEQ/RGA
// This class knows NOTHING about the UI or DOM.

class CRDTManager {
    constructor() {
        this.siteId = null;
        this.counter = 0;
        this.state = []; // The array of Char Objects
    }

    init(siteId, initialState = []) {
        this.siteId = siteId;
        this.state = initialState;
    }

    generateId() {
        this.counter++;
        return `${this.counter}@${this.siteId}`;
    }

    // Convert "Visual Index" (what user sees) to "Real Index" (including tombstones)
    findRealIndex(visualIndex) {
        let seen = 0;
        for (let i = 0; i < this.state.length; i++) {
            if (!this.state[i].tombstone) {
                if (seen === visualIndex) return i;
                seen++;
            }
        }
        return -1; // Not found (append)
    }

    // --- CORE ALGORITHMS ---

    handleLocalInsert(char, visualIndex) {
        let origin = null;
        if (visualIndex > 0) {
            const realPrevIndex = this.findRealIndex(visualIndex - 1);
            if (realPrevIndex !== -1) {
                origin = this.state[realPrevIndex].id;
            }
        }

        const charObj = {
            char: char,
            id: this.generateId(),
            origin: origin,
            tombstone: false
        };

        this.integrateInsert(charObj);
        return charObj; // Return so we can broadcast it
    }

    handleLocalDelete(visualIndex) {
        const realIndex = this.findRealIndex(visualIndex);
        if (realIndex !== -1 && this.state[realIndex]) {
            const charObj = this.state[realIndex];
            charObj.tombstone = true;
            return charObj.id; // Return ID so we can broadcast it
        }
        return null;
    }

    integrateInsert(charObj) {
        // 1. Find origin position
        let destIdx = -1;
        if (charObj.origin) {
            destIdx = this.state.findIndex(c => c.id === charObj.origin);
        }

        // 2. Scan forward for correct position (Conflict Resolution)
        let finalIdx = destIdx + 1;
        while (finalIdx < this.state.length) {
            const next = this.state[finalIdx];
            if (next.origin !== charObj.origin) break;
            if (next.id < charObj.id) break;
            finalIdx++;
        }

        // 3. Insert
        this.state.splice(finalIdx, 0, charObj);
    }

    integrateDelete(id) {
        const target = this.state.find(c => c.id === id);
        if (target) target.tombstone = true;
    }

    // Helper to get plain text string
    getText() {
        return this.state
            .filter(c => !c.tombstone)
            .map(c => c.char)
            .join('');
    }
}