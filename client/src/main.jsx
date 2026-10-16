import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.error(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wrap narrow stack">
        <h1>Something went wrong</h1>
        <p>Your work is saved. Reload the page to continue.</p>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <Boundary>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </Boundary>
);
