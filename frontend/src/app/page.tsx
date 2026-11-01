import type { Metadata } from 'next';
import { ActiveRideNotice } from '@/components/active-ride-notice';
import { BookingForm } from '@/components/booking-form';

export const metadata: Metadata = { title: 'Book a ride' };

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Where to?</h1>
        <p className="mt-1 text-slate-600">
          Pick two Lahore landmarks, compare Economy and Comfort, and request a ride.
        </p>
      </div>
      <ActiveRideNotice />
      <BookingForm />
    </div>
  );
}
