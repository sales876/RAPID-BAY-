import { NextResponse } from 'next/server';
import webpush from 'web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Delivers a web push to a set of subscriptions.
 *
 * Deliberately dumb: it doesn't look anything up in the database or know who
 * the caller is. The caller (an already-authenticated browser session) gets
 * the subscription list itself via the `get_push_targets` RPC — which is
 * where the actual permission check lives (staff can push to a worker; staff
 * or a worker can push to staff) — and just hands the results here to
 * actually transmit. A failure here is non-fatal to the workflow it's
 * attached to: the in-app/realtime notification already landed regardless.
 */
export async function POST(request: Request) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: 'Web push is not configured on this server.' },
      { status: 200 },
    );
  }

  let body: { targets?: PushTarget[]; title?: string; body?: string; url?: string; tag?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const targets = body.targets ?? [];
  if (!targets.length || !body.title) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({ title: body.title, body: body.body ?? '', url: body.url ?? '/', tag: body.tag });

  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        payload,
      ),
    ),
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return NextResponse.json({ ok: true, sent, total: targets.length });
}
