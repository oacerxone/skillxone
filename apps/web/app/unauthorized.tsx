import Link from 'next/link';

export default function Unauthorized() {
  return (
    <div className="py-10">
      <h1 className="text-[24px] font-semibold leading-8">Sign in required</h1>
      <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-muted">
        This area is for maintainers of this site.
      </p>
      <p className="mt-4 text-[15px]">
        <a href="/auth/github/login" className="link">
          Sign in with GitHub
        </a>{' '}
        or{' '}
        <Link href="/" className="link">
          return to the catalog
        </Link>
        .
      </p>
    </div>
  );
}
