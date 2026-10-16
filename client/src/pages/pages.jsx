import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { usePage } from '../meta.js';

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com';
const safeNext = (n) => (/^\/(?!\/)/.test(n || '') ? n : '/rooms');

export function Landing() {
  usePage('', '');
  const { user } = useAuth();
  return (
    <div className="wrap hero">
      <div>
        <h1>Write it together, while it's being written.</h1>
        <p className="lead">Open a room, share the invite link, and edit code or notes at the same time. Every cursor is visible. Every change is saved.</p>
        <p className="row">
          {user ? <Link className="btn" to="/rooms">Open your rooms</Link> : (<>
            <Link className="btn" to="/signup">Create a room</Link>
            <Link className="btn ghost" to="/login">Log in</Link>
          </>)}
        </p>
      </div>
      <img src="/hero.svg" width="560" height="360"
        alt="A code file open in Syncpad with two collaborators' labelled cursors editing different lines at once" />
      <ul className="facts">
        <li><strong>Rooms with invite links.</strong> Only people you invite can read or edit a room, and you can rotate the link any time.</li>
        <li><strong>Edits merge, not overwrite.</strong> Two people typing on the same line both keep their changes.</li>
        <li><strong>History you can restore.</strong> Save a snapshot or roll back to an earlier version. Restoring keeps the current version too.</li>
      </ul>
    </div>
  );
}

function AuthForm({ mode }) {
  const signup = mode === 'signup';
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  usePage(signup ? 'Sign up' : 'Log in', signup ? 'Create a Syncpad account to start editing with your team.' : 'Log in to your Syncpad account.');
  const [f, setF] = useState({ name: '', email: '', password: '', website: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/rooms" replace />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const d = await api(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: f });
      if (d?.user) { setUser(d.user); nav(safeNext(params.get('next')), { replace: true }); }
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }

  return (
    <form className="wrap narrow stack" onSubmit={submit}>
      <h1>{signup ? 'Create your account' : 'Log in'}</h1>
      {signup && <label>Name<input placeholder="e.g. Alex Morgan" value={f.name} onChange={set('name')} required maxLength={50} autoComplete="name" /></label>}
      <label>Email<input type="email" placeholder="you@example.com" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
      <label>Password<input type="password" placeholder={signup ? "Create a strong password" : "Enter your password"} value={f.password} onChange={set('password')} required
        minLength={signup ? 10 : 1} autoComplete={signup ? 'new-password' : 'current-password'} />
        {signup && <small>At least 10 characters.</small>}
      </label>
      {signup && <input className="hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} />}
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn" disabled={busy}>{signup ? 'Create account' : 'Log in'}</button>
      {signup && <small>By creating an account you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</small>}
      <small>{signup ? <>Already registered? <Link to="/login">Log in</Link></> : <>New here? <Link to="/signup">Create an account</Link></>}</small>
    </form>
  );
}
export const Login = () => <AuthForm mode="login" />;
export const Signup = () => <AuthForm mode="signup" />;

const Draft = () => import.meta.env.DEV && (
  <p className="notice">Template. Review this page against what your deployment actually collects before launch. It is not legal advice.</p>
);

export function Privacy() {
  usePage('Privacy Policy', 'What Syncpad stores, why, and how to delete it.');
  return (
    <div className="wrap prose">
      <h1>Privacy Policy</h1><Draft />
      <h2>What we store</h2>
      <ul>
        <li>Account: your name, email address and a salted hash of your password (never the password itself).</li>
        <li>Content: the text of the rooms you create or join, the edit history snapshots of those rooms, and room membership.</li>
        <li>Session: sign-in tokens, described under Cookies.</li>
      </ul>
      <h2>Cookies</h2>
      <p>Syncpad sets two strictly necessary cookies to keep you signed in: a short-lived access cookie (15 minutes) and a refresh cookie (7 days). Both are HttpOnly and sent only to this site. We do not use analytics, advertising or third-party tracking cookies.</p>
      <h2>Who can see your content</h2>
      <p>Only members of a room can read or edit it. Anyone with a room's invite link can join, so share links carefully. The room owner can rotate the link at any time.</p>
      <h2>Retention and deletion</h2>
      <p>Content is kept until you delete it. Owners can delete a room, which removes its content and history. You can delete your account from the Rooms page, which removes your account, rooms you own, your memberships and your sessions. Backups are overwritten on the normal backup schedule.</p>
      <h2>Contact</h2>
      <p>Questions or requests about your data: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    </div>
  );
}

export function Terms() {
  usePage('Terms of Service', 'The rules for using Syncpad.');
  return (
    <div className="wrap prose">
      <h1>Terms of Service</h1><Draft />
      <h2>Your content</h2><p>You own what you write. You give Syncpad permission to store it and show it to the people you share it with so the service can work.</p>
      <h2>Acceptable use</h2><p>Do not use Syncpad to break the law, harass others, store content you have no right to share, or interfere with the service, including by sending automated or excessive traffic.</p>
      <h2>Accounts</h2><p>Keep your password private. You are responsible for activity under your account. We may suspend accounts that break these terms.</p>
      <h2>No warranty</h2><p>Syncpad is provided as is. Keep your own copies of important work. To the extent the law allows, we are not liable for lost data or indirect damages.</p>
      <h2>Changes</h2><p>We may update these terms and will post the new version on this page.</p>
      <h2>Contact</h2><p><a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </div>
  );
}

export function NotFound() {
  usePage('Page not found', 'This page does not exist.', true);
  return (
    <div className="wrap narrow stack">
      <h1>Page not found</h1>
      <p>The address may be mistyped, or the page has moved.</p>
      <p className="row"><Link className="btn" to="/">Go to the home page</Link><Link className="btn ghost" to="/rooms">Your rooms</Link></p>
    </div>
  );
}
