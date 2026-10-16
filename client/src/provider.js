import * as sync from 'y-protocols/sync';
import * as aw from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { api, refreshSession } from './api.js';

const SYNC = 0;
const AWARENESS = 1;

// Minimal Yjs provider for the Syncpad server. Status: connecting | connected | offline | denied | signedout
export class RoomProvider {
  constructor(roomId, doc, awareness, onStatus) {
    Object.assign(this, { roomId, doc, awareness, onStatus, ws: null, retries: 0, dead: false, timer: null, opened: false });

    this.onDoc = (update, origin) => {
      if (origin !== this) this.send(SYNC, (e) => sync.writeUpdate(e, update));
    };
    this.onAware = ({ added, updated, removed }) => {
      const mine = added.concat(updated, removed).filter((id) => id === this.doc.clientID);
      if (mine.length) this.send(AWARENESS, (e) => encoding.writeVarUint8Array(e, aw.encodeAwarenessUpdate(this.awareness, mine)));
    };
    this.wake = () => {
      if (this.dead || document.visibilityState === 'hidden' || this.ws?.readyState === 0 || this.ws?.readyState === 1) return;
      clearTimeout(this.timer);
      this.retries = 0;
      this.connect();
    };
    this.onUnload = () => aw.removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload');

    doc.on('update', this.onDoc);
    awareness.on('update', this.onAware);
    window.addEventListener('beforeunload', this.onUnload);
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
    this.connect();
  }

  send(type, write) {
    if (this.ws?.readyState !== 1) return;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, type);
    write(e);
    this.ws.send(encoding.toUint8Array(e));
  }

  connect() {
    if (this.dead) return;
    this.onStatus('connecting');
    this.opened = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'; // never ws:// on an https page
    const ws = new WebSocket(`${scheme}://${location.host}/ws/${this.roomId}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.opened = true;
      this.retries = 0;
      this.onStatus('connected');
      this.send(SYNC, (e) => sync.writeSyncStep1(e, this.doc));
      if (this.awareness.getLocalState() !== null)
        this.send(AWARENESS, (e) => encoding.writeVarUint8Array(e, aw.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])));
    };

    ws.onmessage = (ev) => {
      const dec = decoding.createDecoder(new Uint8Array(ev.data));
      const type = decoding.readVarUint(dec);
      if (type === SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, SYNC);
        sync.readSyncMessage(dec, enc, this.doc, this);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      } else if (type === AWARENESS) {
        aw.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
      }
    };

    ws.onclose = async (ev) => {
      if (this.dead) return;
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
      aw.removeAwarenessStates(this.awareness, others, this);
      if ([4403, 4404, 4410].includes(ev.code)) return this.onStatus('denied');
      this.onStatus('offline');
      const ok = await refreshSession().catch(() => null); // token may have expired
      if (this.dead) return;
      if (ok === false) return this.onStatus('signedout');
      if (ev.code === 4401) return this.connect(); // token just rolled over, reconnect at once
      if (!this.opened) {
        try { await api(`/rooms/${this.roomId}`); }
        catch (e) { if (e.status === 404) return this.onStatus('denied'); }
      }
      this.timer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retries++, 15000));
    };
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.timer);
    this.onUnload();
    this.doc.off('update', this.onDoc);
    this.awareness.off('update', this.onAware);
    window.removeEventListener('beforeunload', this.onUnload);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('online', this.wake);
    this.ws?.close();
  }
}
