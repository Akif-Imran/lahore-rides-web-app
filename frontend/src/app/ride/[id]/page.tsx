import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RideView } from '@/components/ride-view';
import { isUuid } from '@/lib/ids';

export const metadata: Metadata = { title: 'Your ride' };

export default async function RidePage({ params }: PageProps<'/ride/[id]'>) {
  const { id } = await params;
  // A malformed id can never be a ride: answer 404 here instead of asking the API.
  if (!isUuid(id)) notFound();
  return <RideView rideId={id.toLowerCase()} />;
}
