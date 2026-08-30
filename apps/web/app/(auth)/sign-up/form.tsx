'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signUp } from '../../../lib/auth-client';

const MIN_PASSWORD_LENGTH = 10;

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Checked here as well as by the server so the message arrives before a round trip, not
    // because the client is trusted.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setPending(true);
    const { error: failure } = await signUp.email({ name, email, password });
    setPending(false);

    if (failure) {
      setError(failure.message ?? 'Could not create the account.');
      return;
    }

    router.push('/sessions');
    router.refresh();
  }

  return (
    <form className="auth__form" onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="field__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
      </label>

      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="field__input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>

      <label className="field">
        <span className="field__label">Password</span>
        <input
          className="field__input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <span className="field__hint">
          At least {MIN_PASSWORD_LENGTH} characters.
        </span>
      </label>

      {error && <p className="field__error">{error}</p>}

      <button
        className="button button--primary"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Creating account…' : 'Create account and claim instance'}
      </button>
    </form>
  );
}
