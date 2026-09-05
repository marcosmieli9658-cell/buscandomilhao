import { getBusinessConfig } from "@/lib/business";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

async function isChromeConnected(cdpUrl: string) {
  try {
    const response = await fetch(`${cdpUrl}/json/version`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function SettingsPage() {
  const business = getBusinessConfig();
  const env = getEnv();
  const chromeConnected = await isChromeConnected(env.CHROME_CDP_URL);
  const credentials = [
    { name: "OpenAI", ready: Boolean(env.OPENAI_API_KEY), detail: "OPENAI_API_KEY" },
    { name: "Token da Meta", ready: Boolean(env.INSTAGRAM_PAGE_ACCESS_TOKEN), detail: "INSTAGRAM_PAGE_ACCESS_TOKEN" },
    { name: "Conta do Instagram", ready: Boolean(env.INSTAGRAM_BUSINESS_ACCOUNT_ID), detail: "INSTAGRAM_BUSINESS_ACCOUNT_ID" },
    { name: "Segredo do app Meta", ready: Boolean(env.INSTAGRAM_APP_SECRET), detail: "INSTAGRAM_APP_SECRET" },
    { name: "Verificação do webhook", ready: Boolean(env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN), detail: "INSTAGRAM_WEBHOOK_VERIFY_TOKEN" },
    { name: "Chrome dedicado", ready: chromeConnected, detail: env.CHROME_CDP_URL },
  ];
  return <>
    <header className="topbar"><div><span className="eyebrow">Configuração</span><h1>Limites e afirmações</h1><p className="subtitle">Os dados reais ficam centralizados em config/business.json e os segredos permanecem exclusivamente no .env.</p></div></header>
    <div className="section-grid">
      <section className="card"><div className="card-header"><h2>Negócio</h2><span className="status-pill">Verificado</span></div><div className="list"><div className="list-row"><strong>Empresa</strong><span className="muted">{business.companyName}</span><span>{business.instagramHandle}</span><a href={business.companyWebsite} target="_blank" rel="noreferrer">Site</a></div><div className="list-row"><strong>Região</strong><span className="muted">{business.geography}</span><span>{business.icpSegments.length} segmentos</span><span></span></div><div className="list-row"><strong>Descoberta diária</strong><span className="muted">{business.autonomousDiscovery.enabled ? "Ativa" : "Desativada"}</span><span>Início {business.autonomousDiscovery.startDate.split("-").reverse().join("/")}</span><span>{business.autonomousDiscovery.keywords.length} buscas</span></div><div className="list-row"><strong>Afiliados</strong><span className="muted">{business.affiliateFunnelEnabled ? "Ativo" : "Desativado"}</span><span>{business.affiliateGroupLink ? "Link configurado" : "Sem link"}</span><span></span></div></div></section>
      <section className="card"><div className="card-header"><h2>Limites operacionais</h2><span className={`status-pill${env.DRY_RUN ? " paused" : ""}`}>{env.DRY_RUN ? "Simulação" : "Envio real"}</span></div><div className="list"><div className="lead-card"><strong>Até {env.MAX_DMS_PER_DAY} leads por dia</strong><span>Somente de segunda a sexta.</span></div><div className="lead-card"><strong>{env.MIN_SECONDS_BETWEEN_DMS} segundos</strong><span>Intervalo fixo entre contatos.</span></div><div className="lead-card"><strong>{env.OPERATING_HOURS}</strong><span>{env.OPERATING_TIMEZONE}</span></div><div className="lead-card"><strong>US$ {env.OPENAI_MONTHLY_BUDGET_USD.toFixed(2)}</strong><span>Teto mensal interno da OpenAI.</span></div></div></section>
    </div>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Credenciais e conexões</h2><span>{credentials.filter((item) => item.ready).length}/{credentials.length} prontas</span></div><div className="list">{credentials.map((item) => <div className="list-row" key={item.name}><strong>{item.name}</strong><span className="muted">{item.detail}</span><span className={`status-pill${item.ready ? "" : " paused"}`}>{item.ready ? "Pronto" : "Pendente"}</span><span></span></div>)}</div><p className="subtitle">Os valores secretos não aparecem no painel. Após alterar o .env, reinicie a ferramenta para carregar as novas credenciais.</p></section>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Afirmações permitidas</h2><span>{business.verifiedClaims.length}</span></div><div className="list">{business.verifiedClaims.map((claim, index) => <div className="lead-card" key={claim}><strong>Afirmação {index + 1}</strong><span>{claim}</span></div>)}</div></section>
    <section className="card" style={{marginTop: 16}}><div className="card-header"><h2>Afirmações bloqueadas</h2><span>{business.unverifiedClaims.length}</span></div><div className="list">{business.unverifiedClaims.map((claim) => <div className="lead-card" key={claim}><strong>Bloqueada</strong><span>{claim}</span></div>)}</div></section>
  </>;
}
