import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { exceptions, leads } from "@/db/schema";
import { assignActiveVariant, recordExperimentConversion } from "@/features/experiments/service";
import { discoverLead, markDoNotContact, scoreLead, transitionChannel, transitionPipeline } from "@/features/leads/service";
import { PlaywrightCdpGateway, type BrowserGateway } from "@/integrations/browser/gateway";
import { sendFirstContact } from "@/integrations/browser/service";
import { sendInstagramApiMessage } from "@/integrations/instagram/api";
import { OpenAiConversationEngine, type ConversationEngine } from "@/integrations/openai/engine";
import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";
import type { DurableJob } from "./queue";
import { enqueueJob } from "./queue";

function requireLeadId(job: DurableJob): number {
  const value = job.payload.leadId;
  if (typeof value !== "number") throw new Error(`Job ${job.id} has no valid leadId.`);
  return value;
}

function createException(leadId: number, jobId: number, code: string, message: string): void {
  database.db.insert(exceptions).values({ leadId, jobId, code, message, detailsJson: "{}", createdAt: new Date(), updatedAt: new Date() }).run();
}

export interface WorkerDependencies {
  conversationEngine: ConversationEngine;
  browserGateway: BrowserGateway;
}

export function createDefaultDependencies(): WorkerDependencies {
  return { conversationEngine: new OpenAiConversationEngine(), browserGateway: new PlaywrightCdpGateway() };
}

async function handleQualify(job: DurableJob): Promise<void> {
  const leadId = requireLeadId(job);
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  if (lead.doNotContact) return;
  if (lead.score < 50) {
    transitionPipeline(leadId, "closed", "worker", "ICP score below threshold");
    transitionChannel(leadId, "completed", "none", "worker", "ICP score below threshold");
    return;
  }
  if (lead.pipelineState === "discovered") transitionPipeline(leadId, "qualified", "worker", `ICP score ${lead.score}`);
  enqueueJob("generate_first_contact", { leadId }, { dedupeKey: `generate_first_contact:${leadId}` });
}

async function handleDiscovery(job: DurableJob, gateway: BrowserGateway): Promise<void> {
  if (!gateway.discoverProfiles) throw new Error("Browser gateway does not support profile discovery.");
  const keyword = job.payload.keyword;
  const funnel = job.payload.funnel === "affiliate" ? "affiliate" as const : "client" as const;
  if (typeof keyword !== "string" || !keyword.trim()) throw new Error("Discovery job has no keyword.");
  const profiles = await gateway.discoverProfiles({ jobId: job.id, keyword, limit: 15 });
  for (const profile of profiles) {
    const profileInput = { displayName: profile.displayName, bio: keyword, sourceKeyword: keyword };
    const result = discoverLead({ funnel, instagramHandle: profile.handle, source: "instagram_search", ...profileInput, score: scoreLead(profileInput), metadata: { discoveryJobId: job.id } });
    enqueueJob("qualify_lead", { leadId: result.lead.id }, { dedupeKey: `qualify_lead:${result.lead.id}` });
  }
}

async function handleGenerateFirstContact(job: DurableJob, engine: ConversationEngine): Promise<void> {
  const leadId = requireLeadId(job);
  const generated = await engine.generateFirstContact(leadId);
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) throw new Error(`Lead ${leadId} not found.`);
  const variant = assignActiveVariant(leadId, lead.funnel);
  const body = variant?.content ?? generated.message;
  enqueueJob("send_browser_dm", { leadId, body, variantId: variant?.id ?? null }, { dedupeKey: `send_browser_dm:${leadId}` });
}

async function handleBrowserSend(job: DurableJob, gateway: BrowserGateway): Promise<void> {
  const leadId = requireLeadId(job);
  if (typeof job.payload.body !== "string") throw new Error("Browser DM job has no message body.");
  await sendFirstContact(job.id, leadId, job.payload.body, gateway, getEnv().DRY_RUN);
}

async function handleInbound(job: DurableJob, engine: ConversationEngine): Promise<void> {
  const leadId = requireLeadId(job);
  const decision = await engine.decideNextAction(leadId);
  if (decision.intention === "opt_out") {
    markDoNotContact(leadId, "Instagram opt-out classified by conversation engine", "ai");
    return;
  }
  if (decision.action === "escalate") {
    transitionChannel(leadId, "human_review_required", "human", "ai", decision.reasoningSummary);
    createException(leadId, job.id, "human_review_required", decision.reasoningSummary);
    return;
  }
  if (decision.action === "close") {
    transitionPipeline(leadId, "closed", "ai", decision.reasoningSummary);
    transitionChannel(leadId, "completed", "none", "ai", decision.reasoningSummary);
    return;
  }
  if (decision.action === "wait" || decision.action === "schedule_follow_up") {
    if (decision.followUpHours) enqueueJob("follow_up", { leadId }, { dedupeKey: `follow_up:${leadId}:${Date.now()}`, runAt: new Date(Date.now() + decision.followUpHours * 3_600_000) });
    return;
  }
  if (!decision.message) throw new Error(`AI action ${decision.action} requires a message.`);
  const delivery = await sendInstagramApiMessage(leadId, decision.message);
  if (delivery.dry_run) return;
  if (decision.intention === "interested") {
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    if (lead?.pipelineState === "replied") transitionPipeline(leadId, "interested", "ai", decision.reasoningSummary);
    recordExperimentConversion(leadId, "interested");
  }
  if (decision.action === "send_to_whatsapp") {
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    if (lead?.funnel === "client") {
      if (lead.pipelineState === "replied") transitionPipeline(leadId, "interested", "ai", "qualified WhatsApp handoff");
      transitionPipeline(leadId, "whatsapp_handoff", "ai", getBusinessConfig().whatsappLink);
      recordExperimentConversion(leadId, "whatsapp_handoff");
    }
  }
}

async function handleFollowUp(job: DurableJob, engine: ConversationEngine): Promise<void> {
  const leadId = requireLeadId(job);
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead || lead.doNotContact || lead.channelOwner !== "api" || lead.channelState !== "api_active") return;
  const decision = await engine.decideNextAction(leadId);
  if (decision.message && ["reply", "ask", "handle_objection"].includes(decision.action)) await sendInstagramApiMessage(leadId, decision.message);
}

export async function handleJob(job: DurableJob, dependencies: WorkerDependencies): Promise<void> {
  switch (job.type) {
    case "discover_instagram": return handleDiscovery(job, dependencies.browserGateway);
    case "qualify_lead": return handleQualify(job);
    case "generate_first_contact": return handleGenerateFirstContact(job, dependencies.conversationEngine);
    case "send_browser_dm": return handleBrowserSend(job, dependencies.browserGateway);
    case "process_inbound": return handleInbound(job, dependencies.conversationEngine);
    case "follow_up": return handleFollowUp(job, dependencies.conversationEngine);
    default: throw new Error(`Unknown job type: ${job.type}.`);
  }
}
