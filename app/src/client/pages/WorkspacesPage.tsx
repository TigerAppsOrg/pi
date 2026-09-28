import { useState } from "react";
import { WorkspaceEditor, WorkspaceModal } from "../components/WorkspaceControls";
import { IconExternal, IconPen, IconPlus, IconSearch, IconX } from "../components/Icons";
import { formatChatTime, newChatId, upsertChat } from "../lib/store";
import { useWorkspaces } from "../lib/workspaces";
import type { Workspace } from "../../shared/workspaces";

export function WorkspacesPage({ id, netid, navigate }: { id?: string; netid: string; navigate: (path: string) => void }) {
  const store = useWorkspaces();
  const [editor, setEditor] = useState<Workspace | "new" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("chats");
  const [error, setError] = useState("");
  const workspace = store.state.workspaces.find((w) => w.id === id);
  const chats = store.state.chats.filter((c) => c.workspaceId === id).sort((a, b) => b.at - a.at);
  async function newChat() {
    if (!workspace) return;
    setBusy(true); setError("");
    const chat = { id: newChatId(), title: "New chat", at: Date.now() };
    try { await store.change({ type: "assign", chatId: chat.id, workspaceId: workspace.id, title: chat.title, at: chat.at }); upsertChat(netid, chat); navigate(`/chat/${chat.id}`); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not start chat."); }
    finally { setBusy(false); }
  }
  if (store.loading) return <div className="workspace-page" aria-busy="true"><p>Loading workspaces...</p></div>;
  if (id && !workspace) return <div className="workspace-page"><h1>Workspace not found</h1><p>{store.error ?? "This workspace may have been deleted."}</p><button className="btn btn-ink" onClick={() => navigate("/workspaces")}>All workspaces</button></div>;
  const q = query.trim().toLowerCase();
  return <div className="workspace-page">
    <header className="workspace-heading">
      <div>{workspace && <button className="workspace-back" onClick={() => navigate("/workspaces")}>Workspaces /</button>}
        <h1>{workspace && <span className={`workspace-dot color-${workspace.color}`} />}{workspace?.name ?? "Workspaces"}</h1>
        <p>{workspace ? `${chats.length} ${chats.length === 1 ? "chat" : "chats"} · ${workspace.sources.length} saved ${workspace.sources.length === 1 ? "course" : "courses"} · Private` : "Your projects, plans, and courses."}</p>
      </div>
      <div className="workspace-actions">{workspace ? <><button className="btn btn-ghost" onClick={() => setEditor(workspace)}>Edit workspace</button><button className="btn btn-ink" disabled={busy} onClick={() => void newChat()}><IconPlus size={16} /> New chat</button></> : <button className="btn btn-ink" onClick={() => setEditor("new")}><IconPlus size={16} /> New workspace</button>}</div>
    </header>
    {(error || store.error) && <div className="ws-error" role="alert">{error || store.error} <button className="btn btn-ghost btn-sm" onClick={() => { setError(""); void store.refresh(); }}>Retry</button></div>}
    {!workspace ? <>
      {store.state.workspaces.length > 0 && <label className="workspace-search"><IconSearch size={16} /><input type="search" aria-label="Search workspaces" placeholder="Search workspaces" value={query} onChange={(e) => setQuery(e.target.value)} /></label>}
      <div className="workspace-grid">{store.state.workspaces.filter((w) => w.name.toLowerCase().includes(q)).map((w) => <a href={`/workspaces/${w.id}`} className={`workspace-tile color-${w.color}`} key={w.id} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(`/workspaces/${w.id}`); } }}>
        <span className="workspace-folder"><IconPen size={22} /></span><h2>{w.name}</h2><p>{w.context || "No context added yet."}</p><footer>{store.state.chats.filter((c) => c.workspaceId === w.id).length} chats<span>{w.sources.length} saved</span></footer>
      </a>)}</div>
      {store.state.workspaces.length === 0 && <div className="workspace-empty"><span className="workspace-folder color-cyan"><IconPen size={28} /></span><h2>A place for your next plan.</h2><button className="btn btn-ink" onClick={() => setEditor("new")}><IconPlus size={16} /> Create workspace</button></div>}
      {q && !store.state.workspaces.some((w) => w.name.toLowerCase().includes(q)) && <p className="workspace-empty">No matching workspaces.</p>}
    </> : <>
      <div className="workspace-tabs" role="tablist" aria-label="Workspace views">{["chats", "saved", "context"].map((t, i, tabs) => <button key={t} role="tab" id={`ws-tab-${t}`} aria-controls={`ws-panel-${t}`} aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} onKeyDown={(e) => {
        const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i + tabs.length - 1) % tabs.length] : e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : null;
        if (next) { e.preventDefault(); setTab(next); document.getElementById(`ws-tab-${next}`)?.focus(); }
      }}>{t === "chats" ? `Chats (${chats.length})` : t === "saved" ? `Saved (${workspace.sources.length})` : "Context"}</button>)}</div>
      <section role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`}>
        {tab === "chats" && <>
          <div className="workspace-chat-list">{chats.map((chat) => <div className="workspace-chat-row" key={chat.id}><a href={`/chat/${chat.id}`} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); navigate(`/chat/${chat.id}`); } }}><IconPen size={17} /><strong>{chat.title}</strong><time>{formatChatTime(chat.at)}</time></a><button className="ws-icon" title="Remove from workspace" aria-label={`Remove ${chat.title} from workspace`} onClick={() => void store.change({ type: "assign", chatId: chat.id, workspaceId: null, title: chat.title, at: chat.at }).catch(() => {})}><IconX size={15} /></button></div>)}</div>
          {chats.length === 0 && <div className="workspace-empty"><h2>What are you working on?</h2><button className="btn btn-ink" disabled={busy} onClick={() => void newChat()}><IconPlus size={16} /> Start a chat</button></div>}
        </>}
        {tab === "saved" && <div className="workspace-sources">{workspace.sources.map((s) => <article className="workspace-source" key={s.id}><a href={s.url} target="_blank" rel="noreferrer"><strong>{s.code}</strong><span>{s.title}</span><IconExternal size={16} /></a><button className="ws-icon" aria-label={`Remove ${s.code ?? s.title}`} title="Remove saved course" onClick={() => void store.change({ type: "unsave", id: workspace.id, sourceId: s.id }).catch(() => {})}><IconX size={16} /></button></article>)}{workspace.sources.length === 0 && <div className="workspace-empty"><h2>No saved courses yet.</h2><button className="btn btn-ghost" disabled={busy} onClick={() => void newChat()}>Find courses with PI</button></div>}</div>}
        {tab === "context" && <div className="workspace-context"><div><h2>Context for PI</h2><button className="btn btn-ghost" onClick={() => setEditor(workspace)}>Edit context</button></div><p className={!workspace.context ? "muted" : ""}>{workspace.context || "No goals or notes added yet."}</p></div>}
      </section>
      <footer className="workspace-footer"><span>Private to your Princeton account</span><button className="workspace-delete" onClick={() => setDeleting(true)}>Delete workspace</button></footer>
    </>}
    {editor && <WorkspaceEditor workspace={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onCreated={(newId) => navigate(`/workspaces/${newId}`)} />}
    {deleting && workspace && <WorkspaceModal title={`Delete ${workspace.name}?`} onClose={() => { if (!busy) setDeleting(false); }}><p>Its saved courses and context will be removed. Your chats will stay in your chat list.</p><footer><button className="btn btn-ghost" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button><button className="btn btn-ink" disabled={busy} onClick={async () => { setBusy(true); try { await store.change({ type: "delete", id: workspace.id }); navigate("/workspaces"); } catch (err) { setError(String(err)); setDeleting(false); } finally { setBusy(false); } }}>{busy ? "Deleting..." : "Delete workspace"}</button></footer></WorkspaceModal>}
  </div>;
}
