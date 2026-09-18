import { istDate, istTime, MANUAL_SHARE_CHANNELS, toMinutes, type StaffToday } from '@chheda/shared';
import type { Config } from '../config';
import { conflict, forbidden, notFound } from '../lib/errors';
import { Delivery, Rate, SendDay, getSettings } from '../models';
import { raiseAlert } from './alerts';
import { sendPush } from './push';

/**
 * What the staff share page may show today. RULE 2: never an old rate – anything other than
 * "today's rate is approved/sent AND the manual tasks exist" returns ready:false with no rate values.
 */
export async function staffToday(now = new Date()): Promise<StaffToday> {
  const date = istDate(now);
  const s = await getSettings();
  const rate = await Rate.findOne({ date }).lean();
  const nr = (reason: Exclude<StaffToday, { ready: true }>['reason'], message: string): StaffToday => ({ ready: false, date, reason, message, sendTime: s.sendTime });
  if (!rate) return nr('no_rate', "Today's rate has not been entered yet. Nothing to share until the admin enters and approves it.");
  if (rate.status === 'cancelled') return nr('cancelled', "Today's rate was cancelled. Nothing to share.");
  if (rate.status === 'draft') return nr('not_approved', "Today's rate is saved but not approved yet. Please wait for the admin to approve it.");
  if (s.channels?.staffShare === false) return nr('staff_share_off', 'Staff share is switched off in Settings.');
  const tasks = await Delivery.find({ date, channel: { $in: MANUAL_SHARE_CHANNELS } }).sort({ channel: 1 }).lean();
  if (!tasks.length) {
    const day = await SendDay.findOne({ date }).lean();
    if (day?.status === 'skipped') return nr('skipped', "Today's send was skipped (cut-off passed). Ask the admin to use Send Now.");
    if (toMinutes(istTime(now)) < toMinutes(s.sendTime)) return nr('before_send_time', `Today's rate is approved. It becomes available to share at ${s.sendTime} IST.`);
    return nr('before_send_time', `Today's rate is approved – waiting for the scheduler (${s.sendTime} IST) or Send Now.`);
  }
  const feedUrl = tasks[0].creativeUrls?.feed ?? rate.creativeUrls?.feed;
  const storyUrl = tasks[0].creativeUrls?.story ?? rate.creativeUrls?.story;
  const caption = tasks[0].caption ?? rate.caption;
  if (!feedUrl || !storyUrl || !caption) return nr('before_send_time', 'Images are not ready yet – try again in a minute.');
  return {
    ready: true, date, feedUrl, storyUrl, caption,
    tasks: tasks.map((t) => ({ id: String(t._id), channel: t.channel as any, status: t.status === 'success' ? 'success' : 'pending_manual', postedBy: t.postedBy ?? undefined, postedAt: t.postedAt?.toISOString(), createdAt: t.createdAt.toISOString() })),
  };
}

/** Staff/admin marks a manual task as posted – exactly once. */
export async function markPosted(deliveryId: string, user: { email: string; role: string }, now = new Date()) {
  if (!['staff', 'admin'].includes(user.role)) throw forbidden();
  const d = await Delivery.findById(deliveryId);
  if (!d || !(MANUAL_SHARE_CHANNELS as readonly string[]).includes(d.channel)) throw notFound('Manual task not found');
  if (d.status === 'success') throw conflict(`Already marked posted by ${d.postedBy}`);
  d.set({ status: 'success', postedBy: user.email, postedAt: now, externalId: `manual:${user.email}` });
  await d.save();
  return d;
}

/** Called right after the manual rows are created at send time. */
export async function notifyStaffReady(cfg: Config, date: string) {
  return sendPush(cfg, ['staff', 'admin'], { title: "Today's gold rate is ready to share", body: `Open the share page and post it to the broadcast channel, WhatsApp channel and community.`, tag: `ready:${date}` });
}

/**
 * Every minute: manual tasks still pending after settings.manualReminderMinutes → one reminder push to staff
 * and one admin alert per task (dedupe key per date+channel).
 */
export async function remindPendingManual(cfg: Config, now = new Date()) {
  const s = await getSettings();
  const minutes = s.manualReminderMinutes ?? 30;
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const due = await Delivery.find({ channel: { $in: MANUAL_SHARE_CHANNELS }, status: 'pending_manual', reminderSentAt: { $exists: false }, createdAt: { $lte: cutoff } });
  if (!due.length) return { reminded: 0 };
  const labels = due.map((d) => d.channel.replace('_manual', '').replace('_', ' '));
  await sendPush(cfg, ['staff', 'admin'], { title: 'Reminder: gold rate not posted yet', body: `Still pending: ${labels.join(', ')}. Please share it and tap "Mark posted".`, tag: 'reminder' });
  for (const d of due) {
    await raiseAlert({ type: 'manual_pending', severity: 'warning', date: d.date, dedupeKey: `manual_pending:${d.date}:${d.channel}`,
      message: `${d.channel.replace('_manual', '').replace(/_/g, ' ')} has not been marked posted ${minutes} minutes after the rate went out.` });
    d.set({ reminderSentAt: now }); await d.save();
  }
  return { reminded: due.length };
}
