'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signIn } from '../../../lib/auth-client';

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: failure } = await signIn.email({ email, password });
    setPending(false);

    if (failure) {
      // Deliberately not distinguishing "no such account" from "wrong password": the difference
      // tells an attacker which addresses are registered here.
      setError('That email and password do not match an account.');
      return;
    }

    router.push('/sessions');
    router.refresh();
  }

  return (
    <form className="auth__form" onSubmit={onSubmit}>
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
          autoComplete="current-password"
          required
        />
      </label>

      {error && <p className="field__error">{error}</p>}

      <button
        className="button button--primary"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
