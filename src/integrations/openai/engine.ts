import { and, eq, gte, sql } from "drizzle-orm";
import OpenAI from "openai";
import { z } from "zod";
import { database } from "@/db/client";
import { aiCalls, leads, messages } from "@/db/schema";
import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";
import { conversationActions, conversationIntentions, type ConversationAction, type ConversationIntention } from "@/lib/types";
import { setGlobalPause } from "@/worker/queue";

const decisionSchema = z.object({
  intention: z.enum(conversationIntentions),
  action: z.enum(conversationActions),
  message: z.string().max(1000).nullable(),
  reasoningSummary: z.string().max(500),
  claimIndices: z.array(z.number().int().nonnegative()),
  followUpHours: z.number().int().positive().max(168).nullable(),
});

export type ConversationDecision = z.infer<typeof decisionSchema>;

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intention", "action", "message", "reasoningSummary", "claimIndices", "followUpHours"],
  properties: {
    intention: { type: "string", enum: [...conversationIntentions] },
    action: { type: "string", enum: [...conversationActions] },
    message: { type: ["string", "null"] },
    reasoningSummary: { type: "string" },
    claimIndices: { type: "array", items: { type: "integer", minimum: 0 } },
    followUpHours: { type: ["integer", "null"], minimum: 1, maximum: 168 },
  },
} as const;

const modelPrices: Record<string, { input: number; output: number }> = {
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-2026-03-05": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-mini-2026-03-17": { input: 0.75, output: 4.5 },
};

export function estimateOpenAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = modelPrices[model];
  if (!price) throw new Error(`No audited token price is configured for model ${model}.`);
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

function currentMonthSpend(): number {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const result = database.db.select({ total: sql<number>`coalesce(sum(${aiCalls.estimatedCostUsd}), 0)` }).from(aiCalls).where(gte(aiCalls.createdAt, monthStart)).get();
  return Number(result?.total ?? 0);
}

function assertBudget(): void {
  const env = getEnv();
  const spent = currentMonthSpend();
  if (spent >= env.OPENAI_MONTHLY_BUDGET_USD) {
    setGlobalPause(true, "openai_budget_exceeded");
    throw new Error(`OpenAI monthly budget reached: USD ${spent.toFixed(2)}.`);
  }
}

function validateCommercialMessage(decision: ConversationDecision): ConversationDecision {
  const business = getBusinessConfig();
  for (const index of decision.claimIndices) {
    if (!business.verifiedClaims[index]) throw new Error(`AI referenced unknown verified claim index ${index}.`);
  }
  if (decision.message && /\b(garant|100%|primeir[oa]\s+(posi[cç][aã]o|lugar)|r\$|desconto|retorno\s+garantido)\b/i.test(decision.message)) {
    throw new Error("AI output contains a blocked commercial claim.");
  }
  if (decision.intention === "asked_pricing" && decision.action !== "escalate") {
    throw new Error("Pricing questions require human review because no verified price is configured.");
  }
  return decision;
}

export interface ConversationEngine {
  generateFirstContact(leadId: number): Promise<{ message: string; variantReason: string }>;
  decideNextAction(leadId: number): Promise<ConversationDecision>;
}

export class OpenAiConversationEngine implements ConversationEngine {
  private readonly client: OpenAI;

