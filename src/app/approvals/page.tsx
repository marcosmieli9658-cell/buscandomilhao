import Link from "next/link";
import { eq } from "drizzle-orm";
import { database } from "@/db/client";
import { systemSettings } from "@/db/schema";
import { listMessageDrafts } from "@/features/approvals/service";
import { getEnv } from "@/lib/env";
import { DraftReviewForm, NewDraftForm, RejectApprovedForm } from "./review-forms";
import styles from "./review.module.css";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  pending: "Aguardando revisão", approved: "Aprovada, na fila", rejected: "Rejeitada",
  sending: "Envio iniciado", sent: "Enviada", simulated: "Simulada, sem envio", uncertain: "Envio incerto, bloqueado",
};
const purposeLabels: Record<string, string> = { first_contact: "Primeira abordagem", reply: "Resposta", follow_up: "Continuidade" };

function formatDate(value: Date) {
  return value.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export default function ApprovalsPage() {
  const settings = database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  const env = getEnv();
  const drafts = listMessageDrafts();
  const pending = drafts.filter((draft) => draft.status === "pending");
  const history = drafts.filter((draft) => draft.status !== "pending");

  function renderDraft(draft: (typeof drafts)[number]) {
    const recipient = draft.recipientHandle.replace(/^@/, "");
    const profileHref = /^[a-z0-9._]{1,30}$/i.test(recipient) ? `https://www.instagram.com/${encodeURIComponent(recipient)}/` : null;
    return <article className={`card ${styles.draft}`} key={`${draft.id}:${draft.version}`}>
      <header className={styles.draftHeader}>
        <div><h3>{draft.displayName || draft.recipientHandle}</h3><div className={styles.links}>
          {profileHref ? <a href={profileHref} target="_blank" rel="noreferrer">{draft.recipientHandle} ↗</a> : <span>{draft.recipientHandle}</span>}
          <Link href={`/leads/${draft.leadId}`}>Histórico no CRM</Link>
          {draft.channel === "browser" && <a href="https://www.instagram.com/direct/inbox/" target="_blank" rel="noreferrer">Conferir Direct ↗</a>}
        </div></div>
        <span className={`${styles.badge} ${["uncertain", "rejected"].includes(draft.status) ? styles.warningBadge : ""}`}>{statusLabels[draft.status] ?? draft.status}</span>
      </header>
      <dl className={styles.metadata}>
        <div><dt>Canal</dt><dd>{draft.channel === "browser" ? "Instagram pelo Chrome" : "Instagram pela API"}</dd></div>
        <div><dt>Tipo</dt><dd>{purposeLabels[draft.purpose] ?? draft.purpose}</dd></div>
        <div><dt>Criada</dt><dd>{formatDate(draft.createdAt)} (Brasília)</dd></div>
        <div><dt>Versão</dt><dd>{draft.version}</dd></div>
      </dl>
      {draft.reason && <p className={styles.reason}><strong>Origem e contexto:</strong> {draft.reason}</p>}
      {draft.currentHandle !== draft.recipientHandle && <p className={styles.error}>O @ do contato mudou no CRM. Este rascunho continua vinculado ao destinatário original e precisa de nova conferência.</p>}
      {draft.status === "pending" ? <DraftReviewForm id={draft.id} version={draft.version} body={draft.body} channel={draft.channel} /> : <>
        <p className={styles.message}>{draft.body || "Rascunho sem texto."}</p>
        {draft.status === "approved" && <><p className={styles.help}>O texto aprovado está bloqueado para edição. Para mudar a mensagem, retire a aprovação e crie um novo rascunho.</p><RejectApprovedForm id={draft.id} version={draft.version} /></>}
        {draft.status === "simulated" && <p className={styles.help}>A execução foi simulada. Esta mensagem não foi enviada e não será reenviada automaticamente.</p>}
        {draft.status === "uncertain" && <p className={styles.error}>A ferramenta não conseguiu confirmar o resultado. Confira a conversa no Instagram. Nenhuma nova tentativa automática será feita.</p>}
        {draft.status === "sending" && <p className={styles.help}>O envio foi iniciado. Aguarde a confirmação; não crie outra mensagem para tentar novamente.</p>}
      </>}
    </article>;
  }

  return <div className={styles.page}>
    <header className="topbar"><div><span className="eyebrow">Revisão individual</span><h1>Mensagens para aprovar</h1><p className={`subtitle ${styles.intro}`}>Confira o destinatário, ajuste o texto e aprove cada mensagem. Só o texto aprovado pode entrar na fila de envio.</p></div></header>
    <section className={styles.operation} aria-label="Situação dos envios">
      <strong>{settings?.globallyPaused ? "Operação pausada" : "Operação liberada"} · {env.DRY_RUN ? "Simulação ativada" : "Modo de envio real"}</strong>
      <p>{settings?.globallyPaused ? "Você pode preparar e aprovar mensagens. Elas não serão enviadas enquanto a operação estiver pausada." : env.DRY_RUN ? "As mensagens aprovadas podem ser processadas em simulação, sem envio ao Instagram." : "As mensagens aprovadas podem ser enviadas quando o worker estiver ativo e as verificações do canal permitirem."}</p>
      {settings?.browserQueuePaused && <p>Fila do Chrome também está pausada.</p>}
      <p>Aprovar uma mensagem não altera essas configurações.</p>
    </section>
    <div className={styles.summary}><span><strong>{pending.length}</strong> para revisar</span><span><strong>{drafts.filter((draft) => draft.status === "approved").length}</strong> aprovadas na fila</span><span><strong>{drafts.filter((draft) => draft.status === "uncertain").length}</strong> com envio incerto</span></div>
    <details className={`card ${styles.compose}`} open={drafts.length === 0}>
      <summary>Preparar abordagem para um contato novo</summary>
      <p className={styles.help}>Informe o @ de uma empresa que você quer abordar. Contatos com envio registrado ou tentativa antiga incerta ficam bloqueados para uma nova primeira abordagem.</p>
      <NewDraftForm />
    </details>
    <section className={styles.section} aria-labelledby="pending-heading"><h2 id="pending-heading">Aguardando sua revisão</h2>
      {pending.length ? <div className={styles.drafts}>{pending.map(renderDraft)}</div> : <div className={`empty ${styles.empty}`}>Nenhuma mensagem aguarda revisão. Use o formulário acima para preparar uma abordagem. Os contatos antigos não foram colocados de volta na fila.</div>}
    </section>
    {history.length > 0 && <section className={styles.section} aria-labelledby="history-heading"><h2 id="history-heading">Aprovadas e histórico</h2><div className={styles.drafts}>{history.map(renderDraft)}</div></section>}
  </div>;
}
