import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { events, leads, messages } from "@/db/schema";
import { channelLabels, eventLabels, funnelLabels, ownerLabels, pipelineLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number(id);
  const lead = database.db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!lead) notFound();
  const leadEvents = database.db.select().from(events).where(eq(events.leadId, leadId)).orderBy(asc(events.occurredAt)).all();
  const leadMessages = database.db.select().from(messages).where(eq(messages.leadId, leadId)).orderBy(asc(messages.createdAt)).all();
  const timeline = [
    ...leadEvents.map((event) => ({ at: event.occurredAt, title: eventLabels[event.type] ?? "Evento operacional", body: `Origem: ${ownerLabels[event.source] ?? event.source}` })),
    ...leadMessages.map((message) => ({ at: message.createdAt, title: `${message.direction === "inbound" ? "Mensagem recebida" : "Mensagem enviada"} via ${ownerLabels[message.channel] ?? message.channel}`, body: message.body })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  return <>
    <header className="topbar"><div><span className="eyebrow">Lead #{lead.id}</span><h1>{lead.displayName || lead.instagramHandle}</h1><p className="subtitle">{lead.bio || "Bio pública não registrada."}</p></div><a className="button" href={`https://www.instagram.com/${lead.instagramHandle.replace("@", "")}/`} target="_blank" rel="noreferrer">Abrir Instagram</a></header>
    <div className="grid-metrics"><article className="metric"><span>Score ICP</span><strong>{lead.score}</strong><small>{lead.segment || "Segmento não definido"}</small></article><article className="metric"><span>Estado do funil</span><strong style={{fontSize: 17}}>{pipelineLabels[lead.pipelineState] ?? lead.pipelineState}</strong><small>{funnelLabels[lead.funnel] ?? lead.funnel}</small></article><article className="metric"><span>Estado do canal</span><strong style={{fontSize: 17}}>{channelLabels[lead.channelState] ?? lead.channelState}</strong><small>Proprietário: {ownerLabels[lead.channelOwner] ?? lead.channelOwner}</small></article><article className="metric"><span>Próxima ação</span><strong style={{fontSize: 17}}>{lead.nextActionAt ? lead.nextActionAt.toLocaleDateString("pt-BR") : "Nenhuma"}</strong><small>{lead.doNotContact ? "Não contatar" : "Contato permitido"}</small></article></div>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Timeline completa</h2><span className="muted">{timeline.length} eventos</span></div>{timeline.length ? <div className="timeline">{timeline.map((item, index) => <article className="timeline-item" key={`${item.at.getTime()}-${index}`}><h3>{item.title}</h3><time>{item.at.toLocaleString("pt-BR")}</time><p>{item.body}</p></article>)}</div> : <div className="empty">Ainda não há eventos para este lead.</div>}</section>
  </>;
}
