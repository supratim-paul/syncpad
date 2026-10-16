import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { usePage } from '../meta.js';

export function Join() {
  usePage('Joining room', '', true);
  const { code } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/rooms/join', { method: 'POST', body: { code } })
      .then((r) => nav(`/room/${r.id}`, { replace: true }))
      .catch((e) => setErr(e.message));
  }, [code, nav]);
  return (
    <div className="wrap narrow stack">
      {err ? (<><h1>Can't join this room</h1><p className="error" role="alert">{err}</p><Link className="btn" to="/rooms">Your rooms</Link></>)
        : <p className="muted">Joining room…</p>}
    </div>
  );
}

export default function Rooms() {
  usePage('Your rooms', '', true);
  const nav = useNavigate();
  const { setUser } = useAuth();
  const [rooms, setRooms] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', kind: 'code', language: 'javascript' });
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { api('/rooms').then(setRooms).catch((e) => setErr(e.message)); }, []);

  const run = (fn) => async (e) => { e.preventDefault(); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } };
  const create = run(async () => { const r = await api('/rooms', { method: 'POST', body: form }); nav(`/room/${r.id}`); });
  const join = run(async () => {
    const c = code.trim().split('/').filter(Boolean).pop() || '';
    const r = await api('/rooms/join', { method: 'POST', body: { code: c } });
    nav(`/room/${r.id}`);
  });
  const copyInvite = (r) => async () => {
    setErr('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Open the room and copy the link from the address you share.');
      await navigator.clipboard.writeText(`${location.origin}/join/${r.invite_code}`);
      setCopied(r.id); setTimeout(() => setCopied(''), 1500);
    } catch (x) { setErr(x.message); }
  };
  const removeRoom = (r) => async () => {
    const owner = r.role === 'owner';
    if (!confirm(owner ? `Delete "${r.name}" and its history for everyone?` : `Leave "${r.name}"?`)) return;
    setErr('');
    try {
      await api(owner ? `/rooms/${r.id}` : `/rooms/${r.id}/members/me`, { method: 'DELETE' });
      setRooms((list) => list.filter((x) => x.id !== r.id));
    } catch (x) { setErr(x.message); }
  };
  const deleteAccount = run(async () => {
    if (!confirm('Delete your account and every room you own? This cannot be undone.')) return;
    await api('/auth/me', { method: 'DELETE', body: { password: pw } });
    setUser(null); nav('/');
  });

  return (
    <div className="wrap stack">
      <h1>Your rooms</h1>
      {err && <p className="error" role="alert">{err}</p>}
      {rooms === null ? <p className="muted">Loading…</p> : rooms.length === 0 ? (
        <p className="muted">You have no rooms yet. Create one below, or paste an invite link to join a teammate's room.</p>
      ) : (
        <ul className="rooms">
          {rooms.map((r) => (
            <li key={r.id}>
              <div className="rinfo">
                <Link to={`/room/${r.id}`}>{r.name}</Link>
                <span className="muted">{r.kind === 'notes' ? 'Notes' : r.language} · {r.role} · edited {new Date(r.updated_at).toLocaleDateString()}</span>
              </div>
              <div className="actions">
                <button type="button" className="btn sm" onClick={() => nav(`/room/${r.id}`)}>Open</button>
                <button type="button" className="btn ghost sm" onClick={copyInvite(r)}>{copied === r.id ? 'Copied' : 'Copy invite'}</button>
                <button type="button" className="btn ghost sm" onClick={removeRoom(r)}>{r.role === 'owner' ? 'Delete' : 'Leave'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="split">
        <form className="stack" onSubmit={create}>
          <h2>Create a room</h2>
          <label>Room name<input placeholder="e.g. Sprint planning notes" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></label>
          <label>Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="code">Code</option><option value="notes">Notes</option>
            </select>
          </label>
          {form.kind === 'code' && (
            <label>Language
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
                <option value="javascript">JavaScript</option><option value="python">Python</option><option value="text">Plain text</option>
              </select>
            </label>
          )}
          <button type="submit" className="btn">Create room</button>
        </form>
        <form className="stack" onSubmit={join}>
          <h2>Join a room</h2>
          <label>Invite link or code<input placeholder="Paste an invite link or room code" value={code} onChange={(e) => setCode(e.target.value)} required /></label>
          <button type="submit" className="btn ghost">Join room</button>
        </form>
      </div>

      <details className="danger">
        <summary>Delete account</summary>
        <form className="stack" onSubmit={deleteAccount}>
          <p>This permanently removes your account, the rooms you own and their history.</p>
          <label>Confirm password<input type="password" placeholder="Enter your password to confirm" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="current-password" /></label>
          <button type="submit" className="btn danger-btn">Delete my account</button>
        </form>
      </details>
    </div>
  );
}
