import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Web push, client side.
 *
 * Two independent things happen here:
 *  1. `subscribeToPush` — one-time setup: registers the service worker, asks
 *     the browser for permission, and stores the resulting subscription in
 *     `push_subscriptions` (RLS-scoped to the signed-in user's own row).
 *  2. `notifyPush` — fired after an action that should alert someone who
 *     might not have the tab open: looks up their subscriptions via the
 *     `get_push_targets` RPC (permission-checked in Postgres, not here) and
 *     posts the payload to /api/push/send, which does the actual delivery.
 *
 * Both are best-effort. A push failure never blocks or rolls back the floor
 * action it's attached to — the realtime in-app notification already landed
 * regardless of whether push is set up, denied, or unsupported.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  );
}

export async function pushPermissionState(): Promise<'unsupported' | NotificationPermission> {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function isAlreadySubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    return Boolean(sub);
  } catch {
    return false;
  }
}

/** Registers the service worker, requests permission, and saves the subscription. */
export async function subscribeToPush(supabase: SupabaseClient, profileId: string): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string) as unknown as BufferSource,
    }));

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      profile_id: profileId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: 'endpoint' },
  );
  return !error;
}

/** Best-effort push after a floor action. Never throws — swallows and logs. */
export async function notifyPush(
  supabase: SupabaseClient,
  target: { audience: 'worker' | 'staff'; workerId?: string | null },
  message: { title: string; body: string; url?: string },
): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('get_push_targets', {
      p_audience: target.audience,
      p_worker_id: target.workerId ?? null,
    });
    if (error || !data?.length) return;

    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        targets: data.map((r: { endpoint: string; p256dh: string; auth: string }) => r),
        title: message.title,
        body: message.body,
        url: message.url ?? '/',
      }),
    });
  } catch {
    // Push is a best-effort convenience — the in-app/realtime alert already landed.
  }
}
