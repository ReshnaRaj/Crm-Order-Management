import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { authApi } from '@/api/auth.api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/form';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage } from '@/lib/api-client';
import { formatDate, humanize } from '@/lib/format';
import {
  changePasswordSchema,
  profileSchema,
  type ChangePasswordForm,
  type ProfileForm,
} from '@/schemas/auth.schema';

export function SettingsPage() {
  const { user, setUser } = useAuth();

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: { name: user?.name ?? '' },
  });
  const passwordForm = useForm<ChangePasswordForm>({ resolver: zodResolver(changePasswordSchema) });

  const updateProfile = useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (u) => {
      setUser(u);
      toast.success('Profile updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changePassword = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      passwordForm.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Settings" description="Manage your account." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="space-y-5">
            <DescriptionList
              items={[
                { label: 'Email', value: user?.email },
                { label: 'Role', value: humanize(user?.role) },
                { label: 'Member since', value: formatDate(user?.createdAt) },
              ]}
            />
            <form
              noValidate
              className="space-y-4"
              onSubmit={profileForm.handleSubmit((v) => updateProfile.mutate(v))}
            >
              <Field label="Name" error={profileForm.formState.errors.name?.message} required>
                {(id, d) => <Input id={id} aria-describedby={d} {...profileForm.register('name')} />}
              </Field>
              <Button type="submit" loading={updateProfile.isPending}>
                Save profile
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Change password" />
          <CardBody>
            <form
              noValidate
              className="space-y-4"
              onSubmit={passwordForm.handleSubmit(({ currentPassword, newPassword }) =>
                changePassword.mutate({ currentPassword, newPassword }),
              )}
            >
              {(['currentPassword', 'newPassword', 'confirmPassword'] as const).map((name) => (
                <Field
                  key={name}
                  label={humanize(name.replace(/([A-Z])/g, '_$1'))}
                  error={passwordForm.formState.errors[name]?.message}
                  required
                >
                  {(id, d) => (
                    <Input
                      id={id}
                      type="password"
                      autoComplete={name === 'currentPassword' ? 'current-password' : 'new-password'}
                      aria-describedby={d}
                      {...passwordForm.register(name)}
                    />
                  )}
                </Field>
              ))}
              <Button type="submit" loading={changePassword.isPending}>
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
