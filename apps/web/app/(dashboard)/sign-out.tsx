'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '../../lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className="nav__signout"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
        router.push('/sign-in');
        router.refresh();
      }}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
