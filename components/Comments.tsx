'use client';
import { useState, useTransition } from 'react';
import { postComment, editComment, deleteComment } from '../lib/actions.ts';

export interface Comment {
  id: string; user_id: string; body: string; parent_id: string | null;
  created_at: string; display_name: string | null;
}

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
}

export function Comments({
  season, week, comments, me,
}: { season: number; week: number; comments: Comment[]; me: string | null }) {
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const roots = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  function send() {
    if (!body.trim()) return;
    start(async () => {
      const res = await postComment(season, week, body, replyTo);
      if (res.ok) { setBody(''); setReplyTo(null); setErr(null); }
      else setErr(res.error ?? 'Could not post.');
    });
  }

  function saveEdit(id: string) {
    start(async () => {
      const res = await editComment(id, draft);
      if (res.ok) { setEditing(null); setErr(null); }
      else setErr(res.error ?? 'Could not save.');
    });
  }

  function render(c: Comment, isReply = false) {
    const mine = me === c.user_id;
    return (
      <div key={c.id} className={`cmt${isReply ? ' reply' : ''}`}>
        <div>
          <span className="who">{c.display_name ?? 'Someone'}</span>
          <span className="when">{when(c.created_at)}</span>
        </div>
        {editing === c.id ? (
          <div style={{ marginTop: 6 }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={() => saveEdit(c.id)} disabled={pending}>Save</button>
              <button onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="body">{c.body}</div>
        )}
        {me && editing !== c.id && (
          <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
            {!isReply && (
              <button style={{ border: 'none', background: 'none', padding: 0, color: 'var(--muted)', fontSize: 13 }}
                      onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                {replyTo === c.id ? 'Cancel reply' : 'Reply'}
              </button>
            )}
            {mine && (
              <>
                <button style={{ border: 'none', background: 'none', padding: 0, color: 'var(--muted)', fontSize: 13 }}
                        onClick={() => { setEditing(c.id); setDraft(c.body); }}>Edit</button>
                <button style={{ border: 'none', background: 'none', padding: 0, color: 'var(--muted)', fontSize: 13 }}
                        onClick={() => start(async () => { await deleteComment(c.id); })}>Delete</button>
              </>
            )}
          </div>
        )}
        {repliesOf(c.id).map((r) => render(r, true))}
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 8px' }}>Talk</h2>
      {roots.length === 0 && <div className="empty">Nobody&rsquo;s said anything yet.</div>}
      {roots.map((c) => render(c))}

      {me ? (
        <div style={{ marginTop: 14 }}>
          {replyTo && <div className="note" style={{ marginBottom: 6 }}>Replying — <button
            style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 12 }}
            onClick={() => setReplyTo(null)}>cancel</button></div>}
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
                    placeholder="Say something…" maxLength={5000} />
          <div style={{ marginTop: 8 }}>
            <button onClick={send} disabled={pending || !body.trim()}>
              {pending ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
            </button>
          </div>
          {err && <div className="err">{err}</div>}
        </div>
      ) : (
        <p className="note" style={{ marginTop: 12 }}>Sign in to join the conversation.</p>
      )}
    </div>
  );
}
