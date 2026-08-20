'use client';

import { AuthProvider } from '@/lib/auth';
import { OpsProvider } from '@/lib/ops-context';
import { MotionProvider } from './Motion';
import { ToastProvider } from './Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <OpsProvider>
        <ToastProvider>
          <MotionProvider />
          {children}
        </ToastProvider>
      </OpsProvider>
    </AuthProvider>
  );
}
