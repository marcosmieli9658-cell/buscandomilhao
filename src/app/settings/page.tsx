import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const business = getBusinessConfig();
  const env = getEnv();
  return <>
    <header className="topbar"><div><span className="eyebrow">Configuração</span><h1>Limites e afirmações</h1><p className="subtitle">Os dados reais ficam centralizados em config/business.json e os segredos permanecem exclusivamente no .env.</p></div></header>
    <div className="section-grid">
      <section className="card"><div className="card-header"><h2>Negócio</h2><span className="status-pill">Verificado</span></div><div className="list"><div className="list-row"><strong>Empresa</strong><span className="muted">{business.companyName}</span><span>{business.instagramHandle}</span><a href={business.companyWebsite} target="_blank" rel="noreferrer">Site</a></div><div className="list-row"><strong>Região</strong><span className="muted">{business.geography}</span><span>{business.icpSegments.length} segmentos</span><span></span></div><div className="list-row"><strong>Afiliados</strong><span className="muted">{business.affiliateFunnelEnabled ? "Ativo" : "Desativado"}</span><span>{business.affiliateGroupLink ? "Link configurado" : "Sem link"}</span><span></span></div></div></section>
      <section className="card"><div className="card-header"><h2>Limites operacionais</h2></div><div className="list"><div className="lead-card"><strong>{env.MAX_DMS_PER_DAY} DMs por dia</strong><span>Aquecimento começa em 5 e cresce 5 por semana.</span></div><div className="lead-card"><strong>{env.MIN_SECONDS_BETWEEN_DMS} a {env.MAX_SECONDS_BETWEEN_DMS} segundos</strong><span>Intervalo aprovado entre contatos.</span></div><div className="lead-card"><strong>{env.OPERATING_HOURS}</strong><span>{env.OPERATING_TIMEZONE}</span></div><div className="lead-card"><strong>US$ {env.OPENAI_MONTHLY_BUDGET_USD.toFixed(2)}</strong><span>Teto mensal interno da OpenAI.</span></div></div></section>
    </div>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Afirmações permitidas</h2><span>{business.verifiedClaims.length}</span></div><div className="list">{business.verifiedClaims.map((claim, index) => <div className="lead-card" key={claim}><strong>Afirmação {index + 1}</strong><span>{claim}</span></div>)}</div></section>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Afirmações bloqueadas</h2><span>{business.unverifiedClaims.length}</span></div><div className="list">{business.unverifiedClaims.map((claim) => <div className="lead-card" key={claim}><strong>Bloqueada</strong><span>{claim}</span></div>)}</div></section>
  </>;
}
