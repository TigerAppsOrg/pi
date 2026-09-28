import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { WORKSPACE_COLORS, type Workspace, type WorkspaceColor } from "../../shared/workspaces";
import { useWorkspaces } from "../lib/workspaces";
import { IconCheck, IconPlus, IconStar, IconX } from "./Icons";

export function WorkspaceModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="workspace-modal" ref={ref} aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <header><h2 id={id}>{title}</h2><button className="ws-icon" title="Close" aria-label="Close" onClick={onClose}><IconX size={18} /></button></header>
    {children}
  </dialog>;
}

export function WorkspaceEditor({ workspace, onClose, onCreated }: { workspace?: Workspace; onClose: () => void; onCreated?: (id: string) => void }) {
  const store = useWorkspaces();
  const [name, setName] = useState(workspace?.name ?? "");
  const [color, setColor] = useState<WorkspaceColor>(workspace?.color ?? "cyan");
  const [context, setContext] = useState(workspace?.context ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    try {
      const next = await store.change(workspace
        ? { type: "update", id: workspace.id, name: name.trim(), color, context, updatedAt: workspace.updatedAt }
        : { type: "create", name: name.trim(), color });
      onClose();
      if (!workspace) onCreated?.(next.workspaces[0].id);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
    finally { setPending(false); }
  }
  return <WorkspaceModal title={workspace ? "Edit workspace" : "New workspace"} onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={save} className="workspace-form">
      <label>Name<input autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Fall course planning" /></label>
      <fieldset className="workspace-colors"><legend>Color</legend>{WORKSPACE_COLORS.map((c) => <label key={c} className={`ws-color color-${c}`} title={c}>
        <input type="radio" name="workspace-color" value={c} checked={color === c} onChange={() => setColor(c)} aria-label={c} />
        {color === c && <IconCheck size={16} />}
      </label>)}</fieldset>
      {workspace && <label>Context for PI<textarea rows={6} maxLength={12000} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Goals, requirements, preferences, or notes for this workspace" /></label>}
      {error && <p className="ws-error" role="alert">{error}</p>}
      <footer><button type="button" className="btn btn-ghost" disabled={pending} onClick={onClose}>Cancel</button><button className="btn btn-ink" disabled={pending || !name.trim()}>{pending ? "Saving..." : workspace ? "Save changes" : "Create workspace"}</button></footer>
    </form>
  </WorkspaceModal>;
}

export function SaveSourceButton({ title, code, url }: { title: string; code?: string; url: string }) {
  const store = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const saved = store.state.workspaces.some((w) => w.sources.some((s) => s.url === url));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError("");
    try { await store.change({ type: "save", id: target, title, code, url }); setOpen(false); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save."); }
    finally { setPending(false); }
  }
  return <>
    <button className={`ws-icon course-save${saved ? " saved" : ""}`} title={saved ? "Saved to a workspace" : "Save to workspace"} aria-label={`Save ${code ?? title} to workspace`} onClick={() => { setTarget(store.state.workspaces[0]?.id ?? ""); setError(""); setOpen(true); }}><IconStar size={17} /></button>
    {open && !creating && <WorkspaceModal title="Save to workspace" onClose={() => { if (!pending) setOpen(false); }}><form className="workspace-form" onSubmit={save}>
      <p className="source-preview"><strong>{code}</strong> {title}</p>
      {store.state.workspaces.length > 0 && <label>Workspace<select aria-label="Workspace" autoFocus required value={target} onChange={(e) => setTarget(e.target.value)}>{store.state.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}{w.sources.some((s) => s.url === url) ? " (saved)" : ""}</option>)}</select></label>}
      <button className="btn btn-ghost" type="button" onClick={() => setCreating(true)}><IconPlus size={15} /> New workspace</button>
      {(error || store.error) && <p className="ws-error" role="alert">{error || store.error}</p>}
      <footer><button className="btn btn-ink" disabled={pending || !target}>{pending ? "Saving..." : "Save course"}</button></footer>
    </form></WorkspaceModal>}
    {creating && <WorkspaceEditor onClose={() => setCreating(false)} onCreated={(id) => { setTarget(id); setCreating(false); }} />}
  </>;
}

export function ChatWorkspaceBar({ chatId, title, navigate, busy }: { chatId: string; title: string; navigate: (path: string) => void; busy: boolean }) {
  const store = useWorkspaces();
  const membership = store.state.chats.find((c) => c.id === chatId);
  const workspace = store.state.workspaces.find((w) => w.id === membership?.workspaceId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (chatId === "general") return null;
  return <div className="chat-workspace-bar">
    {workspace ? <button className={`workspace-crumb color-${workspace.color}`} onClick={() => navigate(`/workspaces/${workspace.id}`)}><span className="workspace-dot" />{workspace.name}</button> : <span className="workspace-crumb">Chat</span>}
    <select aria-label="Move chat to workspace" value={workspace?.id ?? ""} disabled={busy || pending || store.loading} onChange={async (e) => {
      setPending(true); setError("");
      try { await store.change({ type: "assign", chatId, workspaceId: e.target.value || null, title, at: Date.now() }); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not move chat."); }
      finally { setPending(false); }
    }}><option value="">No workspace</option>{store.state.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
    {error && <span className="ws-error" role="alert">{error}</span>}
  </div>;
}
