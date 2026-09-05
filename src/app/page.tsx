import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { addLead, startDiscovery, togglePause } from "./actions";
import { database } from "@/db/client";
import { leads, systemSettings } from "@/db/schema";
import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";
import { pipelineLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

function metricValue(query: string): number {
  return Number((database.sqlite.prepare(query).get() as { value: number }).value);
}

export default function DashboardPage() {
  const business = getBusinessConfig();
  const env = getEnv();
  const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  const recentLeads = database.db.select().from(leads).orderBy(desc(leads.createdAt)).limit(6).all();
  const leadCount = metricValue("SELECT COUNT(*) AS value FROM leads");
  const replyCount = metricValue("SELECT COUNT(DISTINCT lead_id) AS value FROM messages WHERE direction = 'inbound'");
  const handoffCount = metricValue("SELECT COUNT(*) AS value FROM leads WHERE pipeline_state IN ('whatsapp_handoff','registered','active_customer')");
  const openExceptions = metricValue("SELECT COUNT(*) AS value FROM exceptions WHERE status = 'open'");
  const aiSpend = Number((database.sqlite.prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS value FROM ai_calls").get() as { value: number }).value);
  const activeCustomers = metricValue("SELECT COUNT(*) AS value FROM leads WHERE pipeline_state = 'active_customer'");
  const costPerLead = leadCount ? aiSpend / leadCount : 0;
  const costPerCustomer = activeCustomers ? aiSpend / activeCustomers : 0;

  return <>
    <header className="topbar">
      <div><span className="eyebrow">Visão geral</span><h1>Operação comercial</h1><p className="subtitle">Observe, decida, aja e aprenda com cada conversa, mantendo limites, afirmações e propriedade de canal sob controle.</p></div>
      <form action={togglePause} className="pause-form"><input type="hidden" name="paused" value={settings?.globallyPaused ? "false" : "true"} /><button className={settings?.globallyPaused ? "" : "danger"}>{settings?.globallyPaused ? "Retomar operação" : "Pausar tudo"}</button></form>
    </header>
    {settings?.globallyPaused && <div className="alert">Operação pausada: {settings.pauseReason ?? "sem motivo informado"}</div>}
    <section className="grid-metrics" aria-label="Indicadores principais">
      <article className="metric"><span>Leads no CRM</span><strong>{leadCount}</strong><small>Custo de IA por lead: US$ {costPerLead.toFixed(4)}</small></article>
      <article className="metric"><span>Respostas recebidas</span><strong>{replyCount}</strong><small>{leadCount ? ((replyCount / leadCount) * 100).toFixed(1) : "0,0"}% dos leads cadastrados</small></article>
      <article className="metric"><span>Encaminhados ao WhatsApp</span><strong>{handoffCount}</strong><small>Custo por cliente ativo: US$ {costPerCustomer.toFixed(4)}</small></article>
      <article className="metric"><span>Exceções abertas</span><strong>{openExceptions}</strong><small>Itens que precisam do operador</small></article>
    </section>
    <div className="section-grid">
      <section className="card"><div className="card-header"><h2>Leads recentes</h2><Link href="/leads?funnel=client">Ver funil</Link></div>
        {recentLeads.length ? <div className="list">{recentLeads.map((lead) => <Link href={`/leads/${lead.id}`} className="list-row" key={lead.id}><strong>{lead.displayName || lead.instagramHandle}</strong><span className="muted">{lead.segment || "Segmento não definido"}</span><span>{lead.score} pontos</span><span className="status-pill">{pipelineLabels[lead.pipelineState] ?? lead.pipelineState}</span></Link>)}</div> : <div className="empty">Nenhum lead cadastrado. Adicione um perfil público para iniciar a qualificação.</div>}
      </section>
      <section className="card"><div className="card-header"><h2>Novo lead</h2><span className={`status-pill ${settings?.globallyPaused ? "paused" : ""}`}>{settings?.globallyPaused ? "Pausado" : "Operando"}</span></div>
        <form action={addLead} className="form-grid">
          <input type="hidden" name="funnel" value="client" />
          <div className="field full"><label htmlFor="instagramHandle">Perfil do Instagram</label><input id="instagramHandle" name="instagramHandle" placeholder="@empresa" required /></div>
          <div className="field"><label htmlFor="displayName">Nome</label><input id="displayName" name="displayName" /></div>
          <div className="field"><label htmlFor="segment">Segmento</label><input id="segment" name="segment" placeholder="Clínica, imobiliária..." /></div>
          <div className="field full"><label htmlFor="bio">Bio pública</label><textarea id="bio" name="bio" rows={3} /></div>
          <div className="field"><label htmlFor="location">Localização</label><input id="location" name="location" /></div>
          <div className="field"><label htmlFor="category">Categoria</label><input id="category" name="category" /></div>
          <button className="button primary field full" type="submit">Cadastrar e qualificar</button>
        </form>
      </section>
    </div>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Descoberta automática</h2><span className={`status-pill${env.DRY_RUN ? " paused" : ""}`}>{env.DRY_RUN ? "Simulação" : "Envio real"}</span></div><form action={startDiscovery} className="form-grid"><div className="field full"><label htmlFor="keyword">Palavra-chave ou segmento</label><input id="keyword" name="keyword" placeholder="clínica estética são josé dos campos" required /></div><button className="button field full" type="submit">Adicionar busca à fila</button></form><p className="subtitle">Uma busca descobre até 5 perfis públicos, filtra segmento e cidade, qualifica, cria a abordagem e envia pelo Chrome dedicado dentro dos limites configurados.</p>{business.autonomousDiscovery.enabled && <p className="subtitle">Rotina diária programada para começar em {business.autonomousDiscovery.startDate.split("-").reverse().join("/")}, somente de segunda a sexta, com até {business.autonomousDiscovery.dailyLeadLimit} leads por dia.</p>}</section>
    {!business.affiliateFunnelEnabled && <p className="subtitle">O funil de afiliados está implementado e permanece desativado até existir um link e uma remuneração oficialmente verificados.</p>}
  </>;
}
