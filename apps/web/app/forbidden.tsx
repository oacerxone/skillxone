import Link from 'next/link';

export default function Forbidden() {
  return (
    <div className="py-10">
      <h1 className="text-[24px] font-semibold leading-8">No access</h1>
      <p className="mt-2 max-w-xl text-[15px] leading-6 text-text-muted">
        Your account does not have the role this page needs. Roles are granted by the site operator.
      </p>
      <p className="mt-4 text-[15px]">
        <Link href="/" className="link">
          Return to the catalog
        </Link>
      </p>
    </div>
  );
}
