import { useEffect, useState, type FormEvent } from 'react';

interface PurlMapping {
  id: number;
  path: string;
  targetUrl: string;
  title: string;
  description: string | null;
  isActive: boolean;
}

interface PurlDraft {
  id: number;
  path: string;
  title: string;
  targetUrl: string;
  description: string;
  isActive: boolean;
}

const emptyCreateForm = { title: '', path: '', targetUrl: '', description: '' };

async function getErrorMessage(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') {
    return payload.error;
  }
  return `Request failed (${response.status}).`;
}

export function PurlManager() {
  const [purls, setPurls] = useState<PurlMapping[]>([]);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editing, setEditing] = useState<PurlDraft | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;

    async function loadPurls() {
      try {
        const response = await fetch('/api/admin/purls');
        if (response.status === 401) {
          window.location.assign('/api/admin/auth/github');
          return;
        }
        if (!response.ok) throw new Error(await getErrorMessage(response));
        const data = await response.json() as PurlMapping[];
        if (current) setPurls(data);
      } catch (loadError) {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Unable to load PURLs.');
      } finally {
        if (current) setLoading(false);
      }
    }

    void loadPurls();
    return () => { current = false; };
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const response = await fetch('/api/admin/purls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const created = await response.json() as PurlMapping;
      setPurls((current) => [created, ...current]);
      setCreateForm(emptyCreateForm);
      setNotice(`Created ${created.path}.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create PURL.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/purls/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editing.title,
          targetUrl: editing.targetUrl,
          description: editing.description,
          isActive: editing.isActive,
        }),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const updated = await response.json() as PurlMapping;
      setPurls((current) => current.map((purl) => purl.id === updated.id ? updated : purl));
      setEditing(null);
      setNotice(`Updated ${updated.path}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update PURL.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    window.location.assign('/api/admin/auth/github');
  }

  function startEditing(purl: PurlMapping) {
    setEditing({
      id: purl.id,
      path: purl.path,
      title: purl.title,
      targetUrl: purl.targetUrl,
      description: purl.description ?? '',
      isActive: purl.isActive,
    });
    setError('');
    setNotice('');
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visiblePurls = purls.filter((purl) =>
    !normalizedQuery || `${purl.title} ${purl.path} ${purl.targetUrl}`.toLowerCase().includes(normalizedQuery),
  );
  const activeCount = purls.filter((purl) => purl.isActive).length;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="topbar">
        <a className="brand" href="/admin" aria-label="PURL Registry home">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>PURL <strong>Registry</strong></span>
        </a>
        <button className="button button-quiet signout-button" type="button" onClick={handleSignOut}>Sign out</button>
      </header>

      <main id="main-content" className="page-shell">
        <section className="page-heading" aria-labelledby="page-title">
          <div><p className="eyebrow">LINK REGISTRY</p><h1 id="page-title">PURL management</h1></div>
          <p className="heading-note">Persistent addresses, carefully maintained.</p>
        </section>

        <dl className="summary-strip" aria-label="PURL totals">
          <div><dt>Total PURLs</dt><dd>{purls.length}</dd></div>
          <div><dt>Active</dt><dd>{activeCount}</dd></div>
          <div><dt>Inactive</dt><dd>{purls.length - activeCount}</dd></div>
        </dl>

        <section className="create-section" aria-labelledby="create-title">
          <div className="section-heading"><div><p className="eyebrow">NEW RECORD</p><h2 id="create-title">Create a PURL</h2></div></div>
          <form className="create-form" onSubmit={handleCreate}>
            <div className="field field-title">
              <label htmlFor="new-title">Internal title</label>
              <input id="new-title" name="title" maxLength={200} required value={createForm.title}
                onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} />
            </div>
            <div className="field field-path">
              <label htmlFor="new-path">PURL path</label>
              <input id="new-path" name="path" placeholder="/research/dataset-alpha" maxLength={500} required value={createForm.path}
                onChange={(event) => setCreateForm({ ...createForm, path: event.target.value })} />
            </div>
            <div className="field field-target">
              <label htmlFor="new-target">Destination URL</label>
              <input id="new-target" name="targetUrl" type="url" placeholder="https://archive.example.org/data/" maxLength={2048} required value={createForm.targetUrl}
                onChange={(event) => setCreateForm({ ...createForm, targetUrl: event.target.value })} />
            </div>
            <div className="field field-description">
              <label htmlFor="new-description">Description <span>(optional)</span></label>
              <input id="new-description" name="description" maxLength={2000} value={createForm.description}
                onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} />
            </div>
            <button className="button button-primary create-button" type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create PURL'}
            </button>
          </form>
        </section>

        <section className="registry-section" aria-labelledby="registry-title">
          <div className="section-heading registry-heading">
            <div><p className="eyebrow">DIRECTORY</p><h2 id="registry-title">Registered PURLs <span className="record-count">{purls.length}</span></h2></div>
            <div className="search-field"><label htmlFor="purl-search">Search PURLs</label><input id="purl-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          </div>

          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

          {loading ? (
            <div className="loading-state" role="status" aria-label="Loading PURLs"><span /><span /><span /></div>
          ) : purls.length === 0 ? (
            <div className="empty-state">
              <span className="empty-mark" aria-hidden="true">/</span>
              <h3>No PURLs yet</h3>
              <p>Your first permanent address will appear here.</p>
              <a className="button button-secondary" href="#new-title">Create the first PURL</a>
            </div>
          ) : visiblePurls.length === 0 ? (
            <p className="empty-search">No PURLs match “{query}”.</p>
          ) : (
            <div className="table-scroll" tabIndex={0} aria-label="Scrollable PURL directory">
              <table>
                <caption className="visually-hidden">Registered PURLs and their current destinations</caption>
                <thead><tr><th scope="col">Title</th><th scope="col">PURL path</th><th scope="col">Destination</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {visiblePurls.map((purl) => editing?.id === purl.id ? (
                    <tr className="edit-row" key={purl.id}>
                      <td colSpan={5}>
                        <form className="edit-form" onSubmit={handleUpdate}>
                          <div className="edit-path"><span className="eyebrow">IMMUTABLE PATH</span><code>{editing.path}</code></div>
                          <div className="edit-fields">
                            <div className="field"><label htmlFor={`edit-title-${purl.id}`}>Internal title</label><input id={`edit-title-${purl.id}`} maxLength={200} required value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></div>
                            <div className="field"><label htmlFor={`edit-target-${purl.id}`}>Destination URL</label><input id={`edit-target-${purl.id}`} type="url" maxLength={2048} required value={editing.targetUrl} onChange={(event) => setEditing({ ...editing, targetUrl: event.target.value })} /></div>
                            <div className="field"><label htmlFor={`edit-description-${purl.id}`}>Description</label><input id={`edit-description-${purl.id}`} maxLength={2000} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></div>
                          </div>
                          <div className="edit-footer">
                            <label className="active-toggle"><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} /> Active</label>
                            <div className="button-row">
                              <button className="button button-quiet" type="button" onClick={() => setEditing(null)}>Cancel</button>
                              <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                            </div>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={purl.id}>
                      <td><strong className="record-title">{purl.title}</strong>{purl.description && <span className="record-description">{purl.description}</span>}</td>
                      <td><code className="path-value">{purl.path}</code></td>
                      <td><a className="target-link" href={purl.targetUrl} target="_blank" rel="noreferrer">{purl.targetUrl}</a></td>
                      <td><span className={`status ${purl.isActive ? 'status-active' : 'status-inactive'}`}><span aria-hidden="true" />{purl.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td><button className="button button-quiet edit-button" type="button" onClick={() => startEditing(purl)} aria-label={`Edit ${purl.title}`}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}