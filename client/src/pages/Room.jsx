import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { usePage } from '../meta.js';
import { RoomProvider } from '../provider.js';

const LANGS = { javascript, python, markdown };
const STATUS = { connecting: 'Connecting…', connected: 'Live', offline: 'Reconnecting…', denied: 'No access', signedout: 'Signed out' };

function colorFor(id) {
  const h = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;
  return { color: `hsl(${h} 70% 45%)`, colorLight: `hsl(${h} 70% 45% / 0.22)` };
}

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--panel)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.65' },
  '.cm-gutters': { backgroundColor: 'var(--panel)', border: 'none', color: 'var(--muted)' },
});

export default function Room() {
  const { id } = useParams();
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const host = useRef(null);
  const [room, setRoom] = useState(null);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState('connecting');
  const [peers, setPeers] = useState([]);
  const [history, setHistory] = useState(null);
  const [panel, setPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  usePage(room?.name || 'Room', '', true);

  useEffect(() => {
    api(`/rooms/${id}`).then(setRoom).catch((e) => setErr(e.status === 404 ? 'This room does not exist, or you are not a member.' : e.message));
  }, [id]);

  const roomId = room?.id;
  const roomLang = room?.language;
  const userId = user?.id;
  const userName = user?.name;
  useEffect(() => {
    if (!roomId) return undefined;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const ytext = doc.getText('content');
    awareness.setLocalStateField('user', { name: userName, ...colorFor(userId) });
    awareness.on('change', () => {
      const seen = new Map();
      awareness.getStates().forEach((s, cid) => { if (cid !== doc.clientID && s.user) seen.set(cid, s.user); });
      setPeers([...seen.values()]);
    });
    const provider = new RoomProvider(id, doc, awareness, (s) => {
      setStatus(s);
      if (s === 'denied') setErr('You no longer have access to this room.');
      if (s === 'signedout') setUser(null);
    });
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          keymap.of(yUndoManagerKeymap),
          basicSetup,
          theme,
          LANGS[roomLang]?.() ?? [],
          EditorView.lineWrapping,
          yCollab(ytext, awareness, { undoManager: new Y.UndoManager(ytext) }),
        ],
      }),
    });
    return () => { provider.destroy(); view.destroy(); awareness.destroy(); doc.destroy(); };
  }, [roomId, roomLang, id, userId, userName, setUser]);

  const inviteLink = room ? `${location.origin}/join/${room.invite_code}` : '';
  const owner = room?.role === 'owner';
  const loadHistory = () => api(`/rooms/${id}/history`).then(setHistory).catch((e) => setErr(e.message));
  const act = (fn) => async () => { setErr(''); try { await fn(); } catch (x) { setErr(x.message); } };

  if (err && !room) return (
    <div className="wrap narrow stack"><h1>Can't open this room</h1><p className="error" role="alert">{err}</p><Link className="btn" to="/rooms">Your rooms</Link></div>
  );
  if (!room) return <p className="center muted">Loading…</p>;

  return (
    <div className="roomwrap">
      <div className="roombar">
        <Link to="/rooms" className="btn ghost sm">← Rooms</Link>
        <h1>{room.name}</h1>
        <span className={'status ' + status} role="status">{STATUS[status]}</span>
        <div className="peers" aria-label="People in this room">
          {peers.map((p, i) => <span key={i} className="peer" style={{ background: p.color }} title={p.name}>{p.name?.[0]?.toUpperCase()}</span>)}
        </div>
        <button className="btn ghost sm" onClick={act(async () => { if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser."); await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        <button className="btn ghost sm" aria-expanded={panel} onClick={() => { setPanel(!panel); if (!panel) loadHistory(); }}>{panel ? 'Close panel' : 'History & settings'}</button>
      </div>
      {err && <p className="error bar-err" role="alert">{err}</p>}
      <div className="roommain">
        <div className="editor" ref={host} />
        {panel && (
          <aside className="side" aria-label="Room history and settings">
            <h2>History</h2>
            <button type="button" className="btn sm" onClick={act(async () => { await api(`/rooms/${id}/history`, { method: 'POST' }); await loadHistory(); })}>Save snapshot</button>
            {history === null ? <p className="muted">Loading…</p> : history.length === 0 ? <p className="muted">No snapshots yet. Snapshots are also saved automatically while you edit.</p> : (
              <ul className="hist">
                {history.map((h) => (
                  <li key={h.id}>
                    <span>{new Date(h.created_at).toLocaleString()}<small className="muted"> {h.author ? `by ${h.author}` : 'auto'}</small></span>
                    <button type="button" className="btn ghost sm" onClick={act(async () => {
                      if (!confirm('Replace the current text with this version? The current version is saved first.')) return;
                      await api(`/rooms/${id}/history/${h.id}/restore`, { method: 'POST' });
                      await loadHistory();
                    })}>Restore</button>
                  </li>
                ))}
              </ul>
            )}
            <h2>Room</h2>
            {owner ? (
              <>
                <button className="btn ghost sm" onClick={act(async () => { const r = await api(`/rooms/${id}/invite/rotate`, { method: 'POST' }); setRoom({ ...room, invite_code: r.invite_code }); })}>Reset invite link</button>
                <button className="btn ghost sm" onClick={act(async () => { if (confirm('Delete all saved history for this room?')) { await api(`/rooms/${id}/history`, { method: 'DELETE' }); await loadHistory(); } })}>Clear history</button>
                <button className="btn danger-btn sm" onClick={act(async () => { if (confirm('Delete this room and its history for everyone?')) { await api(`/rooms/${id}`, { method: 'DELETE' }); nav('/rooms'); } })}>Delete room</button>
              </>
            ) : (
              <button className="btn danger-btn sm" onClick={act(async () => { if (confirm('Leave this room?')) { await api(`/rooms/${id}/members/me`, { method: 'DELETE' }); nav('/rooms'); } })}>Leave room</button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
