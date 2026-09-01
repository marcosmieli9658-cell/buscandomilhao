import { desc, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { exceptions, jobs, systemSettings } from "@/db/schema";
import { resumeBrowserQueue } from "../actions";
import { jobTypeLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = { pending: "Pendente", running: "Em execução", completed: "Concluída", retry: "Nova tentativa", dead_letter: "Esgotada", cancelled: "Cancelada", open: "Aberta" };

export default function OperationsPage() {
  const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  const recentJobs = database.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(20).all();
  const openExceptions = database.db.select().from(exceptions).where(eq(exceptions.status, "open")).orderBy(desc(exceptions.createdAt)).limit(20).all();
  return <>
    <header className="topbar"><div><span className="eyebrow">Operação</span><h1>Filas, exceções e alertas</h1><p className="subtitle">Jobs são duráveis, retomam após reinício e vão para a fila de exceções quando esgotam as tentativas.</p></div></header>
    {settings?.browserQueuePaused && <div className="alert">Fila do navegador pausada: {settings.browserPauseReason}. <form action={resumeBrowserQueue} style={{display: "inline"}}><button className="button" type="submit">Retomar após corrigir</button></form></div>}
    <div className="section-grid">
      <section className="card"><div className="card-header"><h2>Fila de jobs</h2><span className="status-pill">Recuperação ativa</span></div>{recentJobs.length ? <div className="list">{recentJobs.map((job) => <div className="list-row" key={job.id}><strong>#{job.id} · {jobTypeLabels[job.type] ?? job.type}</strong><span className="muted">{statusLabels[job.status] ?? job.status}</span><span>{job.attempts}/{job.maxAttempts}</span><span className={`status-pill ${job.status === "dead_letter" ? "paused" : ""}`}>{statusLabels[job.status] ?? job.status}</span></div>)}</div> : <div className="empty">Nenhuma job criada.</div>}</section>
      <section className="card"><div className="card-header"><h2>Exceções abertas</h2><span>{openExceptions.length}</span></div>{openExceptions.length ? <div className="list">{openExceptions.map((exception) => <div className="lead-card" key={exception.id}><strong>{exception.code}</strong><span>{exception.message}</span><span>{exception.createdAt.toLocaleString("pt-BR")}</span></div>)}</div> : <div className="empty">Nenhuma exceção aberta. A operação está limpa.</div>}</section>
    </div>
  </>;
}
