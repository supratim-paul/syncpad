import { Routes, Route, Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import { Landing, Login, Signup, Privacy, Terms, NotFound } from './pages/pages.jsx';
import Rooms, { Join } from './pages/Rooms.jsx';
import Room from './pages/Room.jsx';

function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const inRoom = pathname.startsWith('/room/');
  return (
    <div className={'app' + (inRoom ? ' fixed' : '')}>
      <header className="bar">
        <Link to={user ? '/rooms' : '/'} className="logo" aria-label="Syncpad home">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="13" height="16" rx="2" fill="#6e56cf" />
            <rect x="8" y="3" width="13" height="16" rx="2" fill="#12a594" fillOpacity=".85" />
          </svg>
          Syncpad
        </Link>
        <nav aria-label="Main">
          {user && (<><Link className="btn ghost sm" to="/rooms">Rooms</Link><button type="button" onClick={logout} className="btn ghost sm">Log out</button></>)}
          {user === null && (<><Link className="btn ghost sm" to="/login">Log in</Link><Link className="btn sm" to="/signup">Sign up</Link></>)}
        </nav>
      </header>
      <main><Outlet /></main>
      {!inRoom && (
        <footer>
          <span>© {new Date().getFullYear()} Syncpad</span>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </footer>
      )}
    </div>
  );
}

export function Guard({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return <p className="center muted">Loading…</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="login" element={<Login />} />
          <Route path="signup" element={<Signup />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="terms" element={<Terms />} />
          <Route path="rooms" element={<Guard><Rooms /></Guard>} />
          <Route path="room/:id" element={<Guard><Room /></Guard>} />
          <Route path="join/:code" element={<Guard><Join /></Guard>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
