import Link from "next/link";
import type { ReactNode } from "react";
import { getBusinessConfig } from "@/lib/business";

export function AppShell({ children }: { children: ReactNode }) {
  const business = getBusinessConfig();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark">UA</span><span><strong>{business.companyName}</strong><span>Agente comercial</span></span></Link>
      <nav className="nav" aria-label="Navegação principal">
        <Link href="/">Visão geral</Link>
        <Link href="/leads?funnel=client">Funil de clientes</Link>
        <Link href="/leads?funnel=affiliate">Funil de afiliados</Link>
        <Link href="/operations">Operação e alertas</Link>
        <Link href="/experiments">Experimentos</Link>
        <Link href="/settings">Configurações</Link>
      </nav>
      <p className="sidebar-note">Estratégia. Marketing. Resultados.</p>
    </aside>
    <main className="main">{children}</main>
  </div>;
}