  constructor(apiKey = getEnv().OPENAI_API_KEY) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
    this.client = new OpenAI({ apiKey });
  }

  private async callStructured(leadId: number, purpose: string, model: string, instructions: string, input: string): Promise<ConversationDecision> {
    assertBudget();
    const response = await this.client.responses.create({
      model,
      instructions,
      input,
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "conversation_decision", strict: true, schema: responseJsonSchema } },
    });
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    const estimatedCost = estimateOpenAiCost(model, inputTokens, outputTokens);
    database.db.insert(aiCalls).values({ leadId, model, purpose, inputTokens, outputTokens, estimatedCostUsd: estimatedCost, responseId: response.id, createdAt: new Date(), updatedAt: new Date() }).run();
    if (currentMonthSpend() >= getEnv().OPENAI_MONTHLY_BUDGET_USD) setGlobalPause(true, "openai_budget_exceeded");
    return validateCommercialMessage(decisionSchema.parse(JSON.parse(response.output_text)));
  }

  async generateFirstContact(leadId: number): Promise<{ message: string; variantReason: string }> {
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    const business = getBusinessConfig();
    const metadata = JSON.parse(lead.metadataJson) as Record<string, unknown>;
    const decision = await this.callStructured(
      leadId,
      "first_contact",
      getEnv().OPENAI_MODEL,
      `Você escreve uma primeira DM curta, pessoal, respeitosa e verdadeira em PT-BR. A prioridade comercial é diagnosticar site novo, reforma de site, Perfil da Empresa no Google ou e-commerce. Identidade visual e automação de publicações no Instagram são complementares. Nunca ofereça agente de atendimento por IA ou WhatsApp. Baseie a abertura somente no perfil público e nas evidências fornecidas. Não afirme que a empresa não tem site quando isso não estiver confirmado; nesse caso, pergunte. Não finja ser cliente. Não prometa resultado. Não fale de preço. Use no máximo uma afirmação comercial e somente copiando o sentido de VERIFIED_CLAIMS. Se não houver contexto suficiente, escale. VERIFIED_CLAIMS indexadas: ${business.verifiedClaims.map((claim, index) => `${index}: ${claim}`).join(" | ")}. UNVERIFIED_CLAIMS proibidas: ${business.unverifiedClaims.join(" | ")}.`,
      JSON.stringify({ lead: { handle: lead.instagramHandle, displayName: lead.displayName, bio: lead.bio, category: lead.category, location: lead.location, segment: lead.segment, qualification: metadata }, companyPitch: business.oneLinePitch }),
    );
    if (!decision.message || decision.action === "escalate") throw new Error("Lead needs human review before first contact.");
    return { message: decision.message, variantReason: decision.reasoningSummary };
  }

  async decideNextAction(leadId: number): Promise<ConversationDecision> {
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    const history = database.db.select().from(messages).where(eq(messages.leadId, leadId)).all().map((message) => ({ direction: message.direction, body: message.body, at: message.createdAt.toISOString() }));
    const business = getBusinessConfig();
    const metadata = JSON.parse(lead.metadataJson) as Record<string, unknown>;
    return this.callStructured(
      leadId,
      "conversation_decision",
      getEnv().OPENAI_MODEL,
      `Conduza uma conversa comercial consultiva em PT-BR. Descubra primeiro se a necessidade é site novo, reforma de site, Perfil da Empresa no Google ou e-commerce. Identidade visual e automação de publicações no Instagram podem ser oferecidas como complementares. Nunca ofereça agente de atendimento por IA ou WhatsApp. Responda pedido de parada com intention=opt_out e action=close, sem tentar persuadir. Perguntas de preço sempre action=escalate. Encaminhe ao WhatsApp somente quando houver interesse. Nunca invente fatos. Use apenas VERIFIED_CLAIMS indexadas: ${business.verifiedClaims.map((claim, index) => `${index}: ${claim}`).join(" | ")}. UNVERIFIED_CLAIMS bloqueadas: ${business.unverifiedClaims.join(" | ")}. WhatsApp verificado: ${business.whatsappLink}.`,
      JSON.stringify({ lead: { handle: lead.instagramHandle, funnel: lead.funnel, segment: lead.segment, state: lead.pipelineState, qualification: metadata }, history }),
    );
  }
}

export class DeterministicConversationEngine implements ConversationEngine {
  async generateFirstContact(leadId: number) {
    const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
    if (!lead) throw new Error(`Lead ${leadId} not found.`);
    return { message: `Olá! Vi o perfil ${lead.displayName ?? lead.instagramHandle} e achei o trabalho de vocês interessante. Quem cuida da presença da empresa no Google e do site por aí?`, variantReason: "Deterministic test message" };
  }

  async decideNextAction(leadId: number): Promise<ConversationDecision> {
    const lastInbound = database.db.select().from(messages).where(and(eq(messages.leadId, leadId), eq(messages.direction, "inbound"))).all().at(-1)?.body.toLowerCase() ?? "";
    if (/pare|parar|n[aã]o.*contato|remov/i.test(lastInbound)) return { intention: "opt_out", action: "close", message: null, reasoningSummary: "Explicit opt-out", claimIndices: [], followUpHours: null };
    if (/pre[cç]o|valor|quanto/i.test(lastInbound)) return { intention: "asked_pricing", action: "escalate", message: null, reasoningSummary: "Pricing requires operator", claimIndices: [], followUpHours: null };
    if (/whats|interessad|quero/i.test(lastInbound)) return { intention: "wants_whatsapp", action: "send_to_whatsapp", message: `Perfeito. Você pode falar diretamente com a UpScale por aqui: ${getBusinessConfig().whatsappLink}`, reasoningSummary: "Qualified handoff", claimIndices: [], followUpHours: null };
    return { intention: "asked_info", action: "ask", message: "Hoje, qual é a principal dificuldade de vocês: aparecer no Google, atualizar o site ou organizar a presença da empresa na internet?", reasoningSummary: "Needs discovery", claimIndices: [], followUpHours: null };
  }
}

export type { ConversationAction, ConversationIntention };
