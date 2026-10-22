"use client";

import { useActionState, useState } from "react";
import { createManualDraftAction, reviewDraftAction, type ReviewActionState } from "./actions";
import styles from "./review.module.css";

const initialState: ReviewActionState = { ok: false, message: "" };

const suggestions = [
  { label: "Sites, primeira conversa", body: "Oi! Sou o Marcos, da Blessia Labs. A gente cria e reforma sites para empresas. Hoje vocês já têm um site ou concentram o atendimento por aqui?" },
  { label: "Reforma, somente após conferir o site", body: "Oi! Sou o Marcos, da Blessia Labs. Vi o site de vocês e queria entender: ele ainda atende bem o que a empresa precisa hoje?" },
  { label: "Serviços com agendamento", body: "Oi! Sou o Marcos, da Blessia Labs. Criamos sites para apresentar serviços e facilitar o contato. Hoje, como o cliente faz para agendar com vocês?" },
  { label: "Lojas físicas", body: "Oi! Sou o Marcos, da Blessia Labs. A gente ajuda lojas a começar a vender online. Ter uma loja virtual está nos planos de vocês?" },
  { label: "Perfil da Empresa no Google", body: "Oi! Sou o Marcos, da Blessia Labs. Trabalhamos com a presença de empresas no Google. Vocês já têm alguém cuidando das informações e atualizações do perfil por lá?" },
];

function Feedback({ state }: { state: ReviewActionState }) {
  return state.message ? <p role={state.ok ? "status" : "alert"} className={`${styles.feedback} ${state.ok ? styles.success : styles.error}`}>{state.message}</p> : null;
}

export function NewDraftForm() {
  const [handle, setHandle] = useState("");
  const [body, setBody] = useState("");
  const [state, action, pending] = useActionState(async (previous: ReviewActionState, data: FormData) => {
    const result = await createManualDraftAction(previous, data);
    if (result.ok) { setHandle(""); setBody(""); }
    return result;
  }, initialState);
  return <form action={action} className={styles.form}>
    <div className={styles.fields}>
      <label className={styles.field} htmlFor="new-handle">Destinatário no Instagram
        <input id="new-handle" name="handle" autoComplete="off" placeholder="@empresa" required maxLength={31} disabled={pending} value={handle} onChange={(event) => setHandle(event.target.value)} />
      </label>
      <label className={styles.field} htmlFor="new-template">Sugestão de texto, opcional
        <select id="new-template" defaultValue="" disabled={pending} onChange={(event) => { const suggestion = suggestions[Number(event.target.value)]; if (event.target.value !== "" && suggestion) setBody(suggestion.body); }}>
          <option value="">Escrever do zero</option>
          {suggestions.map((suggestion, index) => <option value={index} key={suggestion.label}>{suggestion.label}</option>)}
        </select>
      </label>
    </div>
    <label className={styles.field} htmlFor="new-body">Mensagem para revisar
      <textarea id="new-body" name="body" rows={5} maxLength={1000} disabled={pending} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escreva a abordagem para este destinatário. Você ainda vai revisar e aprovar antes de entrar na fila." />
    </label>
    <p className={styles.help}>As sugestões são pontos de partida e não estão aprovadas. Confira as informações sobre a empresa e adapte o texto antes de aprovar.</p>
    <Feedback state={state} />
    <div className={styles.actions}><button className="button" disabled={pending} type="submit">{pending ? "Criando rascunho…" : "Criar rascunho para revisão"}</button><span className={styles.help}>Cadastrar aqui não inicia descoberta nem envia mensagem.</span></div>
  </form>;
}

export function DraftReviewForm({ id, version, body: savedBody, channel }: { id: number; version: number; body: string; channel: "browser" | "api" }) {
  const [state, action, pending] = useActionState(reviewDraftAction, initialState);
  const [body, setBody] = useState(savedBody);
  const [historyChecked, setHistoryChecked] = useState(false);
  const dirty = body !== savedBody;
  return <form action={action} className={styles.form}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="version" value={version} />
    <label className={styles.field} htmlFor={`body-${id}`}>Texto da mensagem
      <textarea id={`body-${id}`} name="body" rows={5} maxLength={1000} disabled={pending} value={body} onChange={(event) => setBody(event.target.value)} />
    </label>
    <span className={styles.help}>{body.length}/1.000 caracteres. {dirty ? "Salve a alteração antes de aprovar." : "Este é o texto que será usado após a aprovação."}</span>
    {channel === "browser" && <label className={styles.check}>
      <input type="checkbox" name="directHistoryChecked" disabled={pending} checked={historyChecked} onChange={(event) => setHistoryChecked(event.target.checked)} />
      <span>Conferi o histórico desse destinatário no Direct da Blessia e confirmei que nunca enviamos mensagem a ele, inclusive manualmente ou com o perfil antigo.</span>
    </label>}
    <Feedback state={state} />
    <div className={styles.actions}>
      <button className="button" type="submit" name="intent" value="save" disabled={pending || !dirty}>{pending ? "Salvando…" : "Salvar alteração"}</button>
      <button className="button primary" type="submit" name="intent" value="approve" disabled={pending || dirty || !body.trim() || (channel === "browser" && !historyChecked)}>Aprovar texto revisado</button>
      <button className="button danger" type="submit" name="intent" value="reject" disabled={pending}>Rejeitar</button>
    </div>
    <p className={styles.help}>Aprovar coloca apenas este texto na fila. Não retoma a operação nem desativa a simulação.</p>
  </form>;
}

export function RejectApprovedForm({ id, version }: { id: number; version: number }) {
  const [state, action, pending] = useActionState(reviewDraftAction, initialState);
  return <form action={action} className={styles.form}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="version" value={version} />
    <Feedback state={state} />
    <div><button className="button danger" name="intent" value="reject" disabled={pending}>{pending ? "Retirando…" : "Retirar aprovação"}</button></div>
  </form>;
}
