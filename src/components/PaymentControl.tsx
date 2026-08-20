'use client';

import { useState } from 'react';
import { useOps } from '@/lib/ops-context';
import type { PaymentStatus } from '@/lib/types';

const LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid',
  unpaid: 'Unpaid',
  partial: 'Partial',
};

const ORDER: PaymentStatus[] = ['unpaid', 'partial', 'paid'];

/**
 * Payment is changed straight from the queue — clicking cycles
 * Unpaid → Partial → Paid. The receptionist should never have to open a
 * record to mark a customer as having paid.
 */
export function PaymentControl({
  jobId,
  status,
  readOnly = false,
}: {
  jobId: string;
  status: PaymentStatus;
  readOnly?: boolean;
}) {
  const { updatePayment } = useOps();
  const [busy, setBusy] = useState(false);

  if (readOnly) {
    return <span className={`pay pay-${status}`}>{LABEL[status]}</span>;
  }

  const next = ORDER[(ORDER.indexOf(status) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className={`pay pay-${status}`}
      disabled={busy}
      title={`Mark as ${LABEL[next]}`}
      aria-label={`Payment ${LABEL[status]}. Click to mark as ${LABEL[next]}.`}
      onClick={async () => {
        setBusy(true);
        try {
          await updatePayment(jobId, next);
        } finally {
          setBusy(false);
        }
      }}
    >
      {LABEL[status]}
    </button>
  );
}
