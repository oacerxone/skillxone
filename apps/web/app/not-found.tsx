import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-16">
      <h1 className="text-[28px] font-semibold leading-[34px] tracking-[-0.015em]">
        Page not found
      </h1>
      <p className="mt-3 max-w-xl text-text-muted">
        This page does not exist, or it belongs to a part of the marketplace that has not been built
        yet.
      </p>
      <Link href="/" className="link mt-6 inline-block">
        Back to the homepage
      </Link>
    </div>
  );
}
