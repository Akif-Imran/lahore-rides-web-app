import type { Metadata } from 'next';
import { DriverConsole } from '@/components/driver-console';

export const metadata: Metadata = { title: 'Driver console' };

export default function DriverPage() {
  return <DriverConsole />;
}
