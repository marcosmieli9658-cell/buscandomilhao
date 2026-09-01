import { and, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { auditLogs, events, leads } from "@/db/schema";
import { getBusinessConfig } from "@/lib/business";
import type { ChannelState, Funnel, PipelineState } from "@/lib/types";

const clientTransitions: Record<string, readonly string[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["whatsapp_handoff", "closed"],
  whatsapp_handoff: ["registered", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  closed: [],
};

const affiliateTransitions: Record<string, readonly string[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["joined_affiliate_group", "closed"],
  joined_affiliate_group: ["active_affiliate", "closed"],
  active_affiliate: ["generated_customer", "closed"],
  generated_customer: ["closed"],
  closed: [],
};

const channelTransitions: Record<ChannelState, readonly ChannelState[]> = {
  browser_contact_pending: ["browser_contact_sent", "api_eligible", "human_review_required", "blocked", "do_not_contact"],
  browser_contact_sent: ["waiting_inbound_reply", "human_review_required", "blocked", "do_not_contact"],
  waiting_inbound_reply: ["api_eligible", "human_review_required", "blocked", "do_not_contact"],
  api_eligible: ["api_active", "api_window_closed", "human_review_required", "do_not_contact"],
  api_active: ["api_window_closed", "human_review_required", "completed", "do_not_contact"],
  api_window_closed: ["human_review_required", "completed", "do_not_contact"],
  human_review_required: ["browser_contact_pending", "api_eligible", "api_active", "blocked", "completed", "do_not_contact"],
  do_not_contact: [],
  blocked: ["human_review_required", "browser_contact_pending", "completed", "do_not_contact"],
  completed: [],
};

export interface DiscoverLeadInput {
  funnel: Funnel;
  instagramHandle: string;
  displayName?: string;
  bio?: string;
  category?: string;
  location?: string;
  source: string;
  sourceKeyword?: string;
  score?: number;
  segment?: string;
  metadata?: Record<string, unknown>;
}

export function normalizeInstagramHandle(handle: string): string {
  const normalized = handle.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/$/, "").toLowerCase();
  if (!/^[a-z0-9._]+$/.test(normalized)) throw new Error("Instagram handle is invalid.");
  return `@${normalized}`;
}

export function discoverLead(input: DiscoverLeadInput) {
  if (input.funnel === "affiliate" && !getBusinessConfig().affiliateFunnelEnabled) {
    throw new Error("Affiliate funnel is disabled until a verified program is configured.");
  }
  const handle = normalizeInstagramHandle(input.instagramHandle);
  return database.db.transaction((tx) => {
    const existing = tx.select().from(leads).where(and(eq(leads.funnel, input.funnel), eq(leads.instagramHandle, handle))).get();
    if (existing) return { lead: existing, created: false };
    const now = new Date();
    const created = tx.insert(leads).values({
      ...input,
      instagramHandle: handle,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      score: Math.max(0, Math.min(100, input.score ?? 0)),
      createdAt: now,
      updatedAt: now,
    }).returning().get();
    tx.insert(events).values({ leadId: created.id, type: "lead_discovered", source: input.source, payloadJson: JSON.stringify(input.metadata ?? {}), occurredAt: now, createdAt: now, updatedAt: now }).run();
    tx.insert(auditLogs).values({ leadId: created.id, actor: "system", action: "lead_created", afterJson: JSON.stringify(created), reason: input.source, createdAt: now, updatedAt: now }).run();
    return { lead: created, created: true };
  });
}

export function transitionPipeline(leadId: number, nextState: PipelineState, actor = "worker", reason?: string) {
  return database.db.transaction((tx) => {
    const lead = tx.select().from(leads).where(eq(leads.id, leadId)).get();
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    if (lead.pipelineState === nextState) return lead;
    const transitions = lead.funnel === "client" ? clientTransitions : affiliateTransitions;
    if (!transitions[lead.pipelineState]?.includes(nextState)) {
      throw new Error(`Invalid ${lead.funnel} pipeline transition: ${lead.pipelineState} -> ${nextState}.`);
    }
    const updated = tx.update(leads).set({ pipelineState: nextState, version: lead.version + 1, updatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version))).returning().get();
    if (!updated) throw new Error("Lead changed concurrently. Retry the transition.");
    tx.insert(auditLogs).values({ leadId, actor, action: "pipeline_transition", beforeJson: JSON.stringify({ state: lead.pipelineState }), afterJson: JSON.stringify({ state: nextState }), reason, createdAt: new Date(), updatedAt: new Date() }).run();
    tx.insert(events).values({ leadId, type: `pipeline_${nextState}`, source: actor, payloadJson: JSON.stringify({ previous: lead.pipelineState, reason }), occurredAt: new Date(), createdAt: new Date(), updatedAt: new Date() }).run();
    return updated;
  });
}

