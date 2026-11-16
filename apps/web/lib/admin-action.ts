import { NextResponse } from 'next/server';
import type { SessionUser, UserRole } from '@skillxone/database';
import { apiError } from './api';
import { requestIpHash, requireAdminMutation } from './auth';

export const isId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);

export function formText(form: FormData, name: string, max = 1000): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Wraps an admin form handler: role, origin and CSRF checks, then the action, then a 303
 * back to the admin page the form came from (only /admin paths are accepted).
 */
export function adminAction<Context>(
  role: UserRole,
  action: (input: {
    form: FormData;
    session: SessionUser;
    ipHash: string | null;
    context: Context;
  }) => Promise<string | Response>,
) {
  return async (request: Request, context: Context): Promise<Response> => {
    const form = await request.formData().catch(() => null);
    const guard = await requireAdminMutation(request, role, form);
    if (guard instanceof Response) return guard;
    if (!form) return apiError(400, 'INVALID_REQUEST', 'Send the form fields.');
    try {
      const result = await action({
        form,
        session: guard,
        ipHash: await requestIpHash(request),
        context,
      });
      if (result instanceof Response) return result;
      const back = formText(form, 'back', 200);
      const target = new URL(
        back.startsWith('/admin') && !back.startsWith('//') ? back : '/admin',
        request.url,
      );
      target.searchParams.set('done', result);
      return NextResponse.redirect(target, 303);
    } catch (error) {
      console.error('Admin action failed', new URL(request.url).pathname, error);
      return apiError(500, 'INTERNAL_ERROR', 'The action could not be completed.');
    }
  };
}
