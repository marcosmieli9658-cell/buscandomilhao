export const clientPipelineStates = [
  "discovered", "qualified", "contacted", "replied", "interested",
  "whatsapp_handoff", "registered", "active_customer", "closed",
] as const;

export const affiliatePipelineStates = [
  "discovered", "qualified", "contacted", "replied", "interested",
  "joined_affiliate_group", "active_affiliate", "generated_customer", "closed",
] as const;

export const channelStates = [
  "browser_contact_pending", "browser_contact_sent", "waiting_inbound_reply",
  "api_eligible", "api_active", "api_window_closed", "human_review_required",
  "do_not_contact", "blocked", "completed",
] as const;

export const conversationIntentions = [
  "interested", "asked_info", "asked_pricing", "wants_whatsapp", "not_the_owner",
  "will_forward", "objection", "not_interested", "opt_out", "ambiguous", "needs_human",
] as const;

export const conversationActions = [
  "reply", "ask", "introduce", "handle_objection", "send_to_whatsapp",
  "wait", "schedule_follow_up", "close", "escalate",
] as const;

export type Funnel = "client" | "affiliate";
export type ChannelOwner = "browser" | "api" | "human" | "none";
export type ClientPipelineState = (typeof clientPipelineStates)[number];
export type AffiliatePipelineState = (typeof affiliatePipelineStates)[number];
export type PipelineState = ClientPipelineState | AffiliatePipelineState;
export type ChannelState = (typeof channelStates)[number];
export type ConversationIntention = (typeof conversationIntentions)[number];
export type ConversationAction = (typeof conversationActions)[number];

export type JsonObject = Record<string, unknown>;