export function transitionChannel(leadId: number, nextState: ChannelState, nextOwner: "browser" | "api" | "human" | "none", actor = "worker", reason?: string) {
  return database.db.transaction((tx) => {
    const lead = tx.select().from(leads).where(eq(leads.id, leadId)).get();
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    if (lead.channelState === nextState && lead.channelOwner === nextOwner) return lead;
    if (!channelTransitions[lead.channelState as ChannelState]?.includes(nextState)) {
      throw new Error(`Invalid channel transition: ${lead.channelState} -> ${nextState}.`);
    }
    const updated = tx.update(leads).set({ channelState: nextState, channelOwner: nextOwner, version: lead.version + 1, updatedAt: new Date() }).where(and(eq(leads.id, leadId), eq(leads.version, lead.version))).returning().get();
    if (!updated) throw new Error("Lead changed concurrently. Retry the transition.");
    tx.insert(auditLogs).values({ leadId, actor, action: "channel_transition", beforeJson: JSON.stringify({ state: lead.channelState, owner: lead.channelOwner }), afterJson: JSON.stringify({ state: nextState, owner: nextOwner }), reason, createdAt: new Date(), updatedAt: new Date() }).run();
    return updated;
  });
}

export function markDoNotContact(leadId: number, reason: string, actor = "worker") {
  return database.db.transaction((tx) => {
    const lead = tx.select().from(leads).where(eq(leads.id, leadId)).get();
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    const updated = tx.update(leads).set({
      doNotContact: true,
      doNotContactReason: reason,
      channelState: "do_not_contact",
      channelOwner: "none",
      nextActionAt: null,
      pipelineState: "closed",
      version: lead.version + 1,
      updatedAt: new Date(),
    }).where(eq(leads.id, leadId)).returning().get();
    tx.insert(auditLogs).values({ leadId, actor, action: "do_not_contact", beforeJson: JSON.stringify(lead), afterJson: JSON.stringify(updated), reason, createdAt: new Date(), updatedAt: new Date() }).run();
    tx.insert(events).values({ leadId, type: "opt_out", source: actor, payloadJson: JSON.stringify({ reason }), occurredAt: new Date(), createdAt: new Date(), updatedAt: new Date() }).run();
    return updated;
  });
}

export function scoreLead(input: Pick<DiscoverLeadInput, "bio" | "category" | "location" | "segment">): number {
  const business = getBusinessConfig();
  const haystack = [input.bio, input.category, input.location, input.segment].filter(Boolean).join(" ").toLowerCase();
  const segmentMatches = business.icpSegments.filter((segment) => haystack.includes(segment.toLowerCase().replace(/s$/, ""))).length;
  const keywordMatches = business.icpKeywords.filter((keyword) => haystack.includes(keyword.toLowerCase())).length;
  const geographyBonus = /são jos[eé] dos campos|vale do para[ií]ba/i.test(haystack) ? 15 : 0;
  return Math.min(100, 35 + segmentMatches * 15 + keywordMatches * 10 + geographyBonus);
}
