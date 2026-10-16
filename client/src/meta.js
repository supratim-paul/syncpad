import { useEffect } from 'react';

const DEFAULT_TITLE = 'Syncpad | Real-time collaborative code and notes';
const DEFAULT_DESC = 'Write code and notes together in real time. Shared rooms, live cursors and saved history.';

function setMeta(name, content) {
  let m = document.head.querySelector(`meta[name="${name}"]`);
  if (!m) { m = document.createElement('meta'); m.name = name; document.head.appendChild(m); }
  m.content = content;
}

// Unique title + description per page; private app pages are marked noindex.
export function usePage(title, description, priv = false) {
  useEffect(() => {
    document.title = title ? `${title} | Syncpad` : DEFAULT_TITLE;
    setMeta('description', description || DEFAULT_DESC);
    setMeta('robots', priv ? 'noindex, nofollow' : 'index, follow');
  }, [title, description, priv]);
}
