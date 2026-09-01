import Link from "next/link";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { leads } from "@/db/schema";
import { getBusinessConfig } from "@/lib/business";
import { channelLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  discovered: "Descobertos", qualified: "Qualificados", contacted: "Abordados", replied: "Responderam", interested: "Interessados",
  whatsapp_handoff: "No WhatsApp", registered: "Cadastrados", active_customer: "Clientes ativos", closed: "Encerrados",
  joined_affiliate_group: "No grupo", active_affiliate: "Afiliados ativos", generated_customer: "Geraram cliente",
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ funnel?: string }> }) {
  const params = await searchParams;
  const funnel = params.funnel === "affiliate" ? "affiliate" : "client";
  const business = getBusinessConfig();
  const allLeads = database.db.select().from(leads).where(eq(leads.funnel, funnel)).all();
  const states = funnel === "client" ? ["discovered", "qualified", "contacted", "replied", "interested", "whatsapp_handoff", "registered", "active_customer", "closed"] : ["discovered", "qualified", "contacted", "replied", "interested", "joined_affiliate_group", "active_affiliate", "generated_customer", "closed"];
  return <>
    <header className="topbar"><div><span className="eyebrow">CRM</span><h1>Funil de {funnel === "client" ? "clientes" : "afiliados"}</h1><p className="subtitle">Pipeline e canal são acompanhados separadamente. Cada movimentação fica registrada na timeline do lead.</p></div></header>
    <div className="tabs"><Link className={funnel === "client" ? "active" : ""} href="/leads?funnel=client">Clientes</Link><Link className={funnel === "affiliate" ? "active" : ""} href="/leads?funnel=affiliate">Afiliados</Link></div>
    {funnel === "affiliate" && !business.affiliateFunnelEnabled && <div className="alert">Funil desativado até o programa, link do grupo e remuneração estarem verificados.</div>}
    <div className="kanban">{states.map((state) => { const column = allLeads.filter((lead) => lead.pipelineState === state); return <section className="kanban-column" key={state}><div className="kanban-title"><span>{labels[state]}</span><span>{column.length}</span></div>{column.map((lead) => <Link className="lead-card" href={`/leads/${lead.id}`} key={lead.id}><span className="score">{lead.score}</span><strong>{lead.displayName || lead.instagramHandle}</strong><span>{lead.instagramHandle}</span><span>{channelLabels[lead.channelState] ?? lead.channelState}</span></Link>)}</section>; })}</div>
  </>;
}
