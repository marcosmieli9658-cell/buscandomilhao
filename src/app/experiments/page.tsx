import { desc, eq } from "drizzle-orm";
import { database } from "@/db/client";
import { experimentAssignments, experiments, experimentVariants } from "@/db/schema";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  const allExperiments = database.db.select().from(experiments).orderBy(desc(experiments.createdAt)).all();
  return <>
    <header className="topbar"><div><span className="eyebrow">Aprendizado</span><h1>Experimentos controlados</h1><p className="subtitle">Uma variável por vez, atribuição determinística, amostra mínima e grupo de controle. Estratégias permanecem comparáveis e reversíveis.</p></div></header>
    <section className="card"><div className="card-header"><h2>Testes registrados</h2><span>{allExperiments.length}</span></div>
      {allExperiments.length ? <div className="list">{allExperiments.map((experiment) => {
        const variants = database.db.select().from(experimentVariants).where(eq(experimentVariants.experimentId, experiment.id)).all();
        const assignments = database.db.select().from(experimentAssignments).where(eq(experimentAssignments.experimentId, experiment.id)).all();
        const conversions = assignments.filter((assignment) => assignment.convertedAt).length;
        return <article className="list-row" key={experiment.id}><strong>{experiment.name}</strong><span className="muted">{experiment.variable} · {variants.length} variantes</span><span>{assignments.length} amostras</span><span className="status-pill">{conversions} conversões</span></article>;
      })}</div> : <div className="empty">Nenhum experimento ativo. A primeira variante pode ser criada quando houver volume suficiente para uma comparação válida.</div>}
    </section>
  </>;
}
