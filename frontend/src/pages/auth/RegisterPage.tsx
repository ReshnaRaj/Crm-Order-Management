import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/form';
import { useAuth } from '@/hooks/useAuth';
import { AuthLayout } from '@/layouts/AuthLayout';
import { errorMessage } from '@/lib/api-client';
import { registerSchema, type RegisterForm } from '@/schemas/auth.schema';

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await signUp(v.name, v.email, v.password);
      toast.success('Account created');
      void navigate('/dashboard', { replace: true });
    } catch (e) {
      toast.error(errorMessage(e, 'Registration failed'));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Full name" error={errors.name?.message} required>
          {(id, d) => <Input id={id} autoComplete="name" aria-describedby={d} aria-invalid={!!errors.name} {...register('name')} />}
        </Field>
        <Field label="Email" error={errors.email?.message} required>
          {(id, d) => (
            <Input id={id} type="email" autoComplete="email" aria-describedby={d} aria-invalid={!!errors.email} {...register('email')} />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message} hint="8+ characters with a letter and a number" required>
          {(id, d) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={d}
              aria-invalid={!!errors.password}
              {...register('password')}
            />
          )}
        </Field>
        <Field label="Confirm password" error={errors.confirmPassword?.message} required>
          {(id, d) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              aria-describedby={d}
              aria-invalid={!!errors.confirmPassword}
              {...register('confirmPassword')}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
