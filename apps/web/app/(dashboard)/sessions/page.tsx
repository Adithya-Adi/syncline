import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recordings' };

export default function SessionsPage() {
  redirect('/dashboard');
}
