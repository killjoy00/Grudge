'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateDisplayName } from '../lib/actions.ts';

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await updateDisplayName(name);
      if (!result.ok) {
        setMessage(null);
        setError(result.error ?? 'Could not update your profile.');
        return;
      }
      setError(null);
      setMessage('Display name updated.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={save}>
      <label htmlFor="display-name" className="fieldlabel">Display name</label>
      <input
        id="display-name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={60}
        autoComplete="name"
        required
      />
      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={pending || !name.trim()}>
          {pending ? 'Saving…' : 'Save name'}
        </button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {message && <p className="ok" role="status">{message}</p>}
    </form>
  );
}
