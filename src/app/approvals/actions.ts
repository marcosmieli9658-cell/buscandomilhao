"use server";

import { revalidatePath } from "next/cache";
import { database } from "@/db/client";
import {
  approveMessageDraft,
  createMessageDraft,
  listMessageDrafts,
  rejectMessageDraft,
  saveMessageDraft,
} from "@/features/approvals/service";
import { discoverLead } from "@/features/leads/service";

export type ReviewActionState = { ok: boolean; message: string };

function positiveInteger(formData: FormData, name: string): number {
  const value = Number(formData.get(name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Não foi possível identificar o rascunho. Atualize a página e tente novamente.");
  }
  return value;
}

function friendlyError(error: unknown): ReviewActionState {
  const message = error instanceof Error ? error.message : "Não foi possível salvar. Tente novamente.";
  return {
    ok: false,
    message: /SQLITE|SQL query|database|stack trace/i.test(message)
      ? "Não foi possível salvar no banco local. Atualize a página e tente novamente."
      : message,
  };
}

function refreshReview() {
  revalidatePath("/approvals");
  revalidatePath("/leads");
  revalidatePath("/");
}

export async function createManualDraftAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  try {
    const handle = String(formData.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
      throw new Error("Informe somente o @ do Instagram, com até 30 letras, números, pontos ou sublinhados.");
    }
    const body = String(formData.get("body") ?? "").trim();
    if (body.length > 1000) throw new Error("A mensagem deve ter até 1.000 caracteres.");

    database.sqlite.transaction(() => {
      const { lead } = discoverLead({
        funnel: "client",
        instagramHandle: handle,
        source: "operator_review",
      });
      createMessageDraft({
        leadId: lead.id,
        channel: "browser",
        purpose: "first_contact",
        body,
        reason: "Rascunho manual criado pelo operador para revisão individual.",
      });
    })();
    refreshReview();
    return { ok: true, message: "Rascunho criado. Revise o destinatário e o texto na lista abaixo. Nenhuma mensagem foi enviada." };
  } catch (error) {
    return friendlyError(error);
  }
}

export async function reviewDraftAction(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  try {
    const id = positiveInteger(formData, "id");
    const expectedVersion = positiveInteger(formData, "version");
    const intent = formData.get("intent");
    if (intent === "save") {
      saveMessageDraft({ id, expectedVersion, body: String(formData.get("body") ?? "") });
      refreshReview();
      return { ok: true, message: "Alteração salva. O texto ainda precisa da sua aprovação." };
    }
    if (intent === "approve") {
      const draft = listMessageDrafts().find((item) => item.id === id);
      if (!draft || draft.version !== expectedVersion) {
        throw new Error("Este rascunho mudou. Atualize a página e revise a versão atual antes de aprovar.");
      }
      if (String(formData.get("body") ?? "") !== draft.body) {
        throw new Error("Salve a alteração do texto antes de aprovar.");
      }
      approveMessageDraft({ id, expectedVersion, directHistoryChecked: formData.get("directHistoryChecked") === "on" });
      refreshReview();
      return { ok: true, message: "Texto aprovado e colocado na fila. A aprovação não altera a pausa nem o modo de simulação." };
    }
    if (intent === "reject") {
      rejectMessageDraft({ id, expectedVersion });
      refreshReview();
      return { ok: true, message: "Rascunho rejeitado. Ele não será enviado." };
    }
    throw new Error("Escolha salvar, aprovar ou rejeitar o rascunho.");
  } catch (error) {
    return friendlyError(error);
  }
}
