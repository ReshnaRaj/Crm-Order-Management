import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/form';
import { useAuth } from '@/hooks/useAuth';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/api-client';
import { loginSchema, type LoginForm } from '@/schemas/auth.schema';

export function LoginPage() {
  const { login } = useAuth();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      // GuestRoute redirects to the originally requested page once the user is set.
      await login(v.email, v.password);
    } catch (e) {
      toast.error(errorMessage(e, 'Login failed'));
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle={
        <>
          No account?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email?.message} required>
          {(id, d) => (
            <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={!!errors.email} {...register('email')} />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} required>
          {(id, d) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              aria-describedby={d}
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
