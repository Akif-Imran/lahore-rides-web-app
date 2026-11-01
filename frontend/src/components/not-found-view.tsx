import Link from 'next/link';

export function NotFoundView({
  title = 'Page not found',
  message = "We couldn't find what you were looking for.",
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 text-slate-600">{message}</p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-10 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
      >
        Book a ride
      </Link>
    </div>
  );
}
